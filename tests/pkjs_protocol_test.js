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
    requestGeneration = 1;
    readyAudioQueue = [samples];
  },
  state: function() { return {seq:currentAudioSeq,active:activeTransfer, sending:isSendingBLE, generation:requestGeneration}; }
};`, context);
const api = context.testAPI;
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
assert.equal(api.state().sending,false);
assert.equal(api.state().active,null);

api.seed([1,2,3]);
api.start(1,315);
const oldSeq = api.state().active.seq;
api.cancel();
api.ack({COMMAND:'AUDIO_ACK', STREAM_ID:315, SEQ:oldSeq});
assert.equal(api.state().active,null);
assert.equal(api.state().generation,2);
console.log('PASS: WAV, ADPCM, sequencing, duplicate/old ACKs, cancellation, TTS voice migration');
