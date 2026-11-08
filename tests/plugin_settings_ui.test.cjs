'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const storage={GEMINI_BACKEND:'plugin',TTS_BACKEND:'plugin',GEMINI_API_KEY:'existing-gemini-direct',TTS_API_KEY:'existing-tts-direct'};
const listeners={},items=new Map(),events={};
function Clay(config,customizer){
  this.EVENTS={AFTER_BUILD:'afterBuild'};
  this.generateUrl=()=>'/settings';
  this.setSettings=changes=>{
    const saved=JSON.parse(storage['clay-settings']||'{}');
    Object.assign(saved,changes);
    storage['clay-settings']=JSON.stringify(saved);
  };
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
  // Simulate Clay's real toSource/customFn behavior: execute in its OWN
  // webview JS context, not in PebbleKit JS where backend globals exist.
  vm.runInNewContext('(' + customizer.toString() + ')', {}).call(this);
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
// A stale Clay settings snapshot must not override the actual selected plugins.
storage['clay-settings']=JSON.stringify({
  GEMINI_BACKEND:'direct', TTS_BACKEND:'direct', ENABLE_TTS:true,
  GEMINI_MODEL:'gemini-2.5-pro', TTS_VOICE:'en-US-Neural2-C'
});
listeners.showConfiguration();
const synced=JSON.parse(storage['clay-settings']);
assert.equal(synced.GEMINI_BACKEND,'plugin');
assert.equal(synced.TTS_BACKEND,'plugin');
assert.equal(synced.GEMINI_MODEL,'gemini-3.8-flash');
assert.equal(synced.TTS_VOICE,'en-US-Wavenet-F');
assert.equal(shown('GEMINI_API_KEY'),false);
assert.equal(shown('GEMINI_MODEL'),false);
assert.equal(shown('TTS_API_KEY'),false);
assert.equal(shown('TTS_VOICE'),false);
assert.equal(shown('GEMINI_BACKEND'),true);
assert.equal(items.has('ENABLE_TTS'),false);
assert.equal(shown('CUSTOM_PERSONA'),true);
set('GEMINI_BACKEND','direct');
assert.equal(shown('GEMINI_API_KEY'),true);
assert.equal(shown('GEMINI_MODEL'),true);
set('GEMINI_BACKEND','plugin');
assert.equal(shown('GEMINI_API_KEY'),false);
assert.equal(shown('GEMINI_MODEL'),false);
set('TTS_BACKEND','direct');
assert.equal(shown('TTS_API_KEY'),true);
assert.equal(shown('TTS_VOICE'),true);
set('TTS_BACKEND','plugin');
assert.equal(shown('TTS_API_KEY'),false);
assert.equal(shown('TTS_VOICE'),false);
set('TTS_BACKEND','none');
assert.equal(shown('TTS_API_KEY'),false);
assert.equal(shown('TTS_VOICE'),false);
set('TTS_BACKEND','direct');
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
assert.equal(storage.TTS_VOICE,'en-US-Wavenet-F');
assert.equal(storage.TTS_BACKEND,'plugin');
assert.equal(storage.TTS_PROVIDER_MIGRATED_V2,'true');
assert.doesNotMatch(app,/messageKey:['"]ENABLE_TTS['"]/);
assert.match(app,/value:'none'/);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const permissions=manifest.pebble.usesPermissions||[];
assert.ok(permissions.some(p=>p.plugin==='2c5edc42-b096-4f76-b284-1f27907e6501'&&p.name==='GeminiConverse'));
assert.ok(permissions.some(p=>p.plugin==='2c5edc42-b096-4f76-b284-1f27907e6502'&&p.name==='GoogleTtsSpeak'));
console.log('PASS: isolated Clay webview, legacy/plugin switching, persisted provider sync, and stable plugin permissions');
