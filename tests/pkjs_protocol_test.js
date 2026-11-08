// Run: node tests/pkjs_protocol_test.js
// Dependency-free regression checks for the PebbleKit JS transport.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const sent = [];
const storage = {};
const scheduled = [];
const listeners = {};
const Pebble = {
  getActiveWatchInfo: () => ({ platform: 'emery' }),
  addEventListener: (name, callback) => { listeners[name] = callback; },
  sendAppMessage: (payload, success) => { sent.push(payload); if (success) success(); },
  openURL: () => {}
};
function Clay() {}
Clay.prototype.generateUrl = () => '';
const context = {
  Pebble,
  localStorage: {
    getItem: key => Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null,
    setItem: (key, value) => { storage[key] = String(value); },
    removeItem: key => { delete storage[key]; }
  },
  require: id => id === './google_tts_stream' ? {create: () => ({stream: () => Promise.resolve()})} : id==='./agent_plugins'?require('../src/pkjs/agent_plugins'):Clay,
  console,
  Date,
  atob: text => Buffer.from(text, 'base64').toString('binary'),
  setTimeout: (fn, delay) => { const job = { fn, delay, canceled: false }; scheduled.push(job); return job; },
  clearTimeout: job => { if (job) job.canceled = true; },
  fetch: () => Promise.reject(Error('fetch must not run in protocol unit tests'))
};
const program = fs.readFileSync(path.join(__dirname, '..', 'src', 'pkjs', 'index.js'), 'utf8');
vm.runInNewContext(program + `
this.testAPI = {
  adpcm: encodeADPCM,
  wav: pcmFromWav,
  start: startBLESendLoop,
  ack: handleAudioAck,
  cancel: cancelCurrentAudio,
  seed: function(samples) {
    cancelCurrentAudio();
    requestGeneration = 1;
    readyAudioQueue = [samples];
  },
  enqueue: function(samples) { readyAudioQueue.push(samples); },
  state: function() { return {seq:currentAudioSeq,active:activeTransfer, sending:isSendingBLE, generation:requestGeneration}; }
};`, context);
const api = context.testAPI;
assert.equal(context.platformHasSpeaker('emery'), true, 'Time 2 should retain spoken responses');
assert.equal(context.platformHasSpeaker('gabbro'), false, 'Round 2 must stay text-only');
assert.equal(context.platformHasSpeaker('basalt'), false);
assert.equal(context.platformHasSpeaker('chalk'), false);
assert.equal(context.platformHasSpeaker('diorite'), false);
assert.equal(context.platformHasSpeaker('flint'), true, 'Pebble 2 Duo has a speaker');
assert.equal(context.platformHasSpeaker(undefined), false);
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const expectedPlatforms = ['basalt', 'chalk', 'diorite', 'flint', 'emery', 'gabbro'];
assert.ok(manifest.pebble.messageKeys.includes('AGENT_ICON'));
assert.ok(manifest.pebble.messageKeys.includes('AGENT_NAME'));
for(const name of ["WISP","GEMINI","OPENAI","CLAUDE","GROK","MUSE","OPENROUTER","DEEPSEEK"]){
 for(const platform of expectedPlatforms){
  assert.equal(manifest.pebble.resources.media.filter(m=>m.name==='AGENT_'+name &&
   m.targetPlatforms.includes(platform)).length,1,name+' missing on '+platform);
 }
}
assert.match(program,/action:'get_config'/);
assert.match(program,/refreshAgentInfo\(\)/);

assert.deepEqual(manifest.pebble.targetPlatforms.slice().sort(), expectedPlatforms.slice().sort(),
  'Every microphone-equipped Pebble platform must be targeted');
assert.equal(manifest.pebble.targetPlatforms.includes('aplite'), false,
  'Original Pebble has no microphone for dictation');
for (const platform of expectedPlatforms) {
  const matches = manifest.pebble.resources.media.filter(media =>
    media.name === 'IMAGE_WISP_LOGO' && media.targetPlatforms.includes(platform));
  assert.equal(matches.length, 1, platform + ' must have exactly one logo bitmap');
}
assert.equal(manifest.pebble.resources.media.some(media =>
  media.file === 'images/WISP_mono_48.png' &&
  media.targetPlatforms.includes('flint')), true, 'Flint uses the WISP monochrome logo');
assert.equal(manifest.pebble.resources.media.some(media =>
  media.file === 'images/WISP_mono_48.png' &&
  media.targetPlatforms.includes('gabbro')), true, 'Round 2 uses the WISP monochrome logo');


// Guard against the playback regression that queued silence directly
// behind newly written PCM and made small pauses (e.g. commas) choppy.
const watchC = fs.readFileSync(path.join(__dirname, '..', 'src', 'c', 'main.c'), 'utf8');
assert.match(watchC, /#define PLAYBACK_ADPCM_BYTES 160\b/, 'decode should use short 40-ms blocks');
assert.match(watchC, /#define PLAYBACK_INTERVAL_MS 35\b/, 'short refills should be paced');
assert.match(watchC, /#define SILENCE_PCM_SAMPLES 240\b/, 'silence must not accumulate faster than hardware drains');
const playbackSection = watchC.split('static void playback_timer_callback(void *data) {').pop().split('static void stop_audio() {')[0];
assert.match(playbackSection, /if \(s_pending_pcm_offset < s_pending_pcm_bytes\)[\s\S]+else if \(s_pending_pcm_offset == s_pending_pcm_bytes\)/,
  'silence must only be sent when no decoded PCM remains; compressed bytes may be gated for next sentence');
assert.doesNotMatch(playbackSection, /s_buffer_count >= PLAYBACK_ADPCM_BYTES[\s\S]+s_sentence_ended \?/, 
  'small buffered audio tails must play before a sentence-end marker');
// Sentence-gate regression: subsequent sentences require their own reservoir,
// independent of the first sentence and without cycling the amplifier.
assert.match(watchC, /#define SENTENCE_QUEUE_SIZE 32\b/);
assert.match(watchC, /static bool sentence_ready\(AudioSentence \*sentence\)/);
assert.match(watchC, /s_received_audio_bytes - sentence->start/);
assert.match(watchC, /unplayed >= sentence->start_threshold \|\| stored == total/);
assert.match(playbackSection, /AudioSentence \*sentence = active_sentence\(\)/);
assert.match(playbackSection, /sentence && sentence_ready\(sentence\)/);
assert.match(playbackSection, /remaining_in_sentence = sentence->end - s_consumed_audio_bytes/);
assert.doesNotMatch(playbackSection, /speaker_stream_close\(\)/,
  'normal sentence transitions must not power down the amplifier');

// Model the boundary math for two prefetched sentences: first sentence
// may already be consumed, but the next one must wait for its own data.
function gatedSentenceReady(start, end, threshold, received, consumed) {
  const stored = Math.min(end - start, Math.max(0, received - start));
  const used = Math.max(0, consumed - start);
  const unplayed = Math.max(0, stored - used);
  return unplayed >= threshold || stored === end - start;
}
assert.equal(gatedSentenceReady(0, 4800, 3000, 4800, 0), true);
assert.equal(gatedSentenceReady(4800, 12800, 3600, 5200, 4800), false,
  '400 bytes of second sentence cannot start despite 4800 bytes already played');
assert.equal(gatedSentenceReady(4800, 12800, 3600, 8400, 4800), true,
  'second sentence starts once its own 3600-byte reserve arrives');
assert.equal(gatedSentenceReady(4800, 6000, 1200, 6000, 4800), true,
  'short sentences start as soon as their entire audio is buffered');
assert.equal(context.normalizeTtsVoice('en-US-Chirp3-HD-F'), 'en-US-Chirp3-HD-Kore');
assert.equal(context.normalizeTtsVoice('en-US-Chirp3-HD-M'), 'en-US-Chirp3-HD-Charon');
assert.equal(context.normalizeTtsVoice('en-US-Neural2-F'), 'en-US-Neural2-F');
assert.equal(context.normalizeTtsVoice('en-US-Studio-O'), 'en-US-Wavenet-F');
assert.equal(context.normalizeTtsVoice('en-US-Studio-M'), 'en-US-Wavenet-D');
assert.equal(context.normalizeTtsVoice('en-US-Journey-F'), 'en-US-Wavenet-F');
assert.equal(context.normalizeTtsVoice('en-US-Wavenet-D'), 'en-US-Wavenet-D');
assert.equal(context.isInvalidVoiceError(Error("Voice 'en-US-Chirp3-HD-F' does not exist. Is it misspelled?")), true);

assert.equal(api.adpcm([0, 1200, -1200, 1000]).length, 2, 'ADPCM is 4 bits/sample');
const wav = Buffer.alloc(44 + 8);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(8, 40);
[1000,-1000,100,-100].forEach((v,i) => wav.writeInt16LE(v,44+i*2));
assert.deepEqual(Array.from(api.wav(wav.toString('base64'))), [1000,-1000,100,-100]);
assert.throws(() => api.wav('bad'), /Invalid WAV/);

api.seed(Array.from({length:800},(_,i)=>i%256));
api.start(1,314);
assert.equal(sent[0].CHUNK.length, 360);
assert.equal(sent[0].SEQ, 0);
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:314, SEQ:22}); // future ACK ignored
assert.equal(sent.length,1);
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:314, SEQ:0});
assert.equal(sent[1].CHUNK.length,360);
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:314, SEQ:0}); // duplicate ACK ignored
assert.equal(sent.length,2);
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:314, SEQ:1});
assert.equal(sent[2].CHUNK.length,80);
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:314, SEQ:2});
assert.equal(sent[3].COMMAND,'AUDIO_SENTENCE_END');
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:314, SEQ:3});
assert.equal(sent[4].COMMAND, 'AUDIO_STREAM_END', 'final marker must follow last sentence');
assert.equal(sent[4].SEQ, 4);
assert.equal(api.state().sending,true, 'final marker requires watch acknowledgment');
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:314, SEQ:4});
assert.equal(api.state().sending,false);
assert.equal(api.state().active,null);

// Two sentences: after the first boundary the phone immediately starts
// the second sentence; it only sends the final marker after both are ACKed.
api.seed(Array.from({length:20}, (_,i)=>i));
api.enqueue(Array.from({length:24}, (_,i)=>i));
const secondBegin = sent.length;
api.start(1,316);
assert.equal(sent[secondBegin].COMMAND, 'AUDIO_CHUNK');
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:316, SEQ:0});
assert.equal(sent[secondBegin + 1].COMMAND, 'AUDIO_SENTENCE_END');
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:316, SEQ:1});
assert.equal(sent[secondBegin + 2].COMMAND, 'AUDIO_CHUNK');
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:316, SEQ:2});
assert.equal(sent[secondBegin + 3].COMMAND, 'AUDIO_SENTENCE_END');
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:316, SEQ:3});
assert.equal(sent[secondBegin + 4].COMMAND, 'AUDIO_STREAM_END');
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:316, SEQ:4});
assert.equal(api.state().sending, false);

api.seed([1,2,3]);
api.start(1,315);
const oldSeq = api.state().active.seq;
api.cancel();
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:315, SEQ:oldSeq});
assert.equal(api.state().active,null);
assert.equal(api.state().generation,2);
// Release-hardening tests: bounded storage, settings reset, error classification,
// timeout handling, and continued access to saved API keys.
const pair = text => [
  { role: 'user', parts: [{ text: text }] },
  { role: 'model', parts: [{ text: text + ' response' }] }
];
let history = [];
for (let i = 0; i < 10; i++) history = history.concat(pair('question '+i));
const trimmed = context.trimConversationHistory(history);
assert.equal(trimmed.length, 6);
assert.equal(trimmed[0].parts[0].text, 'question 7');
assert.equal(context.trimConversationHistory([{role:'user',parts:[{text:'unpaired'}]}]).length, 0);
assert.equal(context.trimConversationHistory('garbled').length, 0);
const previousSettings = {GEMINI_API_KEY:'key-one', TTS_API_KEY:'key-two', CHAT_HISTORY:JSON.stringify(trimmed)};
Object.assign(storage, previousSettings);
listeners.webviewclosed({
  response: encodeURIComponent(JSON.stringify({
    CLEAR_HISTORY: {value:true},
    FONT_SIZE: {value:24}
  }))
});
assert.equal(storage.CHAT_HISTORY, '[]');
assert.equal(storage.GEMINI_API_KEY, 'key-one');
assert.equal(storage.TTS_API_KEY, 'key-two');
assert.equal(context.apiErrorMessage(Error('Request timed out'), 'Gemini'), 'Gemini timed out. Try again.');
assert.match(context.apiErrorMessage(Error('HTTP 429 quota'), 'Gemini'), /usage limit/);
assert.match(context.apiErrorMessage(Error('unauthenticated'), 'Gemini'), /key\/access/);

async function checkNetwork() {
  context.fetch = () => Promise.resolve({ ok:true, json:()=>Promise.resolve({answer:'ok'}) });
  const ok = await context.requestJsonWithTimeout('test', {}, 1000);
  assert.equal(ok.answer, 'ok');
  context.fetch = () => new Promise(()=>{});
  const pending = context.requestJsonWithTimeout('test', {}, 1000);
  const job = scheduled[scheduled.length - 1];
  job.fn();
  await assert.rejects(pending, /timed out/);
  console.log('PASS: WAV, ADPCM, protocol, final stream marker, voice migration, history privacy, timeouts, settings');
}
checkNetwork().catch(error => { console.error(error); process.exitCode = 1; });

// Regression: new installs favor both plugins; old disabled speech migrates to None.
assert.equal(context.geminiBackend,'agent:2c5edc42-b096-4f76-b284-1f27907e6501');
assert.equal(context.ttsBackend,'plugin');
assert.equal(storage.TTS_BACKEND,'plugin');
assert.equal(storage.TTS_PROVIDER_MIGRATED_V2,'true');
function migrateTest(saved){
 const local=Object.assign({},saved);
 const providerFn=program.slice(program.indexOf('function migrateSpeechProvider(){'),program.indexOf('var ttsBackend=migrateSpeechProvider();')+'var ttsBackend=migrateSpeechProvider();'.length);
 const target={localStorage:{getItem:k=>Object.prototype.hasOwnProperty.call(local,k)?local[k]:null,setItem:(k,v)=>{local[k]=String(v);}}};
 vm.runInNewContext('var ttsApiKey='+JSON.stringify(saved.TTS_API_KEY||'')+';'+providerFn,target);
 return target.ttsBackend;
}
assert.equal(migrateTest({}), 'plugin');
assert.equal(migrateTest({TTS_API_KEY:'old-key'}), 'direct');
assert.equal(migrateTest({ENABLE_TTS:'false',TTS_BACKEND:'plugin'}), 'none');
assert.equal(migrateTest({ENABLE_TTS:'true',TTS_BACKEND:'direct'}), 'direct');
assert.equal(migrateTest({ENABLE_TTS:'false',TTS_BACKEND:'plugin',TTS_PROVIDER_MIGRATED_V2:'true'}), 'plugin');
console.log('PASS: new-install plugin defaults and one-time speech-toggle migration');
