// =========================================================================
// SECTION 1: LIBRARY IMPORT & INITIALIZATION
// =========================================================================

var Clay = require('@rebble/clay');
var GEMINI_PLUGIN_UUID='2c5edc42-b096-4f76-b284-1f27907e6501';
var GOOGLE_TTS_PLUGIN_UUID='2c5edc42-b096-4f76-b284-1f27907e6502';
var GoogleTtsStream=require('./google_tts_stream');
function useStoredBackend(key,hasLegacyKey){return localStorage.getItem(key)||(hasLegacyKey?'direct':'plugin');}


// =========================================================================
// SECTION 2: STORAGE MEMORY RECOVERY & TOGGLE LOGIC
// =========================================================================

var geminiApiKey = localStorage.getItem("GEMINI_API_KEY") || ""; 
var ttsApiKey = localStorage.getItem("TTS_API_KEY") || "";
var geminiBackend=useStoredBackend('GEMINI_BACKEND',!!geminiApiKey);
var ttsBackend=useStoredBackend('TTS_BACKEND',!!ttsApiKey);
var geminiPluginConversationId=localStorage.getItem('GEMINI_PLUGIN_CONVERSATION_ID')||'';
       
var fontSize = localStorage.getItem("FONT_SIZE") || 24;          
var customPersona = localStorage.getItem("CUSTOM_PERSONA") || ""; 

// Restore dynamic dropdown configurations with updated default
var geminiModel = localStorage.getItem("GEMINI_MODEL") || "gemini-3.8-flash"; 
// Migrate legacy Chirp3 aliases, which never existed in Google's TTS catalog.
var ttsVoice = localStorage.getItem("TTS_VOICE") || "en-US-Wavenet-F";
var TTS_VOICE_ALIASES = {
  "en-US-Chirp3-HD-F": "en-US-Chirp3-HD-Kore",
  "en-US-Chirp3-HD-M": "en-US-Chirp3-HD-Charon",
  "en-US-Studio-O": "en-US-Wavenet-F",
  "en-US-Studio-M": "en-US-Wavenet-D",
  "en-US-Journey-F": "en-US-Wavenet-F",
  "en-US-Journey-D": "en-US-Wavenet-D"
};
var SUPPORTED_TTS_VOICES = [
  "en-US-Wavenet-C", "en-US-Wavenet-D", "en-US-Wavenet-F",
  "en-US-Neural2-C", "en-US-Neural2-D", "en-US-Neural2-F",
  "en-US-Chirp3-HD-Kore", "en-US-Chirp3-HD-Aoede",
  "en-US-Chirp3-HD-Leda", "en-US-Chirp3-HD-Zephyr",
  "en-US-Chirp3-HD-Charon", "en-US-Chirp3-HD-Puck"
];
function normalizeTtsVoice(name) {
  var migrated = TTS_VOICE_ALIASES[name] || name;
  return SUPPORTED_TTS_VOICES.indexOf(migrated) >= 0 ? migrated : "en-US-Wavenet-F";
}
ttsVoice = normalizeTtsVoice(ttsVoice);
localStorage.setItem("TTS_VOICE", ttsVoice);        

// LOGIC: Evaluate the user's TTS preference based on history
var storedToggle = localStorage.getItem("ENABLE_TTS");
var enableTts = false; // Default to OFF for new installs

if (storedToggle === "true") {
  enableTts = true;    // User explicitly turned it on
} else if (storedToggle === "false") {
  enableTts = false;   // User explicitly turned it off
} else if (ttsApiKey !== "") {
  enableTts = true;    // UPGRADE PATH: Turn on automatically if they already have a key saved
}

// =========================================================================
// SECTION 3: SYSTEM SCOPE DECLARATIONS
// =========================================================================

var conversationHistory = [];
var MAX_HISTORY_MESSAGES = 6;
var MAX_HISTORY_CHARACTERS = 8000;
var GEMINI_TIMEOUT_MS = 30000;
var TTS_TIMEOUT_MS = 20000;
function trimConversationHistory(items) {
  if (!Array.isArray(items)) return [];
  var pairs = [];
  for (var i = 0; i + 1 < items.length; i++) {
    var user = items[i], model = items[i + 1];
    if (user && model && user.role === 'user' && model.role === 'model' &&
        Array.isArray(user.parts) && Array.isArray(model.parts) &&
        user.parts[0] && model.parts[0] && typeof user.parts[0].text === 'string' && typeof model.parts[0].text === 'string') {
      pairs.push([user, model]); i++;
    }
  }
  var result = [], chars = 0;
  for (var j = pairs.length - 1; j >= 0 && result.length < MAX_HISTORY_MESSAGES; j--) {
    var size = JSON.stringify(pairs[j]).length;
    if (chars + size > MAX_HISTORY_CHARACTERS) break;
    chars += size;
    result.unshift(pairs[j][0], pairs[j][1]);
  }
  return result;
}
try {
  var storedHistory = localStorage.getItem("CHAT_HISTORY"); 
  if (storedHistory) {                                      
    conversationHistory = trimConversationHistory(JSON.parse(storedHistory));        
  }
} catch (e) {
  conversationHistory = [];                                 
}

// =========================================================================
// SECTION 4: ECOSYSTEM PLATFORM DETECTION
// =========================================================================

// Pebble 2 Duo (flint) and Time 2 (emery) have speakers. Round 2
// (gabbro) has a microphone but no speaker: use dictation + text only.
// Unknown hardware defaults to text-only until its capabilities are known.
function platformHasSpeaker(platform) {
  return platform === 'flint' || platform === 'emery';
}
var watchInfo = null;
var hasSpeaker = false;
try {
  watchInfo = Pebble.getActiveWatchInfo();
  hasSpeaker = !!(watchInfo && platformHasSpeaker(watchInfo.platform));
} catch (err) {
  hasSpeaker = false;
}

// =========================================================================
// SECTION 5: STREAMING ARCHITECTURE QUEUE STATE
// =========================================================================

var sentenceQueue = [];    
var readyAudioQueue = [];  
var isFetchingTTS = false; 
var isSendingBLE = false;
var requestGeneration = 0;
var MAX_BLE_RETRIES = 5;
var nextStreamId = (Date.now() & 0x7fffffff) || 1;
var activeTransfer = null;
var streamEndSent = false;
var AUDIO_PACKET_BYTES = 360; // Leaves room for command/session/sequence tuples.
var ACK_TIMEOUT_MS = 1800;
var rateBytesPerSecond = 5200; // Conservative initial link estimate.
var lastAckTime = 0;
function requestJsonWithTimeout(url, options, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (!done) { done = true; reject(new Error('Request timed out')); }
    }, timeoutMs);
    try {
      fetch(url, options).then(function(response) {
        return response.json().then(function(data) {
          if (response.ok === false && !data.error) data.error = {message: 'HTTP ' + response.status};
          return data;
        });
      }).then(function(data) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(data);
      }).catch(function(err) {
        if (done) return;
        done = true; clearTimeout(timer); reject(err);
      });
    } catch (err) {
      if (done) return;
      done = true; clearTimeout(timer); reject(err);
    }
  });
}
function apiErrorMessage(error, service) {
  var message = String(error && error.message || error || '').toLowerCase();
  if (message.indexOf('timed out') >= 0) return service + ' timed out. Try again.';
  if (/plugin unavailable|plugin support|install\/configure plugin|plugin.*permission|unknown plugin/.test(message))
    return 'Install/configure the '+(service==='Gemini'?'Gemini Conversation':'Google TTS')+' plugin and grant permissions.';
  if (/api.key|permission.denied|unauthenticated|401|403/.test(message)) return service + ' key/access error. Check settings.';
  if (/quota|rate.limit|resource.exhausted|429/.test(message)) return service + ' usage limit reached. Try later.';
  if (message.indexOf('voice') >= 0) return 'Voice unavailable. Select WaveNet F.';
  return service + ' request failed. Check connection.';
}
  

var js_adpcm_valpred = 0;  
var js_adpcm_index = 0;
var googleTtsStream=GoogleTtsStream.create({Pebble:Pebble,pluginId:GOOGLE_TTS_PLUGIN_UUID,encodeADPCM:encodeADPCM});


// =========================================================================
// SECTION 6: ADPCM SIGNAL DICTIONARY TABLES
// =========================================================================

var stepTable = [
  7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,
  34,37,41,45,50,55,60,66,73,80,88,97,107,118,
  130,143,157,173,190,209,230,253,279,307,337,
  371,408,449,494,544,598,658,724,796,876,963,
  1060,1166,1282,1411,1552,1707,1878,2066,2272,
  2499,2749,3024,3327,3660,4026,4428,4871,5358,
  5894,6484,7132,7845,8630,9493,10442,11487,
  12635,13899,15289,16818,18500,20350,22385,
  24623,27086,29794,32767
];

var indexTable = [
  -1,-1,-1,-1,2,4,6,8,
  -1,-1,-1,-1,2,4,6,8
];

// =========================================================================
// SECTION 7: DYNAMIC MENU CONFIGURATION TREE
// =========================================================================

// The plugin owns credentials, model and voice settings when selected.
// App-only controls (persona, speaker on/off, font size) remain visible.
var apiKeysItems = [
  {type:'heading',defaultValue:'Service providers'},
  {
    type:'select',messageKey:'GEMINI_BACKEND',label:'Gemini conversations',
    defaultValue:geminiBackend,
    description:'Plugin: set the key, model and pricing in Gemini Conversation plugin settings. Direct: use this app\'s legacy API settings.',
    options:[
      {label:'Gemini Conversation plugin (recommended)',value:'plugin'},
      {label:'Direct Gemini API (legacy)',value:'direct'}
    ]
  },
  {
    type:'input',messageKey:'GEMINI_API_KEY',label:'Gemini API key (direct mode only)',
    description:geminiApiKey?'Direct key already saved locally. Leave blank to keep it.':'Only required when using Direct Gemini API.',
    attributes:{
      type:'password',autocorrect:'off',autocapitalize:'off',
      placeholder:geminiApiKey?'Existing direct key saved':'Paste Gemini Developer API key'
    }
  },
  {
    type:'select',messageKey:'GEMINI_MODEL',label:'Gemini model (direct mode only)',
    defaultValue:geminiModel,
    description:'In plugin mode, this setting is controlled by the Gemini Conversation plugin.',
    options:[
      {label:'Gemini 3.8 Flash',value:'gemini-3.8-flash'},
      {label:'Gemini 3.7 Flash',value:'gemini-3.7-flash'},
      {label:'Gemini 3.6 Flash',value:'gemini-3.6-flash'},
      {label:'Gemini 3.5 Flash',value:'gemini-3.5-flash'},
      {label:'Gemini 3.5 Flash-Lite',value:'gemini-3.5-flash-lite'},
      {label:'Gemini 3.1 Pro (Preview)',value:'gemini-3.1-pro-preview'},
      {label:'Gemini 3.1 Flash-Lite',value:'gemini-3.1-flash-lite'},
      {label:'Gemini 3 Flash (Preview)',value:'gemini-3-flash-preview'},
      {label:'Gemini 2.5 Pro',value:'gemini-2.5-pro'},
      {label:'Gemini 2.5 Flash',value:'gemini-2.5-flash'},
      {label:'Gemini 2.5 Flash-Lite',value:'gemini-2.5-flash-lite'}
    ]
  }
];
if(hasSpeaker){
  apiKeysItems.push({
    type:'toggle',messageKey:'ENABLE_TTS',label:'Enable spoken responses',
    defaultValue:enableTts,
    description:'This turns watch speech on or off, regardless of which speech provider you use.'
  });
  apiKeysItems.push({
    type:'select',messageKey:'TTS_BACKEND',label:'Speech provider',
    defaultValue:ttsBackend,
    description:'Plugin: choose the voice and API key in Google Cloud TTS plugin settings. Direct: use the legacy fields below.',
    options:[
      {label:'Google Cloud TTS plugin (recommended)',value:'plugin'},
      {label:'Direct Google Cloud TTS (legacy)',value:'direct'}
    ]
  });
  apiKeysItems.push({
    type:'input',messageKey:'TTS_API_KEY',label:'Cloud TTS key (direct mode only)',
    description:ttsApiKey?'Direct key already saved locally. Leave blank to keep it.':'Required only when using Direct Cloud TTS.',
    attributes:{
      type:'password',autocorrect:'off',autocapitalize:'off',
      placeholder:ttsApiKey?'Existing direct key saved':'Paste Google Cloud TTS API key'
    }
  });
  apiKeysItems.push({
    type:'select',messageKey:'TTS_VOICE',label:'TTS voice (direct mode only)',
    defaultValue:ttsVoice,
    description:'In plugin mode, voice and pricing are managed by the Google Cloud TTS plugin.',
    options:[
      {label:'WaveNet F · $',value:'en-US-Wavenet-F'},
      {label:'WaveNet C · $',value:'en-US-Wavenet-C'},
      {label:'WaveNet D · $',value:'en-US-Wavenet-D'},
      {label:'Neural2 F · $$',value:'en-US-Neural2-F'},
      {label:'Neural2 C · $$',value:'en-US-Neural2-C'},
      {label:'Neural2 D · $$',value:'en-US-Neural2-D'},
      {label:'Chirp 3 HD Kore · $$$',value:'en-US-Chirp3-HD-Kore'},
      {label:'Chirp 3 HD Aoede · $$$',value:'en-US-Chirp3-HD-Aoede'},
      {label:'Chirp 3 HD Leda · $$$',value:'en-US-Chirp3-HD-Leda'},
      {label:'Chirp 3 HD Zephyr · $$$',value:'en-US-Chirp3-HD-Zephyr'},
      {label:'Chirp 3 HD Charon · $$$',value:'en-US-Chirp3-HD-Charon'},
      {label:'Chirp 3 HD Puck · $$$',value:'en-US-Chirp3-HD-Puck'}
    ]
  });
}

var clayConfig = [
  { "type": "heading", "defaultValue": "Gemini Configuration" }, 
  {
    "type": "section", 
    "items": [
      { "type": "heading", "defaultValue": "Personalization" },
      {
        "type": "input", 
        "messageKey": "CUSTOM_PERSONA",
        "label": "Custom Assistant Memory",
        "defaultValue": customPersona,
        "description": "Tell Gemini who you are or how it should behave.",
        "attributes": {
          "spellcheck": "true"
        }
      }
    ]
  },
  {
    "type": "section", 
    "items": apiKeysItems
  },
  {
    "type": "section", 
    "items": advancedSettingsItems
  },
  {
    "type": "section",
    "items": [
      { "type": "heading", "defaultValue": "Conversation & Privacy" },
      { "type": "text", "defaultValue": "Your current provider handles model and voice settings. Plugin credentials are stored in Pebble secure storage; direct-mode keys remain in legacy app storage. Conversation history is stored on the phone. API usage may incur charges." },
      { "type": "toggle", "messageKey": "CLEAR_HISTORY", "label": "Clear Conversation History on Save",
        "defaultValue": false, "description": "Clear prior questions and answers without removing API keys, voice, or settings." }
    ]
  },
  {
    "type": "section", 
    "items": [
      { "type": "heading", "defaultValue": "Display Settings" },
      {
        "type": "slider",
        "messageKey": "FONT_SIZE",
        "defaultValue": parseInt(fontSize), 
        "label": "Font Size",
        "min": 14,
        "max": 28,
        "step": 2
      }
    ]
  },
  {
    "type": "submit", 
    "defaultValue": "Save Settings"
  }
];

// =========================================================================
// SECTION 8: CUSTOM CLAY UI HANDLER FUNCTION
// =========================================================================

// This function is injected into the phone's webview to handle dynamic 
// layout changes cleanly without relying on unstable capability tags.
function customClay(){
  var clayConfig=this;
  function value(key,fallback){
    var item=clayConfig.getItemByMessageKey(key);
    if(!item)return fallback;
    var v=item.get();
    return v&&typeof v==='object'&&v.value!==undefined?v.value:(v===undefined?fallback:v);
  }
  function bool(v){return v===true||v===1||v==='true'||v==='1';}
  function visible(key,show){
    var item=clayConfig.getItemByMessageKey(key);
    if(item){if(show)item.show();else item.hide();}
  }
  function updateProviderVisibility(){
    var directGemini=String(value('GEMINI_BACKEND',geminiBackend))==='direct';
    var directSpeech=String(value('TTS_BACKEND',ttsBackend))==='direct';
    var speaking=bool(value('ENABLE_TTS',enableTts));
    visible('GEMINI_API_KEY',directGemini);
    visible('GEMINI_MODEL',directGemini);
    visible('TTS_API_KEY',directSpeech&&speaking);
    visible('TTS_VOICE',directSpeech&&speaking);
  }
  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD,function(){
    ['GEMINI_BACKEND','TTS_BACKEND','ENABLE_TTS'].forEach(function(key){
      var item=clayConfig.getItemByMessageKey(key);
      if(item)item.on('change',updateProviderVisibility);
    });
    updateProviderVisibility();
  });
}

// Initialize Clay and inject the custom UI handler
var clay = new Clay(clayConfig, customClay, {
  autoHandleEvents: false 
});

// =========================================================================
// SECTION 9: ADPCM COMPRESSION MATRIX ALGORITHMS
// =========================================================================

function encodeADPCM(pcm16) {
  var adpcm = [];     
  var buffer = 0;     
  var toggle = false; 

  for (var i = 0; i < pcm16.length; i++) {
    var diff = pcm16[i] - js_adpcm_valpred; 
    var sign = (diff < 0) ? 8 : 0;          
    if (sign) diff = -diff;                 

    var step = stepTable[js_adpcm_index];   
    var delta = 0;                          
    var vpdiff = (step >> 3);               

    if (diff >= step) { delta |= 4; diff -= step; vpdiff += step; }
    step >>= 1;
    if (diff >= step) { delta |= 2; diff -= step; vpdiff += step; }
    step >>= 1;
    if (diff >= step) { delta |= 1; vpdiff += step; }

    if (sign) { js_adpcm_valpred -= vpdiff; } 
    else { js_adpcm_valpred += vpdiff; }

    if (js_adpcm_valpred > 32767) js_adpcm_valpred = 32767;     
    if (js_adpcm_valpred < -32768) js_adpcm_valpred = -32768;   

    delta |= sign;                             
    js_adpcm_index += indexTable[delta];       

    if (js_adpcm_index < 0) js_adpcm_index = 0;   
    if (js_adpcm_index > 88) js_adpcm_index = 88; 

    if (toggle) {
      buffer |= (delta & 0x0F);   
      adpcm.push(buffer);         
      toggle = false;             
    } else {
      buffer = (delta & 0x0F) << 4; 
      toggle = true;              
    }
  }

  if (toggle) { adpcm.push(buffer); } 
  return adpcm;
}

function lowPassFilter(samples) {
  if (samples.length < 3) return samples.slice();
  var filtered = [];
  filtered[0] = samples[0];
  filtered[1] = samples[1]; 
  for (var i = 2; i < samples.length; i++) {
    filtered[i] = (samples[i] + samples[i - 1] + samples[i - 2]) / 3;
  }
  return filtered;
}

// =========================================================================
// SECTION 10: OS INFRASTRUCTURE EVENT SUB-SYSTEM
// =========================================================================

Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL(clay.generateUrl()); 
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (e && !e.response) return; 
  var settings;
  try { settings = JSON.parse(decodeURIComponent(e.response)); }
  catch (error) { console.log('Invalid configuration response', error); return; } 

  if (settings.CLEAR_HISTORY && (settings.CLEAR_HISTORY.value === true || settings.CLEAR_HISTORY.value === 'true')) {
    cancelCurrentAudio();
    if(geminiPluginConversationId&&typeof Pebble.invokeAction==='function'){
      Pebble.invokeAction({plugin:GEMINI_PLUGIN_UUID,action:'clear_conversation',
        args:{conversation_id:geminiPluginConversationId}}).catch(function(){});
    }
    geminiPluginConversationId='';
    localStorage.removeItem('GEMINI_PLUGIN_CONVERSATION_ID');
    conversationHistory = [];
    localStorage.setItem('CHAT_HISTORY', '[]');
    console.log('Conversation history cleared');
  }
  if(settings.GEMINI_BACKEND){
    geminiBackend=settings.GEMINI_BACKEND.value==='direct'?'direct':'plugin';
    localStorage.setItem('GEMINI_BACKEND',geminiBackend);
  }
  if(settings.TTS_BACKEND){
    ttsBackend=settings.TTS_BACKEND.value==='direct'?'direct':'plugin';
    localStorage.setItem('TTS_BACKEND',ttsBackend);
  }
  if (settings.CUSTOM_PERSONA) {
    customPersona = settings.CUSTOM_PERSONA.value;
    localStorage.setItem("CUSTOM_PERSONA", customPersona); 
  }

  if (geminiBackend==='direct' && settings.GEMINI_API_KEY && settings.GEMINI_API_KEY.value !== "") {
    geminiApiKey = settings.GEMINI_API_KEY.value;
    localStorage.setItem("GEMINI_API_KEY", geminiApiKey); 
  }

  if (settings.ENABLE_TTS !== undefined) {
    enableTts = settings.ENABLE_TTS.value;
    localStorage.setItem("ENABLE_TTS", enableTts ? "true" : "false"); 
  }

  // An intentionally blank Clay field must not erase a previously saved key.
  if (ttsBackend==='direct' && settings.TTS_API_KEY && settings.TTS_API_KEY.value) {
    ttsApiKey = settings.TTS_API_KEY.value;
    localStorage.setItem("TTS_API_KEY", ttsApiKey);
  }

  if (geminiBackend==='direct' && settings.GEMINI_MODEL) {
    geminiModel = settings.GEMINI_MODEL.value || "gemini-3.8-flash"; 
    localStorage.setItem("GEMINI_MODEL", geminiModel); 
  }

  if (ttsBackend==='direct' && settings.TTS_VOICE) {
    ttsVoice = normalizeTtsVoice(settings.TTS_VOICE.value || "en-US-Wavenet-F"); 
    localStorage.setItem("TTS_VOICE", ttsVoice); 
  }



  if (settings.FONT_SIZE) {
    fontSize = settings.FONT_SIZE.value;
    localStorage.setItem("FONT_SIZE", fontSize);         
    Pebble.sendAppMessage({ 'COMMAND': 'UPDATE_FONT', 'FONT_SIZE': parseInt(fontSize) }); 
  }
});

Pebble.addEventListener('ready', function() {
  if (fontSize != 24) {
    Pebble.sendAppMessage({ 'COMMAND': 'UPDATE_FONT', 'FONT_SIZE': parseInt(fontSize) }); 
  }
});

Pebble.addEventListener('appmessage', function(e) {
  var dict = e.payload; 

  if (dict.COMMAND === 'AUDIO_ACK' || dict.COMMAND === 'AUDIO_WAIT') {
    handleAudioAck(dict);
    return;
  }
  if (dict.COMMAND === 'AUDIO_CANCEL') {
    cancelCurrentAudio();
    return;
  }

  if (dict.COMMAND === 'DICTATION') {
    if (!geminiApiKey) geminiApiKey = localStorage.getItem("GEMINI_API_KEY") || "";
    if (ttsApiKey === null) ttsApiKey = localStorage.getItem("TTS_API_KEY") || "";
    var savedToggle = localStorage.getItem("ENABLE_TTS");
    if (savedToggle === "true" || savedToggle === "false") enableTts = savedToggle === "true";

    // The plugins own credentials; direct requests retain their old keys.
    if (geminiBackend==='direct' && !geminiApiKey) {
      sendErrorToWatch("Missing Gemini Key. Check settings.");
      return;
    }

    if (hasSpeaker && enableTts && ttsBackend==='direct' && !ttsApiKey) {
      sendErrorToWatch("TTS enabled but missing TTS Key.");
      return;
    }

    var skipAudio = false; 
    if (!hasSpeaker || !enableTts || (ttsBackend==='direct' && !ttsApiKey)) {
      skipAudio = true;    
    } else if (dict.VOLUME !== undefined && dict.VOLUME === 0) {
      skipAudio = true;    
    }

    fetchGeminiResponse(dict.TEXT, skipAudio); 
  }
});

function sendErrorToWatch(msg) {
  Pebble.sendAppMessage({ 'COMMAND': 'TEXT_RESPONSE_NO_AUDIO', 'TEXT': msg }); 
}

// =========================================================================
// SECTION 11: CORE INTELLIGENCE ROUTINES
// =========================================================================

function fetchGeminiResponse(prompt, skipAudio) {
  cancelCurrentAudio();
  var generation = requestGeneration;
  var streamId = nextStreamId = ((nextStreamId + 1) & 0x7fffffff) || 1;
  sentenceQueue = [];
  readyAudioQueue = [];
  isFetchingTTS = false;
  isSendingBLE = false;
  js_adpcm_valpred = 0;
  js_adpcm_index = 0;

  var localTime = new Date().toLocaleString(); 
  var systemText = "You are a smartwatch voice assistant. Responses must be conversational and under 100 words. No markdown or bullet lists. Current local time: " + localTime + ".";
  
  if (customPersona) {
    systemText += "\nUser's custom instructions: " + customPersona; 
  }

  var historyForRequest = trimConversationHistory(conversationHistory).slice();
  historyForRequest.push({ role: "user", parts: [{ text: prompt }] }); 

  // DYNAMIC URL ROUTING
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + geminiModel + ":generateContent?key=" + geminiApiKey;

  var responseRequest;
  if(geminiBackend==='plugin'){
    if(typeof Pebble.invokeAction!=='function'){
      sendErrorToWatch('Update Pebble phone app for plugin support.');
      return;
    }
    var pluginArgs={text:prompt,instructions:systemText};
    if(geminiPluginConversationId)pluginArgs.conversation_id=geminiPluginConversationId;
    responseRequest=Pebble.invokeAction({plugin:GEMINI_PLUGIN_UUID,action:'conversation',args:pluginArgs})
      .then(function(reply){
        if(!reply||!reply.ok)throw Error('Gemini plugin unavailable: '+String(reply&&reply.message||'Install/configure plugin and grant permission'));
        var data;
        try{data=JSON.parse(reply.text||'{}');}catch(e){throw Error('Gemini plugin returned invalid JSON');}
        if(data.conversation_id){
          geminiPluginConversationId=data.conversation_id;
          localStorage.setItem('GEMINI_PLUGIN_CONVERSATION_ID',data.conversation_id);
        }
        return {candidates:[{content:{parts:[{text:String(data.text||'')}]}}]};
      });
  }else responseRequest=requestJsonWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents: historyForRequest
    })
  }, GEMINI_TIMEOUT_MS);
  responseRequest.then(function(data) {
    if (generation !== requestGeneration) return;
    if (data.candidates && data.candidates.length > 0) {
      var parts = data.candidates[0].content && data.candidates[0].content.parts || [];
      var replyText = parts.map(function(part) { return part.text || ''; }).join(' ').trim();
      if (!replyText) {
        sendErrorToWatch('Gemini returned no readable text.');
        return;
      } 
      
      if(geminiBackend==='direct'){
        conversationHistory = trimConversationHistory(historyForRequest.concat([{ role: "model", parts: [{ text: replyText }] }]));
        localStorage.setItem("CHAT_HISTORY", JSON.stringify(conversationHistory));
      }  

      var cmd = skipAudio ? 'TEXT_RESPONSE_NO_AUDIO' : 'TEXT_RESPONSE_8_16';

      // UTF-8-aware limit: watch inbox is only 1024 bytes including tuple overhead.
      var displayText = '', bytes = 0;
      for (var i = 0; i < replyText.length; i++) {
        var c = replyText.charCodeAt(i), size = c < 128 ? 1 : (c < 2048 ? 2 : 3);
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < replyText.length && replyText.charCodeAt(i + 1) >= 0xDC00 && replyText.charCodeAt(i + 1) <= 0xDFFF) {
          if (bytes + 4 > 700) break;
          displayText += replyText.substr(i, 2); bytes += 4; i++; continue;
        }
        if (bytes + size > 700) break;
        displayText += replyText.charAt(i); bytes += size;
      }
      // Start audio only once the watch has accepted its new answer/session.
      var textPayload = { 'COMMAND': cmd, 'TEXT': displayText, 'STREAM_ID': streamId };
      function startAnswer() {
        if (generation !== requestGeneration || skipAudio) return;
        var rawSentences = replyText.match(/[^.!?]+[.!?]*/g) || [replyText];
        sentenceQueue = rawSentences.map(function(part) { return part.trim(); }).filter(function(part) { return part.length > 0; });
        startTTSFetchLoop(generation, streamId);
      }
      Pebble.sendAppMessage(textPayload, startAnswer, function(error) {
        if (generation !== requestGeneration) return;
        console.log("Text delivery failed", error);
        Pebble.sendAppMessage(textPayload, startAnswer, function() { console.log("Text retry failed"); });
      });

    } else if (data.error && data.error.message) {
      // Failed requests do not modify the committed conversation history. 
      sendErrorToWatch(apiErrorMessage(data.error, 'Gemini'));
    } else {
      sendErrorToWatch("Gemini returned no answer.");
    }
  })
  .catch(function(error) {
    if (generation !== requestGeneration) return;
    sendErrorToWatch(apiErrorMessage(error, 'Gemini'));
  });
}

// =========================================================================
// SECTION 12: AUDIO PREPARATION (8-kHz WAV PCM16 -> IMA ADPCM)
// =========================================================================

function cancelCurrentAudio() {
  requestGeneration++;
  if (activeTransfer && activeTransfer.timer) clearTimeout(activeTransfer.timer);
  activeTransfer = null;
  streamEndSent = false;
  currentAudioData = null;
  currentAudioCursor = 0;
  currentAudioSeq = 0;
  lastAckTime = 0;
  sentenceQueue = [];
  readyAudioQueue = [];
  isFetchingTTS = false;
  isSendingBLE = false;
  js_adpcm_valpred = 0;
  js_adpcm_index = 0;
}

function pcmFromWav(base64) {
  var wav = atob(base64);
  if (wav.length < 44 || wav.substr(0, 4) !== 'RIFF' || wav.substr(8, 4) !== 'WAVE') throw Error('Invalid WAV');
  function u16(p) { return wav.charCodeAt(p) | (wav.charCodeAt(p + 1) << 8); }
  function u32(p) { return (wav.charCodeAt(p) | (wav.charCodeAt(p + 1) << 8) | (wav.charCodeAt(p + 2) << 16) | (wav.charCodeAt(p + 3) << 24)) >>> 0; }
  var offset = 12, channels = 0, sampleRate = 0, bits = 0, format = 0, dataOffset = -1, dataLength = 0;
  while (offset + 8 <= wav.length) {
    var type = wav.substr(offset, 4), size = u32(offset + 4);
    var end = offset + 8 + size;
    if (end > wav.length) throw Error('Truncated WAV');
    if (type === 'fmt ') {
      if (size < 16) throw Error('Invalid WAV fmt');
      format = u16(offset + 8); channels = u16(offset + 10);
      sampleRate = u32(offset + 12); bits = u16(offset + 22);
    } else if (type === 'data') {
      dataOffset = offset + 8; dataLength = size;
      break;
    }
    offset = end + (size & 1);
  }
  if (format !== 1 || channels !== 1 || bits !== 16 || sampleRate !== 8000 || dataOffset < 0) {
    throw Error('Unsupported WAV PCM format');
  }
  var result = [];
  for (var p = dataOffset; p + 1 < dataOffset + dataLength; p += 2) {
    var value = u16(p);
    result.push(value > 32767 ? value - 65536 : value);
  }
  if (!result.length) throw Error('Empty WAV');
  return result;
}

function isInvalidVoiceError(error) {
  var message = String(error && error.message || error || '').toLowerCase();
  return message.indexOf('voice') >= 0 &&
    (message.indexOf('does not exist') >= 0 ||
     message.indexOf('not found') >= 0 ||
     message.indexOf('invalid') >= 0 ||
     message.indexOf('misspelled') >= 0);
}

function startTTSFetchLoop(generation, streamId) {
  if (generation !== requestGeneration || isFetchingTTS || !sentenceQueue.length) return;
  isFetchingTTS = true;
  var sentence = sentenceQueue.shift();
  if(ttsBackend==='plugin'){
    // HA-compatible WAV chunks, transported through the existing Gemini
    // watch ACK/SEQ protocol. Never use HA AUDIO_RESET on this watch.
    googleTtsStream.stream(sentence,{
      cancelled:function(){return generation!==requestGeneration;},
      onChunk:function(bytes,last,total){
        return new Promise(function(resolve,reject){
          function queueWhenReady(){
            if(generation!==requestGeneration){reject(Error('Cancelled'));return;}
            if(readyAudioQueue.length>=6){setTimeout(queueWhenReady,35);return;}
            readyAudioQueue.push({bytes:bytes,sentenceEnd:last,sentenceTotal:total});
            if(!isSendingBLE)startBLESendLoop(generation,streamId);
            resolve();
          }
          queueWhenReady();
        });
      }
    }).then(function(){
      if(generation!==requestGeneration)return;
      isFetchingTTS=false;
      startTTSFetchLoop(generation,streamId);
      maybeFinishAudioStream(generation,streamId);
    }).catch(function(error){
      if(generation!==requestGeneration)return;
      console.log('Google TTS plugin audio failed:',String(error&&error.message||error));
      cancelCurrentAudio();
      Pebble.sendAppMessage({COMMAND:'AUDIO_ERROR',STREAM_ID:streamId});
    });
    return;
  }
  var url = 'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + ttsApiKey;
  var primaryVoice = normalizeTtsVoice(ttsVoice);
  var fallbackVoice = "en-US-Wavenet-F";

  function synthesize(voiceName, fallbackAttempt) {
    var audioConfig = { audioEncoding: 'LINEAR16', sampleRateHertz: 8000 };
    // Chirp 3 HD does not support the standard speakingRate audioConfig field.
    if (voiceName.indexOf('-Chirp3-HD-') < 0) audioConfig.speakingRate = 0.92;
    return requestJsonWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: sentence },
        voice: { languageCode: 'en-US', name: voiceName },
        audioConfig: audioConfig
      })
    }, TTS_TIMEOUT_MS).then(function(data) {
      if (generation !== requestGeneration) return;
      if (!data.audioContent) {
        var apiError = new Error(data.error && data.error.message || 'No TTS audio');
        if (!fallbackAttempt && voiceName !== fallbackVoice && isInvalidVoiceError(apiError)) {
          console.log('Invalid selected voice; retrying with WaveNet-F');
          ttsVoice = fallbackVoice;
          localStorage.setItem("TTS_VOICE", fallbackVoice);
          return synthesize(fallbackVoice, true);
        }
        throw apiError;
      }
      var pcm = pcmFromWav(data.audioContent);
      if (generation !== requestGeneration) return;
      readyAudioQueue.push(encodeADPCM(lowPassFilter(pcm)));
      isFetchingTTS = false;
      if (!isSendingBLE) startBLESendLoop(generation, streamId);
      startTTSFetchLoop(generation, streamId);
      maybeFinishAudioStream(generation, streamId);
    });
  }

  synthesize(primaryVoice, false).catch(function(error) {
    if (generation !== requestGeneration) return;
    isFetchingTTS = false;
    console.log('TTS failed:', apiErrorMessage(error, 'TTS'));
    // Stop speech, but leave the successfully displayed answer intact.
    cancelCurrentAudio();
    Pebble.sendAppMessage({ COMMAND:'AUDIO_ERROR', STREAM_ID:streamId });
  });
}

// =========================================================================
// SECTION 13: STOP-AND-WAIT AUDIO DELIVERY WITH WATCH-LEVEL ACKNOWLEDGMENTS
// =========================================================================

// The watch reports bytes currently free in its playback ring. Transport
// success alone does not acknowledge audio reception; only AUDIO_ACK does.
function sendPendingPacket(transfer) {
  if (transfer.generation !== requestGeneration || activeTransfer !== transfer) return;
  if (transfer.timer) clearTimeout(transfer.timer);
  transfer.attempts++;
  if (transfer.attempts > MAX_BLE_RETRIES) {
    console.log('Audio stopped: retry limit reached at packet ' + transfer.seq);
    cancelCurrentAudio();
    Pebble.sendAppMessage({ COMMAND:'AUDIO_ERROR', STREAM_ID:transfer.streamId });
    return;
  }
  var payload = {
    COMMAND: transfer.final ? 'AUDIO_STREAM_END' : (transfer.end ? 'AUDIO_SENTENCE_END' : 'AUDIO_CHUNK'),
    STREAM_ID: transfer.streamId,
    SEQ: transfer.seq
  };
  if (!transfer.end && !transfer.final) {
    payload.CHUNK = transfer.chunk;
    payload.SENTENCE_TOTAL = transfer.total;
    payload.BUFFER_HINT = Math.round(rateBytesPerSecond);
  }
  Pebble.sendAppMessage(payload, function() {}, function(error) {
    if (transfer.generation !== requestGeneration || activeTransfer !== transfer) return;
    console.log('Transport retry', error);
  });
  transfer.timer = setTimeout(function() { sendPendingPacket(transfer); }, ACK_TIMEOUT_MS);
}

function handleAudioAck(dict) {
  var t = activeTransfer;
  if (!t || t.generation !== requestGeneration) return;
  if (Number(dict.STREAM_ID) !== t.streamId || Number(dict.SEQ) !== t.seq) return;
  if (t.timer) { clearTimeout(t.timer); t.timer = null; }
  if (dict.COMMAND === 'AUDIO_WAIT') {
    // Bound a hardware or connection fault that never frees its ring buffer.
    t.waits = (t.waits || 0) + 1;
    if (t.waits > 75) {
      console.log('Audio buffer did not drain');
      cancelCurrentAudio();
      Pebble.sendAppMessage({ COMMAND:'AUDIO_ERROR', STREAM_ID:t.streamId });
      return;
    }
    t.attempts = 0;
    t.timer = setTimeout(function() { sendPendingPacket(t); }, 180);
    return;
  }
  var now = Date.now();
  if (lastAckTime && !t.end && !t.final && t.attempts === 1) {
    var measured = t.chunk.length * 1000 / Math.max(30, now - lastAckTime);
    rateBytesPerSecond = Math.max(1000, Math.min(12000, 0.8 * rateBytesPerSecond + 0.2 * measured));
  }
  lastAckTime = now;
  activeTransfer = null;
  if (t.final) {
    currentAudioSeq++;
    streamEndSent = true;
    isSendingBLE = false;
  } else if (t.end) {
    currentAudioSeq++;
    isSendingBLE = false;
    startBLESendLoop(t.generation, t.streamId);
  } else {
    currentAudioCursor += t.chunk.length;
    currentAudioSeq++;
    dispatchNextAudio(t.generation, t.streamId);
  }
}

var currentAudioData = null;
var currentAudioCursor = 0;
var currentAudioSeq = 0;
var currentAudioEndSentence=true;
var currentAudioSentenceTotal=0;

function maybeFinishAudioStream(generation, streamId) {
  if (generation !== requestGeneration || streamEndSent || activeTransfer ||
      isSendingBLE || isFetchingTTS || sentenceQueue.length || readyAudioQueue.length) return;
  // Explicit final marker: a sentence end is NOT the end of the response.
  // Keep the speaker active while synthesizing/streaming later sentences.
  isSendingBLE = true;
  activeTransfer = {
    generation: generation, streamId: streamId,
    seq: currentAudioSeq, chunk: null, end: false, final: true,
    attempts: 0, timer: null
  };
  sendPendingPacket(activeTransfer);
}

function startBLESendLoop(generation, streamId) {
  if (generation !== requestGeneration || isSendingBLE) return;
  if (!readyAudioQueue.length) {
    maybeFinishAudioStream(generation, streamId);
    return;
  }
  isSendingBLE = true;
  lastAckTime = 0; // Do not mistake a gap between TTS sentences for slow BLE.
  var segment=readyAudioQueue.shift();
  currentAudioData=Array.isArray(segment)?segment:segment.bytes;
  currentAudioEndSentence=Array.isArray(segment)||segment.sentenceEnd===true;
  currentAudioSentenceTotal=Array.isArray(segment)?currentAudioData.length:segment.sentenceTotal;
  currentAudioCursor = 0;
  dispatchNextAudio(generation, streamId);
}

function dispatchNextAudio(generation, streamId) {
  if (generation !== requestGeneration || activeTransfer || !isSendingBLE) return;
  var remaining = currentAudioData.length - currentAudioCursor;
  var segmentEnded=remaining<=0;
  if(segmentEnded && !currentAudioEndSentence){
    // A 6000-byte verified WAV transport segment is NOT a sentence end.
    isSendingBLE=false;
    startBLESendLoop(generation,streamId);
    return;
  }
  var isEnd=segmentEnded;
  var chunk = isEnd ? null : currentAudioData.slice(currentAudioCursor, currentAudioCursor + AUDIO_PACKET_BYTES);
  activeTransfer = {
    generation: generation, streamId: streamId,
    seq: currentAudioSeq, chunk: chunk, end: isEnd, final: false, total: currentAudioSentenceTotal,
    attempts: 0, timer: null
  };
  // DATA packets tell the watch this sentence's total bytes; it can avoid
  // starting a short sentence until every byte has arrived.
  if (!isEnd) activeTransfer.total = currentAudioSentenceTotal;
  sendPendingPacket(activeTransfer);
}
