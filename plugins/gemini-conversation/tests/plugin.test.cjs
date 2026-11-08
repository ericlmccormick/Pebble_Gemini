'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const storage=new Map(),secure=new Map();let action,config,source,calls=0;
const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
const Pebble={secureStorage:{getItem:async k=>secure.get(k)||null,setItem:async(k,v)=>secure.set(k,v),removeItem:async k=>secure.delete(k)},registerActionHandler:fn=>action=fn,registerConfigHandler:fn=>config=fn,registerSourceHandler:fn=>source=fn,refreshSources:()=>{}};
const fetch=async(url,options)=>{
 assert.equal(url.startsWith('https://generativelanguage.googleapis.com/v1beta/models'),true);
 assert.equal(options.headers['x-goog-api-key'],'secret');
 if(url.includes('?pageSize='))return {ok:true,json:async()=>({models:[
   {name:'models/gemini-3.8-flash',displayName:'Gemini 3.8 Flash',supportedGenerationMethods:['generateContent']},
   {name:'models/gemini-3.1-pro-preview',displayName:'Gemini 3.1 Pro',supportedGenerationMethods:['generateContent']},
   {name:'models/gemini-3.8-flash-tts',displayName:'Audio TTS',supportedGenerationMethods:['generateContent']},
   {name:'models/text-embedding-004',displayName:'Embedding',supportedGenerationMethods:['embedContent']},
   {name:'models/gemini-3.8-live',displayName:'Live audio',supportedGenerationMethods:['generateContent']}
 ]})};
 calls++;
 return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'Test reply '+calls}]}}]})};
};
vm.runInNewContext(fs.readFileSync(__dirname+'/../src/plugin/index.js','utf8'),{Pebble,localStorage,fetch,Date,Math,JSON,Promise,console});
function req(name,args){return new Promise(resolve=>action({action:name,args:args||{}},{ok:x=>resolve({ok:true,data:JSON.parse(x.text)}),error:(code,message)=>resolve({ok:false,code,message})}));}
(async()=>{let r=await req('conversation',{text:'Hello'});assert.equal(r.code,'AUTH_REQUIRED');
await config({type:'save',api_key:'secret',model:'gemini-3.8-flash'},()=>{});
let modelResult=await new Promise(resolve=>config({type:'models'},resolve));
assert.equal(modelResult.ok,true);
assert.deepEqual(Array.from(modelResult.models.map(x=>x.id)),['gemini-3.1-pro-preview','gemini-3.8-flash']);
assert.equal(modelResult.models.some(x=>x.id.includes('tts')||x.id.includes('live')),false);
assert.equal(JSON.stringify(modelResult).includes('secret'),false);
let listed=await req('list_models');assert.equal(listed.ok,true);
assert.equal(listed.data.models.length,2);
r=await req('conversation',{text:'Hello'});assert.equal(r.ok,true);assert.equal(r.data.text,'Test reply 1');let id=r.data.conversation_id;
r=await req('conversation',{text:'Again',conversation_id:id});assert.equal(r.ok,true);assert.equal(r.data.conversation_id,id);
r=await req('get_config');assert.equal(r.data.configured,true);assert.equal(r.data.model,'gemini-3.8-flash');
r=await req('clear_conversation',{conversation_id:id});assert.equal(r.ok,true);
await config({type:'forget'},()=>{});r=await req('get_config');assert.equal(r.data.configured,false);
console.log('Gemini plugin regression tests passed');})().catch(e=>{console.error(e);process.exitCode=1;});
