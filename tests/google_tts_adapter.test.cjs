'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const script=fs.readFileSync(__dirname+'/../src/pkjs/google_tts_stream.js','utf8');
function fixture(corrupt){
  const wav=Buffer.alloc(44+22000);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);
  wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);
  wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(22000,40);
  for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(Math.round(9000*Math.sin(i/41)),i);
  function hash(bytes){let h=2166136261>>>0;for(const b of bytes)h=Math.imul((h^b)>>>0,16777619)>>>0;return h>>>0;}
  const meta={format:'pcm_s16le_wav',sample_rate:8000,channels:1,bits_per_sample:16,
    length:wav.length,sample_count:11000,chunk_bytes:6000,session_id:'ttstest123',
    wav_checksum:hash(wav),first_chunk:wav.subarray(0,6000).toString('base64'),
    first_chunk_checksum:hash(wav.subarray(0,6000))};
  let released=0;
  const Pebble={invokeAction:async function(r){
    assert.equal(r.plugin,'2c5edc42-b096-4f76-b284-1f27907e6502');
    if(r.action==='tts_prepare')return {ok:true,text:JSON.stringify(meta)};
    if(r.action==='tts_chunk'){
      const bytes=wav.subarray(r.args.offset,r.args.offset+6000);
      return {ok:true,text:JSON.stringify({offset:r.args.offset,length:wav.length,
        audio:bytes.toString('base64'),checksum:hash(bytes)+(corrupt?1:0),done:r.args.offset+bytes.length===wav.length})};
    }
    if(r.action==='tts_release'){released++;return {ok:true,text:'{}'};}
    throw Error('Unexpected action');
  }};
  return {Pebble,getReleased:()=>released};
}
async function run(){
  const mod={exports:{}};vm.runInNewContext(script,{module:mod,Promise,Math,JSON,Error,Number,String,Array,Uint8Array,Date,console});
  let f=fixture(false),segments=[],start=mod.exports.create({
    Pebble:f.Pebble,encodeADPCM:pcm=>new Array(Math.ceil(pcm.length/2)).fill(0)});
  await start.stream('Hello',{onChunk:(bytes,last,total)=>{segments.push({length:bytes.length,last,total});}});
  assert.equal(segments.reduce((n,x)=>n+x.length,0),5500);
  assert.equal(segments.filter(x=>x.last).length,1);
  assert.equal(segments[0].total,5500);
  assert.equal(f.getReleased(),1);
  f=fixture(true);start=mod.exports.create({Pebble:f.Pebble,encodeADPCM:pcm=>new Array(Math.ceil(pcm.length/2)).fill(0)});
  await assert.rejects(start.stream('Hello',{onChunk:()=>{}}),/checksum mismatch/);
  assert.equal(f.getReleased(),1);
  console.log('Google TTS adapter verified streaming tests passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
