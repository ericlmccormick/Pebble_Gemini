'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const store=new Map(),secure=new Map();let action,config;
const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
const Pebble={secureStorage:{getItem:async k=>secure.get(k)||null,setItem:async(k,v)=>secure.set(k,v),removeItem:async k=>secure.delete(k)},registerActionHandler:fn=>action=fn,registerConfigHandler:fn=>config=fn};
const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
const fetch=async(u,o)=>({ok:true,json:async()=>({audioContent:wav.toString('base64')})});
vm.runInNewContext(fs.readFileSync(__dirname+'/../src/plugin/index.js','utf8'),{Pebble,localStorage,fetch,Date,Math,JSON,Promise,console,Uint8Array,Int16Array,ArrayBuffer,DataView,setTimeout,Number,Error,RegExp});
function req(name,args){return new Promise(resolve=>action({action:name,args:args||{}},{ok:x=>resolve({ok:true,data:JSON.parse(x.text)}),error:(code,message)=>resolve({ok:false,code,message})}));}
(async()=>{let r=await req('tts_prepare',{text:'Hello'});assert.equal(r.code,'AUTH_REQUIRED');
await config({type:'save',api_key:'secret',voice:'en-US-Wavenet-F'},()=>{});
r=await req('tts_prepare',{text:'Hello'});assert.equal(r.ok,true);assert.equal(r.data.sample_rate,8000);assert.equal(r.data.chunk_bytes,6000);
const id=r.data.session_id,total=r.data.length;let bytes=0;
for(let p=0;p<total;p+=6000){const z=await req('tts_chunk',{session_id:id,offset:p});assert.equal(z.ok,true);bytes+=Buffer.from(z.data.audio,'base64').length;}
assert.equal(bytes,total);r=await req('tts_release',{session_id:id});assert.equal(r.ok,true);
r=await req('tts_chunk',{session_id:id,offset:0});assert.equal(r.ok,false);
r=await req('tts_prepare',{test_tone:true});assert.equal(r.ok,true);
console.log('Google TTS plugin regression tests passed');})().catch(e=>{console.error(e);process.exitCode=1;});
