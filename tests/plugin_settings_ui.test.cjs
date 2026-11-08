'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const storage={GEMINI_BACKEND:'plugin',TTS_BACKEND:'plugin',GEMINI_API_KEY:'existing-gemini-direct',TTS_API_KEY:'existing-tts-direct'};
const listeners={},items=new Map(),events={};
function Clay(config,customizer){
  this.EVENTS={AFTER_BUILD:'afterBuild'};
  this.generateUrl=()=>'/settings';
  this.on=(name,callback)=>{events[name]=callback;};
  this.getItemByMessageKey=key=>items.get(key);
  config.forEach(section=>(section.items||[]).forEach(item=>{
    if(!item.messageKey)return;
    const state={value:item.defaultValue,visible:true,change:null};
    items.set(item.messageKey,{
      get:()=>state.value,
      show:()=>{state.visible=true;},
      hide:()=>{state.visible=false;},
      on:(type,fn)=>{if(type==='change')state.change=fn;},
      state
    });
  }));
  customizer.call(this);
  events.afterBuild();
}
function set(key,value){const item=items.get(key);assert.ok(item,key);item.state.value=value;if(item.state.change)item.state.change();}
function shown(key){const item=items.get(key);assert.ok(item,key);return item.state.visible;}
const Pebble={getActiveWatchInfo:()=>({platform:'emery'}),addEventListener:(name,fn)=>{listeners[name]=fn;},
 sendAppMessage:(value,ok)=>{if(ok)ok();},openURL:()=>{}};
const localStorage={getItem:key=>Object.prototype.hasOwnProperty.call(storage,key)?storage[key]:null,
  setItem:(k,v)=>{storage[k]=String(v);},removeItem:k=>{delete storage[k];}};
const ctx={Pebble,localStorage,Date,Math,JSON,Promise,console,atob:()=>'',setTimeout,clearTimeout,
 require:(name)=>name==='./google_tts_stream'?{create:()=>({stream:()=>Promise.resolve()})}:Clay};
const app=fs.readFileSync(path.join(root,'src/pkjs/index.js'),'utf8');
vm.runInNewContext(app,ctx);
assert.equal(shown('GEMINI_API_KEY'),false);
assert.equal(shown('GEMINI_MODEL'),false);
assert.equal(shown('TTS_API_KEY'),false);
assert.equal(shown('TTS_VOICE'),false);
assert.equal(shown('GEMINI_BACKEND'),true);
assert.equal(shown('ENABLE_TTS'),true);
assert.equal(shown('CUSTOM_PERSONA'),true);
set('GEMINI_BACKEND','direct');
assert.equal(shown('GEMINI_API_KEY'),true);
assert.equal(shown('GEMINI_MODEL'),true);
set('GEMINI_BACKEND','plugin');
assert.equal(shown('GEMINI_API_KEY'),false);
assert.equal(shown('GEMINI_MODEL'),false);
set('ENABLE_TTS',true);set('TTS_BACKEND','direct');
assert.equal(shown('TTS_API_KEY'),true);
assert.equal(shown('TTS_VOICE'),true);
set('TTS_BACKEND','plugin');
assert.equal(shown('TTS_API_KEY'),false);
assert.equal(shown('TTS_VOICE'),false);
set('TTS_BACKEND','direct');set('ENABLE_TTS',false);
assert.equal(shown('TTS_API_KEY'),false);
assert.equal(shown('TTS_VOICE'),false);
set('ENABLE_TTS',true);
assert.equal(shown('TTS_API_KEY'),true);
set('TTS_BACKEND','plugin');
listeners.webviewclosed({response:encodeURIComponent(JSON.stringify({
 GEMINI_BACKEND:{value:'plugin'},TTS_BACKEND:{value:'plugin'},
 GEMINI_API_KEY:{value:'must-not-save'},TTS_API_KEY:{value:'must-not-save'},
 GEMINI_MODEL:{value:'gemini-2.5-pro'},TTS_VOICE:{value:'en-US-Chirp3-HD-Puck'}
}))});
assert.equal(storage.GEMINI_API_KEY,'existing-gemini-direct');
assert.equal(storage.TTS_API_KEY,'existing-tts-direct');
assert.equal(storage.GEMINI_MODEL,undefined);
assert.equal(storage.TTS_VOICE,'en-US-Wavenet-F'); // App initializes the voice fallback once; hidden Clay values must not replace it.
for(const p of ['plugins/gemini-conversation/src/config.html','plugins/google-tts/src/config.html']){
 const html=fs.readFileSync(path.join(root,p),'utf8');
 assert.match(html,/class="panel"/);
 assert.match(html,/prefers-color-scheme:dark/);
 assert.match(html,/<label for="key">/);
 assert.match(html,/aria-live="polite"/);
 assert.match(html,/min-height:47px/);
}
const gemHTML=fs.readFileSync(path.join(root,'plugins/gemini-conversation/src/config.html'),'utf8');
assert.match(gemHTML,/<select id="model"/);
assert.match(gemHTML,/Refresh available models/);
assert.match(gemHTML,/1 million text-input/);
const ttsHTML=fs.readFileSync(path.join(root,'plugins/google-tts/src/config.html'),'utf8');
assert.match(ttsHTML,/<select id="voice"/);
assert.match(ttsHTML,/WaveNet/);
console.log('PASS: responsive plugin settings and live provider-dependent Clay visibility');
