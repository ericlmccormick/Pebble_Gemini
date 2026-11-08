'use strict';
var UNIVERSAL_ID='2c5edc42-b096-4f76-b284-1f27907e6501';
function agentId(){return 'agent:'+UNIVERSAL_ID;}
function catalogue(Pebble){
  if(!Pebble||typeof Pebble.enumeratePlugins!=='function')return [];
  var list;try{list=Pebble.enumeratePlugins();}catch(e){return [];}
  if(!Array.isArray(list))return [];
  return list.filter(function(p){return p&&typeof p.uuid==='string'&&
    /^[a-f0-9-]{36}$/i.test(p.uuid)&&Array.isArray(p.actions)&&
    p.actions.some(function(a){return a&&a.name==='send_to_agent'&&
      a.parameters&&a.parameters.properties&&a.parameters.properties.message;});
  }).map(function(p){
    var id=p.uuid.toLowerCase();
    return {uuid:id,name:String(p.name||'Agent').slice(0,50),kind:id===UNIVERSAL_ID?'full_reply':'send_only'};
  }).sort(function(a,b){return a.kind!==b.kind?(a.kind==='full_reply'?-1:1):a.name.localeCompare(b.name);})
  .filter(function(p,i,all){return all.findIndex(function(q){return q.uuid===p.uuid;})===i;});
}
function options(Pebble,selected){
  var all=catalogue(Pebble),native=all.filter(function(a){return a.uuid===UNIVERSAL_ID;})[0];
  var rows=[{value:agentId(),label:native?native.name+' (full replies)':'AI Conversation (install/update plugin)'}];
  all.forEach(function(p){if(p.uuid!==UNIVERSAL_ID)rows.push({value:'agent:'+p.uuid,label:p.name+' (send only)'});});
  if(typeof selected==='string'&&selected.indexOf('agent:')===0&&
    !rows.some(function(x){return x.value===selected}))rows.push({value:selected,label:'Previously selected agent (not installed)'});
  rows.push({value:'direct',label:'Direct Gemini API (legacy)'});
  return rows;
}
function selected(Pebble,value){
  if(typeof value!=='string'||value.slice(0,6)!=='agent:')return null;
  return catalogue(Pebble).filter(function(p){return p.uuid===value.slice(6).toLowerCase();})[0]||null;
}
function fullAnswer(reply,agent){
  return agent.uuid===UNIVERSAL_ID&&reply.reply_type==='assistant'&&
    (reply.status==='completed'||reply.status==='incomplete')&&reply.received===true&&
    reply.validation&&reply.validation.provider_http_ok===true&&
    reply.validation.reply_text_present===true&&typeof reply.text==='string'&&!!reply.text.trim();
}
function dispatch(Pebble,agent,prompt){
  if(!agent)return Promise.reject(Error('Selected agent is not installed. Install or select another.'));
  if(typeof prompt!=='string'||!prompt.trim())return Promise.reject(Error('No message to send.'));
  if(!Pebble||typeof Pebble.invokeAction!=='function')return Promise.reject(Error('Pebble phone app needs plugin support.'));
  return Pebble.invokeAction({plugin:agent.uuid,action:'send_to_agent',args:{message:prompt}}).then(function(reply){
    if(!reply||!reply.ok){
      var err=Error(reply&&reply.message||'Agent failed; check sign-in and permissions.');
      err.code=reply&&reply.code||'PLUGIN_UNAVAILABLE';throw err;
    }
    if(fullAnswer(reply,agent))return {kind:'answer',text:reply.text,agent:agent.name,
      conversation_id:reply.chat_id||reply.conversation_id||null,
      status:reply.status,provider:reply.provider,model:reply.model,
      request_id:reply.request_id,message_id:reply.message_id};
    return {kind:'receipt',text:typeof reply.text==='string'?reply.text:
      'Sent to '+agent.name+'. Open its chat to read the reply.',agent:agent.name};
  });
}
module.exports={catalogue:catalogue,options:options,selected:selected,dispatch:dispatch,
  fullAnswer:fullAnswer,agentId:agentId,UNIVERSAL_ID:UNIVERSAL_ID};
