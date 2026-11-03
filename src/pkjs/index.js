// =========================================================================
// SECTION 1: LIBRARY IMPORT & INITIALIZATION
// =========================================================================

var Clay = require('pebble-clay'); 

// =========================================================================
// SECTION 2: STORAGE MEMORY RECOVERY & TOGGLE LOGIC
// =========================================================================

var geminiApiKey = localStorage.getItem("GEMINI_API_KEY") || ""; 
var ttsApiKey = localStorage.getItem("TTS_API_KEY") || "";       
var fontSize = localStorage.getItem("FONT_SIZE") || 24;          
var customPersona = localStorage.getItem("CUSTOM_PERSONA") || ""; 

// Restore dynamic dropdown configurations with updated default
var geminiModel = localStorage.getItem("GEMINI_MODEL") || "gemini-3.5-flash"; 
var ttsVoice = localStorage.getItem("TTS_VOICE") || "en-US-Journey-F";        
var audioProfile = localStorage.getItem("AUDIO_PROFILE") || "8k-16b";          

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
try {
  var storedHistory = localStorage.getItem("CHAT_HISTORY"); 
  if (storedHistory) {                                      
    conversationHistory = JSON.parse(storedHistory);        
  }
} catch (e) {
  conversationHistory = [];                                 
}

// =========================================================================
// SECTION 4: ECOSYSTEM PLATFORM DETECTION
// =========================================================================

var watchInfo = null;       
var hasSpeaker = false;     
try {
  watchInfo = Pebble.getActiveWatchInfo(); 
  if (watchInfo && watchInfo.platform) {  
    if (watchInfo.platform === 'emery' || watchInfo.platform === 'gabbro') {
      hasSpeaker = true;    
    }
  } else {
    hasSpeaker = true;      
  }
} catch (err) {
  hasSpeaker = true;        
}

// =========================================================================
// SECTION 5: STREAMING ARCHITECTURE QUEUE STATE
// =========================================================================

var sentenceQueue = [];    
var readyAudioQueue = [];  
var isFetchingTTS = false; 
var isSendingBLE = false;  

var js_adpcm_valpred = 0;  
var js_adpcm_index = 0;    

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

var apiKeysItems = [
  { "type": "heading", "defaultValue": "API Keys" }, 
  {
    "type": "text", 
    "defaultValue": "🔒 For security, your saved keys are hidden. If you previously entered and saved your keys, they are still stored on your device even though these boxes appear blank. Only enter keys here if you need to update them."
  },
  {
    "type": "text", 
    "defaultValue": "Need help getting your API keys?<br>Open this link in your phone's browser:<br><b>tinyurl.com/PebbleGemini</b>"
  },
  {
    "type": "input", 
    "messageKey": "GEMINI_API_KEY",
    "label": "Gemini API Key (Required)",
    "description": geminiApiKey ? "✅ Status: Key is saved securely on your device." : "❌ Status: No key saved. App will not function.",
    "attributes": {
      "type": "text",
      "autocorrect": "off",
      "autocapitalize": "off",
      "placeholder": geminiApiKey ? "••••••••••••••••••••" : "Paste Gemini Key Here"
    }
  }
];

if (hasSpeaker) {
  apiKeysItems.push({
    "type": "toggle", 
    "messageKey": "ENABLE_TTS",
    "label": "Enable Voice Responses (TTS)",
    "defaultValue": enableTts,
    "description": "Turn on to have Gemini speak responses. Requires a Google Cloud TTS key."
  });

  apiKeysItems.push({
    "type": "input", 
    "messageKey": "TTS_API_KEY",
    "label": "Google Cloud TTS API Key",
    "description": ttsApiKey ? "✅ Status: Key saved securely." : "ℹ️ Status: No key saved.",
    "attributes": {
      "type": "text",
      "autocorrect": "off",
      "autocapitalize": "off",
      "placeholder": ttsApiKey ? "••••••••••••••••••••" : "Paste TTS Key Here"
    }
  });
}

var advancedSettingsItems = [
  { "type": "heading", "defaultValue": "Advanced API Settings" },
  {
    "type": "select", 
    "messageKey": "GEMINI_MODEL",
    "label": "Gemini Model Version",
    "defaultValue": geminiModel,
    "description": "Select the generation engine. Default is Gemini 3.5 Flash.",
    "options": [ 
      { "label": "Gemini 3.7 Flash", "value": "gemini-3.7-flash" },
      { "label": "Gemini 3.6 Flash", "value": "gemini-3.6-flash" },
      { "label": "Gemini 3.5 Flash", "value": "gemini-3.5-flash" },
      { "label": "Gemini 3.5 Flash-Lite", "value": "gemini-3.5-flash-lite" },
      { "label": "Gemini 3.1 Pro", "value": "gemini-3.1-pro" },
      { "label": "Gemini 3.1 Flash-Lite", "value": "gemini-3.1-flash-lite" },
      { "label": "Gemini 3.0 Pro", "value": "gemini-3.0-pro" },
      { "label": "Gemini 3.0 Flash", "value": "gemini-3.0-flash" }
    ]
  }
];

if (hasSpeaker) {
  advancedSettingsItems.push({
    "type": "select", 
    "messageKey": "TTS_VOICE",
    "label": "Google TTS Voice",
    "defaultValue": ttsVoice,
    "description": "Select the assistant's voice profile. Default is Journey Female.",
    "options": [ 
      { "label": "Journey Female (Default)", "value": "en-US-Journey-F" },
      { "label": "Journey Male", "value": "en-US-Journey-D" },
      { "label": "Chirp 3 HD Female", "value": "en-US-Chirp3-HD-F" },
      { "label": "Chirp 3 HD Male", "value": "en-US-Chirp3-HD-M" },
      { "label": "Studio Female", "value": "en-US-Studio-O" },
      { "label": "Studio Male", "value": "en-US-Studio-M" },
      { "label": "Neural2 Female", "value": "en-US-Neural2-F" },
      { "label": "Neural2 Male", "value": "en-US-Neural2-D" }
    ]
  });

  advancedSettingsItems.push({
    "type": "select", 
    "messageKey": "AUDIO_PROFILE",
    "label": "Audio Stream Quality",
    "defaultValue": audioProfile,
    "description": "Note: 8kHz/16-bit is optimized for Pebble BLE bandwidth. Lowering the rate further to 8-bit will reduce delay but increase background noise.",
    "options": [
      { "label": "16kHz 16-bit (High Fidelity)", "value": "16k-16b" },
      { "label": "16kHz 8-bit", "value": "16k-8b" },
      { "label": "8kHz 16-bit (Best Stability/Default)", "value": "8k-16b" },
      { "label": "8kHz 8-bit (Lowest Delay)", "value": "8k-8b" }
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
function customClay() {
  var clayConfig = this;

  function toggleTTSVisibility() {
    var ttsToggle = clayConfig.getItemByMessageKey('ENABLE_TTS');
    var ttsKey = clayConfig.getItemByMessageKey('TTS_API_KEY');
    var ttsVoice = clayConfig.getItemByMessageKey('TTS_VOICE');
    var audioProfile = clayConfig.getItemByMessageKey('AUDIO_PROFILE');

    // Only process visibility if the components exist on this hardware profile
    if (ttsToggle) {
      if (ttsToggle.get()) {
        if (ttsKey) ttsKey.show();
        if (ttsVoice) ttsVoice.show();
        if (audioProfile) audioProfile.show();
      } else {
        if (ttsKey) ttsKey.hide(); // Hides the fields, but preserves their saved text!
        if (ttsVoice) ttsVoice.hide();
        if (audioProfile) audioProfile.hide();
      }
    }
  }

  // Hook into the after-build event to ensure DOM exists before we modify it
  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function() {
    var ttsToggle = clayConfig.getItemByMessageKey('ENABLE_TTS');
    if (ttsToggle) {
      ttsToggle.on('change', toggleTTSVisibility);
      toggleTTSVisibility(); // Force UI update immediately on page load
    }
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
  var settings = JSON.parse(decodeURIComponent(e.response)); 

  if (settings.CUSTOM_PERSONA) {
    customPersona = settings.CUSTOM_PERSONA.value;
    localStorage.setItem("CUSTOM_PERSONA", customPersona); 
  }

  if (settings.GEMINI_API_KEY && settings.GEMINI_API_KEY.value !== "") {
    geminiApiKey = settings.GEMINI_API_KEY.value;
    localStorage.setItem("GEMINI_API_KEY", geminiApiKey); 
  }

  if (settings.ENABLE_TTS !== undefined) {
    enableTts = settings.ENABLE_TTS.value;
    localStorage.setItem("ENABLE_TTS", enableTts ? "true" : "false"); 
  }

  if (settings.TTS_API_KEY !== undefined) {
    ttsApiKey = settings.TTS_API_KEY.value;
    localStorage.setItem("TTS_API_KEY", ttsApiKey); // Saves the hidden value if toggled off!
  }

  if (settings.GEMINI_MODEL) {
    geminiModel = settings.GEMINI_MODEL.value || "gemini-3.5-flash"; 
    localStorage.setItem("GEMINI_MODEL", geminiModel); 
  }

  if (settings.TTS_VOICE) {
    ttsVoice = settings.TTS_VOICE.value || "en-US-Journey-F"; 
    localStorage.setItem("TTS_VOICE", ttsVoice); 
  }

  if (settings.AUDIO_PROFILE) {
    audioProfile = settings.AUDIO_PROFILE.value || "8k-16b";
    localStorage.setItem("AUDIO_PROFILE", audioProfile); 
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

  if (dict.COMMAND === 'DICTATION') {
    if (!geminiApiKey) geminiApiKey = localStorage.getItem("GEMINI_API_KEY") || "";
    if (ttsApiKey === null) ttsApiKey = localStorage.getItem("TTS_API_KEY") || "";
    enableTts = localStorage.getItem("ENABLE_TTS") === "true";

    // Strictly validate ONLY the Gemini API Key. TTS key is optional.
    if (!geminiApiKey) {
      sendErrorToWatch("Missing Gemini Key. Check settings.");
      return;
    }

    if (hasSpeaker && enableTts && !ttsApiKey) {
      sendErrorToWatch("TTS enabled but missing TTS Key.");
      return;
    }

    var skipAudio = false; 
    if (!hasSpeaker || !enableTts || !ttsApiKey) {
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

  if (conversationHistory.length > 6) {
    var excess = conversationHistory.length - 6;
    if (conversationHistory[excess].role === 'model') { excess++; }
    conversationHistory = conversationHistory.slice(excess);
  }

  conversationHistory.push({ role: "user", parts: [{ text: prompt }] }); 

  // DYNAMIC URL ROUTING
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + geminiModel + ":generateContent?key=" + geminiApiKey;

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents: conversationHistory 
    })
  })
  .then(function(response) {
    return response.json(); 
  })
  .then(function(data) {
    if (data.candidates && data.candidates.length > 0) {
      var replyText = data.candidates[0].content.parts[0].text; 
      
      conversationHistory.push({ role: "model", parts: [{ text: replyText }] }); 
      localStorage.setItem("CHAT_HISTORY", JSON.stringify(conversationHistory));  

      // Multiplex the command so the watch handles audio stream profiles dynamically
      var cmd = 'TEXT_RESPONSE_NO_AUDIO';
      if (!skipAudio) {
        cmd = 'TEXT_RESPONSE_16_16';
        if (audioProfile === "16k-8b") cmd = 'TEXT_RESPONSE_16_8';
        else if (audioProfile === "8k-16b") cmd = 'TEXT_RESPONSE_8_16';
        else if (audioProfile === "8k-8b") cmd = 'TEXT_RESPONSE_8_8';
      }

      Pebble.sendAppMessage({ 'COMMAND': cmd, 'TEXT': replyText.substring(0, 2048) }); 

      if (!skipAudio) {
        var rawSentences = replyText.match(/[^.!?]+[.!?]*/g) || [replyText]; 
        sentenceQueue = rawSentences.map(function(s) { 
          return s.trim(); 
        }).filter(function(s) { 
          return s.length > 0; 
        });
        startTTSFetchLoop(); 
      }

    } else if (data.error && data.error.message) {
      conversationHistory.pop(); 
      sendErrorToWatch("Gemini Err: " + data.error.message.substring(0, 60));
    } else {
      conversationHistory.pop();
      sendErrorToWatch("Empty Gemini response.");
    }
  })
  .catch(function() {
    conversationHistory.pop();
    sendErrorToWatch("Network error.");
  });
}

// =========================================================================
// SECTION 12: TEXT-TO-SPEECH INTERFACE PIPELINE
// =========================================================================

function startTTSFetchLoop() {
  if (isFetchingTTS || sentenceQueue.length === 0) return; 
  isFetchingTTS = true; 

  var sentence = sentenceQueue.shift(); 
  var url = "https://texttospeech.googleapis.com/v1/text:synthesize?key=" + ttsApiKey;

  var is16kHz = audioProfile.indexOf("16k") === 0;

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: sentence },
      voice: { languageCode: 'en-US', name: ttsVoice }, 
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: is16kHz ? 16000 : 8000, speakingRate: 0.92 } 
    })
  })
  .then(function(response) {
    return response.json();
  })
  .then(function(data) {
    if (data.audioContent) {
      var decoded = atob(data.audioContent); 
      var pcm16 = []; 

      for (var i = 44; i < decoded.length; i += 2) {
        var low = decoded.charCodeAt(i);
        var high = decoded.charCodeAt(i + 1);
        var sample16 = (high << 8) | low; 
        if (sample16 > 32767) { sample16 -= 65536; } 
        pcm16.push(sample16);
      }

      pcm16 = lowPassFilter(pcm16);     
      var adpcmBytes = encodeADPCM(pcm16); 
      
      readyAudioQueue.push(adpcmBytes); 
    }
    
    isFetchingTTS = false; 
    
    if (!isSendingBLE) {
        startBLESendLoop(); 
    }
    
    startTTSFetchLoop(); 
  })
  .catch(function(err) {
    console.log('TTS Error', err);
    isFetchingTTS = false;
    startTTSFetchLoop();
  });
}

// =========================================================================
// SECTION 13: BLUETOOTH PACKET DISPATCH ENGINE
// =========================================================================

function startBLESendLoop() {
  if (isSendingBLE) return; 
  if (readyAudioQueue.length === 0) return; 
  
  isSendingBLE = true; 
  var adpcmBytes = readyAudioQueue.shift(); 
  var cursor = 0; 

  function sendNextChunk() {
    var previousCursor = cursor; 
    var chunk = [];              
    var chunkSize = 700;         

    for (var i = 0; i < chunkSize && cursor < adpcmBytes.length; i++, cursor++) {
      chunk.push(adpcmBytes[cursor]); 
    }

    if (chunk.length > 0) {
      Pebble.sendAppMessage(
        { 'COMMAND': 'AUDIO_CHUNK', 'CHUNK': chunk },
        function success() { setTimeout(sendNextChunk, 60); }, 
        function failure() { cursor = previousCursor; setTimeout(sendNextChunk, 200); } 
      );
    } else {
      Pebble.sendAppMessage(
        { 'COMMAND': 'AUDIO_SENTENCE_END' },
        function() { 
            isSendingBLE = false; 
            setTimeout(startBLESendLoop, 120); 
        },
        function() { 
            isSendingBLE = false;
            setTimeout(startBLESendLoop, 300); 
        }
      );
    }
  }
  sendNextChunk(); 
}