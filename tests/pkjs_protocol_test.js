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
    setItem: (key, value) => { storage[key] = String(value); }
  },
  require: () => Clay,
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
// Guard against the playback regression that queued silence directly
// behind newly written PCM and made small pauses (e.g. commas) choppy.
const watchC = fs.readFileSync(path.join(__dirname, '..', 'src', 'c', 'main.c'), 'utf8');
assert.match(watchC, /#define PLAYBACK_ADPCM_BYTES 160\b/, 'decode should use short 40-ms blocks');
assert.match(watchC, /#define PLAYBACK_INTERVAL_MS 35\b/, 'short refills should be paced');
assert.match(watchC, /#define SILENCE_PCM_SAMPLES 240\b/, 'silence must not accumulate faster than hardware drains');
const playbackSection = watchC.split('static void playback_timer_callback(void *data) {').pop().split('static void stop_audio() {')[0];
assert.match(playbackSection, /if \(s_pending_pcm_offset < s_pending_pcm_bytes\)[\s\S]+else if \(s_buffer_count == 0\)/,
  'silence should only be written on truly empty playback ticks');
assert.doesNotMatch(playbackSection, /s_buffer_count >= PLAYBACK_ADPCM_BYTES[\s\S]+s_sentence_ended \?/, 
  'small buffered audio tails must play before a sentence-end marker');
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
