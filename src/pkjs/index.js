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
var geminiModel = localStorage.getItem("GEMINI_MODEL") || "gemini-3.8-flash"; 
var ttsVoice = localStorage.getItem("TTS_VOICE") || "en-US-Journey-F";        
var audioProfile = "8k-16b"; // Hardware output is 8-kHz PCM16, transmitted as 4-bit IMA ADPCM.          

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
var requestGeneration = 0;
var MAX_BLE_RETRIES = 5;
var nextStreamId = (Date.now() & 0x7fffffff) || 1;
var activeTransfer = null;
var AUDIO_PACKET_BYTES = 360; // Leaves room for command/session/sequence tuples.
var ACK_TIMEOUT_MS = 1800;
var rateBytesPerSecond = 5200; // Conservative initial link estimate.
var lastAckTime = 0;  

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
    "description": "Select the generation engine. Default is Gemini 3.8 Flash.",
    "options": [ 
      { "label": "Gemini 3.8 Flash (Default)", "value": "gemini-3.8-flash" },
      { "label": "Gemini 3.7 Flash (Alias)", "value": "gemini-3.7-flash" },
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
    "type": "text",
    "defaultValue": "Audio: 8 kHz PCM16 playback with 4-bit IMA-ADPCM streaming. The previous 16 kHz / 8-bit modes were not supported by the watch decoder."
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


    // Only process visibility if the components exist on this hardware profile
    if (ttsToggle) {
      if (ttsToggle.get()) {
        if (ttsKey) ttsKey.show();
        if (ttsVoice) ttsVoice.show();

      } else {
        if (ttsKey) ttsKey.hide(); // Hides the fields, but preserves their saved text!
        if (ttsVoice) ttsVoice.hide();

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

  if (conversationHistory.length > 6) {
    var excess = conversationHistory.length - 6;
    if (conversationHistory[excess].role === 'model') { excess++; }
    conversationHistory = conversationHistory.slice(excess);
  }

  var historyForRequest = conversationHistory.slice();
  historyForRequest.push({ role: "user", parts: [{ text: prompt }] }); 

  // DYNAMIC URL ROUTING
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + geminiModel + ":generateContent?key=" + geminiApiKey;

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents: historyForRequest 
    })
  })
  .then(function(response) {
    return response.json(); 
  })
  .then(function(data) {
    if (generation !== requestGeneration) return;
    if (data.candidates && data.candidates.length > 0) {
      var parts = data.candidates[0].content && data.candidates[0].content.parts || [];
      var replyText = parts.map(function(part) { return part.text || ''; }).join(' ').trim();
      if (!replyText) {
        sendErrorToWatch('Gemini returned no readable text.');
        return;
      } 
      
      conversationHistory = historyForRequest;
      conversationHistory.push({ role: "model", parts: [{ text: replyText }] }); 
      localStorage.setItem("CHAT_HISTORY", JSON.stringify(conversationHistory));  

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
      sendErrorToWatch("Gemini Err: " + data.error.message.substring(0, 60));
    } else {
      conversationHistory.pop();
      sendErrorToWatch("Empty Gemini response.");
    }
  })
  .catch(function() {
    if (generation !== requestGeneration) return;
    conversationHistory.pop();
    sendErrorToWatch("Network error.");
  });
}

// =========================================================================
// SECTION 12: TEXT-TO-SPEECH INTERFACE PIPELINE
// =========================================================================

// =========================================================================
// SECTION 12: AUDIO PREPARATION (8-kHz WAV PCM16 -> IMA ADPCM)
// =========================================================================

function cancelCurrentAudio() {
  requestGeneration++;
  if (activeTransfer && activeTransfer.timer) clearTimeout(activeTransfer.timer);
  activeTransfer = null;
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

function startTTSFetchLoop(generation, streamId) {
  if (generation !== requestGeneration || isFetchingTTS || !sentenceQueue.length) return;
  isFetchingTTS = true;
  var sentence = sentenceQueue.shift();
  var url = 'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + ttsApiKey;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: sentence },
      voice: { languageCode: 'en-US', name: ttsVoice },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 8000, speakingRate: 0.92 }
    })
  }).then(function(response) { return response.json(); })
  .then(function(data) {
    if (generation !== requestGeneration) return;
    if (!data.audioContent) throw Error(data.error && data.error.message || 'No TTS audio');
    // Preserve ADPCM predictor state across consecutive sentences.
    var pcm = pcmFromWav(data.audioContent);
    readyAudioQueue.push(encodeADPCM(lowPassFilter(pcm)));
    isFetchingTTS = false;
    if (!isSendingBLE) startBLESendLoop(generation, streamId);
    startTTSFetchLoop(generation, streamId);
  })
  .catch(function(error) {
    if (generation !== requestGeneration) return;
    isFetchingTTS = false;
    console.log('TTS failed:', error.message || error);
    // Failed sentences are not silently skipped: stop speech, preserve text.
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
    COMMAND: transfer.end ? 'AUDIO_SENTENCE_END' : 'AUDIO_CHUNK',
    STREAM_ID: transfer.streamId,
    SEQ: transfer.seq
  };
  if (!transfer.end) {
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
    // Full buffer: do not flood the watch. Retry the same sequence after playback drains.
    t.attempts = 0;
    t.timer = setTimeout(function() { sendPendingPacket(t); }, 180);
    return;
  }
  var now = Date.now();
  if (lastAckTime && !t.end && t.attempts === 1) {
    var measured = t.chunk.length * 1000 / Math.max(30, now - lastAckTime);
    rateBytesPerSecond = Math.max(1000, Math.min(12000, 0.8 * rateBytesPerSecond + 0.2 * measured));
  }
  lastAckTime = now;
  activeTransfer = null;
  if (t.end) {
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
var currentAudioEndPending = false;

function startBLESendLoop(generation, streamId) {
  if (generation !== requestGeneration || isSendingBLE || !readyAudioQueue.length) return;
  isSendingBLE = true;
  currentAudioData = readyAudioQueue.shift();
  currentAudioCursor = 0;
  currentAudioEndPending = false;
  dispatchNextAudio(generation, streamId);
}

function dispatchNextAudio(generation, streamId) {
  if (generation !== requestGeneration || activeTransfer || !isSendingBLE) return;
  var remaining = currentAudioData.length - currentAudioCursor;
  var isEnd = remaining <= 0;
  var chunk = isEnd ? null : currentAudioData.slice(currentAudioCursor, currentAudioCursor + AUDIO_PACKET_BYTES);
  activeTransfer = {
    generation: generation, streamId: streamId,
    seq: currentAudioSeq, chunk: chunk, end: isEnd, total: currentAudioData.length,
    attempts: 0, timer: null
  };
  // DATA packets tell the watch this sentence's total bytes; it can avoid
  // starting a short sentence until every byte has arrived.
  if (!isEnd) activeTransfer.total = currentAudioData.length;
  sendPendingPacket(activeTransfer);
}
