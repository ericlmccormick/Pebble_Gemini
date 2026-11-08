/* Gemini Conversation bridge for Pebble plugin API v2.
 * One plugin action per invocation: store conversation context in localStorage.
 * API key lives only in Pebble.secureStorage. No credentials returned.
 */
'use strict';
var KEY='gemini_conversation_api_key_v1';
var MODEL='gemini_conversation_model_v1';
var LIST='gemini_conversation_sessions_v1';
var DEFAULT_MODEL='gemini-3.8-flash';
var CATALOG_KEY='gemini_conversation_model_catalog_v1';
var CATALOG_TTL_MS=6*60*60*1000;
var MODEL_EXCLUDE=/(?:-image(?:-|$)|-tts(?:-|$)|-live(?:-|$)|-native-audio|-transcribe|embedding|robotics|-computer-use|-omni|-video|deep-research)/i;
function callableTextModel(item){
  if(!item||typeof item.name!=='string')return null;
  var id=item.name.replace(/^models\//,'');
  var methods=item.supportedGenerationMethods||item.supported_generation_methods||[];
  if(!modelName(id)||MODEL_EXCLUDE.test(id)||methods.indexOf('generateContent')<0)return null;
  return {id:id,name:String(item.displayName||id).slice(0,90),description:String(item.description||'').slice(0,180)};
}
function modelCache(){
  try{
    var c=JSON.parse(localStorage.getItem(CATALOG_KEY)||'null');
    return c&&Array.isArray(c.models)?c:null;
  }catch(e){return null;}
}
async function listModels(keyInput){
  var token=(typeof keyInput==='string'&&keyInput.trim())||await Pebble.secureStorage.getItem(KEY);
  if(!token)return fail('AUTH_REQUIRED','Enter and save a Gemini API key to list available models.');
  var byId={},page='',pages=0;
  try{
    do{
      var url='https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
      if(page)url+='&pageToken='+encodeURIComponent(page);
      var res=await fetch(url,{headers:{'x-goog-api-key':token}});
      if(!res.ok)return apiStatus(res.status);
      var data=await res.json();
      (Array.isArray(data.models)?data.models:[]).forEach(function(item){
        var model=callableTextModel(item);
        if(model)byId[model.id]=model;
      });
      page=typeof data.nextPageToken==='string'?data.nextPageToken:'';
      pages++;
    }while(page&&pages<4);
    var models=Object.keys(byId).sort().map(function(id){return byId[id];});
    if(!models.length)return fail('PLUGIN_UNAVAILABLE','No text-generation models returned for this key.');
    // Cache only catalog metadata, never keys or Google API responses with credentials.
    localStorage.setItem(CATALOG_KEY,JSON.stringify({checkedAt:Date.now(),models:models}));
    return {ok:true,data:{models:models,checkedAt:Date.now(),hasMore:!!page}};
  }catch(e){
    var cached=modelCache();
    if(cached&&Date.now()-cached.checkedAt<CATALOG_TTL_MS)
      return {ok:true,data:{models:cached.models,checkedAt:cached.checkedAt,fromCache:true}};
    return fail('PLUGIN_UNAVAILABLE','Could not retrieve Gemini models. Check connection and API permissions.');
  }
}
var MAX_PAIRS=3, MAX_CONTEXT=8000, MAX_SESSIONS=12;
function fail(code,message){return {ok:false,code:code,message:message};}
function modelName(v){return typeof v==='string'&&/^gemini-[A-Za-z0-9._-]{1,70}$/.test(v)?v:null;}
function settings(){return {model:modelName(localStorage.getItem(MODEL))||DEFAULT_MODEL};}
function validId(v){return typeof v==='string'&&/^g[a-z0-9]{6,40}$/.test(v);}
function sessionKey(id){return 'gemini_conversation_history_v1_'+id;}
function allIds(){try{var v=JSON.parse(localStorage.getItem(LIST)||'[]');return Array.isArray(v)?v.filter(validId):[];}catch(e){return [];}}
function loadHistory(id){
  if(!validId(id))return [];
  try{var v=JSON.parse(localStorage.getItem(sessionKey(id))||'[]');
    return trimHistory(v);
  }catch(e){return [];}
}
function trimHistory(items){
  if(!Array.isArray(items))return [];
  var pairs=[],output=[],count=0;
  for(var i=0;i+1<items.length;i++){
    var a=items[i],b=items[i+1];
    if(a&&b&&a.role==='user'&&b.role==='model'&&
      Array.isArray(a.parts)&&Array.isArray(b.parts)&&
      a.parts[0]&&b.parts[0]&&
      typeof a.parts[0].text==='string'&&typeof b.parts[0].text==='string'){
      pairs.push([a,b]);i++;
    }
  }
  for(var j=pairs.length-1;j>=0&&output.length<MAX_PAIRS*2;j--){
    var n=JSON.stringify(pairs[j]).length;
    if(count+n>MAX_CONTEXT)break;
    output.unshift(pairs[j][0],pairs[j][1]);count+=n;
  }
  return output;
}
function clearSession(id){
  if(!validId(id))return;
  localStorage.removeItem(sessionKey(id));
  localStorage.setItem(LIST,JSON.stringify(allIds().filter(function(x){return x!==id;})));
}
function clearAll(){
  allIds().forEach(function(id){localStorage.removeItem(sessionKey(id));});
  localStorage.removeItem(LIST);
}
function saveHistory(id,history){
  var ids=allIds().filter(function(x){return x!==id;});
  while(ids.length>=MAX_SESSIONS)localStorage.removeItem(sessionKey(ids.shift()));
  ids.push(id);
  localStorage.setItem(sessionKey(id),JSON.stringify(trimHistory(history)));
  localStorage.setItem(LIST,JSON.stringify(ids));
}
function newId(){
  return 'g'+Date.now().toString(36)+Math.floor(Math.random()*0x1000000).toString(36);
}
function apiStatus(status){
  if(status===401||status===403)return fail('AUTH_REQUIRED','Gemini API key or permission rejected. Open plugin settings.');
  if(status===429)return fail('RATE_LIMITED','Gemini rate or quota limit reached.');
  if(status===400)return fail('INVALID_ARGS','Gemini rejected the request or model; review plugin settings.');
  return fail('PLUGIN_UNAVAILABLE','Gemini HTTP '+status);
}
async function conversation(args){
  if(typeof args.text!=='string'||!args.text.trim()||args.text.length>4000)
    return fail('INVALID_ARGS','Text must contain 1–4000 characters.');
  if(args.instructions!==undefined&&(typeof args.instructions!=='string'||args.instructions.length>1000))
    return fail('INVALID_ARGS','Instructions must be under 1000 characters.');
  var id=args.conversation_id;
  if(id!==undefined&&id!==''&&!validId(id))return fail('INVALID_ARGS','Invalid conversation_id.');
  id=id||newId();
  var model=args.model===undefined?settings().model:modelName(args.model);
  if(!model)return fail('INVALID_ARGS','Invalid Gemini model name.');
  var token=await Pebble.secureStorage.getItem(KEY);
  if(!token)return fail('AUTH_REQUIRED','Configure your Gemini API key in the plugin settings.');
  var old=loadHistory(id);
  var contents=old.concat([{role:'user',parts:[{text:args.text}]}]);
  var system='You are a helpful assistant responding on a smartwatch. Keep answers concise, spoken naturally, and avoid Markdown.';
  if(args.instructions)system+='\n'+args.instructions;
  try{
    var res=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':token},
      body:JSON.stringify({system_instruction:{parts:[{text:system}]},contents:contents,
        generationConfig:{maxOutputTokens:650}})
    });
    if(!res.ok)return apiStatus(res.status);
    var data=await res.json();
    var candidate=data&&data.candidates&&data.candidates[0];
    var parts=candidate&&candidate.content&&candidate.content.parts||[];
    var answer=parts.map(function(p){return p.text||'';}).join(' ').trim();
    if(!answer)return fail('PLUGIN_UNAVAILABLE','Gemini returned no readable answer.');
    answer=answer.slice(0,4000);
    saveHistory(id,contents.concat([{role:'model',parts:[{text:answer}]}]));
    return {ok:true,data:{text:answer,conversation_id:id,model:model}};
  }catch(e){return fail('PLUGIN_UNAVAILABLE','Gemini connection failed or timed out.');}
}
Pebble.registerSourceHandler(async function(request,respond){
  if(request.item!=='configured'){respond.error('INVALID_REQUEST','Unknown source');return;}
  var configured=!!(await Pebble.secureStorage.getItem(KEY));
  respond.data({validUntilMs:Date.now()+120000,instances:[{
    instanceId:'gemini',properties:{name:{shortText:{text:'Gemini Conversation'}},
      configured:{boolean:{value:configured}}}}]});
});
Pebble.registerActionHandler(async function(request,respond){
  var args=request.args||{},r;
  switch(request.action){
    case 'get_config':
      r={ok:true,data:{configured:!!(await Pebble.secureStorage.getItem(KEY)),model:settings().model}};
      break;
    case 'list_models':r=await listModels();break;
    case 'conversation':r=await conversation(args);break;
    case 'clear_conversation':
      if(args.all===true){clearAll();r={ok:true,data:{cleared:'all'}};}
      else if(validId(args.conversation_id)){clearSession(args.conversation_id);r={ok:true,data:{cleared:args.conversation_id}};}
      else r=fail('INVALID_ARGS','Provide conversation_id or all=true.');
      break;
    default:respond.error('INVALID_REQUEST','Unknown action');return;
  }
  if(!r.ok){respond.error(r.code,r.message);return;}
  respond.ok({text:JSON.stringify(r.data).slice(0,18000)});
});
Pebble.registerConfigHandler(async function(message,respond){
  var m=message||{};
  if(m.type==='status'){
    respond({ok:true,configured:!!(await Pebble.secureStorage.getItem(KEY)),model:settings().model});return;
  }
  if(m.type==='models'){
    var listed=await listModels(m.api_key);
    if(!listed.ok){respond({ok:false,error:listed.message});return;}
    respond({ok:true,models:listed.data.models,checkedAt:listed.data.checkedAt,
      fromCache:listed.data.fromCache===true,hasMore:listed.data.hasMore===true});return;
  }
  if(m.type==='save'){
    var model=modelName(m.model);
    if(!model){respond({ok:false,error:'Invalid Gemini model name.'});return;}
    var key=typeof m.api_key==='string'?m.api_key.trim():'';
    if(key)await Pebble.secureStorage.setItem(KEY,key);
    if(!(await Pebble.secureStorage.getItem(KEY))){
      respond({ok:false,error:'Enter a Gemini API key.'});return;
    }
    // The model is selected by the plugin settings page, not by the calling watch app.
    localStorage.setItem(MODEL,model);
    Pebble.refreshSources(['agent/configured']);
    respond({ok:true,configured:true,model:model});return;
  }
  if(m.type==='forget'){
    await Pebble.secureStorage.removeItem(KEY);
    localStorage.removeItem(MODEL);
    localStorage.removeItem(CATALOG_KEY);
    clearAll();
    Pebble.refreshSources(['agent/configured']);
    respond({ok:true});return;
  }
  if(m.type==='clear_history'){clearAll();respond({ok:true});return;}
  respond({ok:false,error:'Unknown configuration request.'});
});
