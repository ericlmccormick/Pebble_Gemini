'use strict';
var UNIVERSAL_ID='2c5edc42-b096-4f76-b284-1f27907e6501';
function agentId(){return 'agent:'+UNIVERSAL_ID;}
function rawCatalogue(Pebble){
  if(!Pebble||typeof Pebble.enumeratePlugins!=='function')return [];
  try {
    var list=Pebble.enumeratePlugins();
    return Array.isArray(list)?list:[];
  }catch(e){return [];}
}
function catalogue(Pebble){
  // Only Pebble-reported installed plugins exposing the standard agent action.
  // Do not require the optional parameters schema to be present.
  var seen={};
  return rawCatalogue(Pebble).filter(function(p){
    if(!p||typeof p.uuid!=='string'||!Array.isArray(p.actions))return false;
    var id=p.uuid.toLowerCase();
    if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)||seen[id])return false;
    if(!p.actions.some(function(a){return a&&(a==='send_to_agent'||a.name==='send_to_agent');}))return false;
    seen[id]=true;return true;
  }).map(function(p){
    var id=p.uuid.toLowerCase();
    return {uuid:id,name:String(p.name||'Agent').slice(0,50),
      kind:id===UNIVERSAL_ID?'full_reply':'send_only'};
  }).sort(function(a,b){
    return a.kind!==b.kind?(a.kind==='full_reply'?-1:1):a.name.localeCompare(b.name);
  });
}
function options(Pebble){
  var rows=catalogue(Pebble).map(function(p){
    return {value:'agent:'+p.uuid,label:p.name+
      (p.kind==='full_reply'?' (full replies)':' (send only)')};
  });
  rows.push({value:'direct',label:'Direct Gemini API (legacy)'});
  return rows;
}
function validChoice(Pebble,choice){
  if(choice==='direct')return choice;
  var agent=selected(Pebble,choice);
  if(agent)return 'agent:'+agent.uuid;
  var available=catalogue(Pebble);
  return available.length?'agent:'+available[0].uuid:'direct';
}
function selected(Pebble,value){
  if(typeof value!=='string'||value.slice(0,6)!=='agent:')return null;
  var id=value.slice(6).toLowerCase();
  return catalogue(Pebble).filter(function(p){return p.uuid===id;})[0]||null;
}
function fullAnswer(reply,agent){
  if(!reply||agent.uuid!==UNIVERSAL_ID||typeof reply.text!=='string'||!reply.text.trim())return false;
  // The agent action's optional validation metadata must not turn a genuine
  // assistant answer into a send-only delivery receipt. That regression began
  // when the standard send_to_agent integration replaced v1.6.3 conversation.
  if(reply.received===false||reply.validation&&(
      reply.validation.provider_http_ok===false||
      reply.validation.reply_text_present===false))return false;
  if(reply.reply_type==='assistant'&&
      (reply.status===undefined||reply.status==='completed'||reply.status==='incomplete'))return true;
  // Also accept an explicitly delivered, completed assistant response from
  // providers which omit reply_type. Never promote bare 'sent' receipts.
  return reply.received===true&&reply.status==='completed'&&
      typeof reply.provider==='string'&&!!reply.provider;
}
function dispatch(Pebble,agent,prompt){
  if(!agent)return Promise.reject(Error('Selected agent is not installed. Reopen WISP settings.'));
  if(typeof prompt!=='string'||!prompt.trim())return Promise.reject(Error('No message to send.'));
  if(!Pebble||typeof Pebble.invokeAction!=='function')return Promise.reject(Error('Pebble phone app needs plugin support.'));
  return Pebble.invokeAction({plugin:agent.uuid,action:'send_to_agent',args:{message:prompt}}).then(function(reply){
    if(!reply||!reply.ok){
      var error=Error(reply&&reply.message||
        ('Cannot contact '+agent.name+'. Check installation and permissions in Pebble.'));
      error.code=reply&&reply.code||'PLUGIN_UNAVAILABLE';throw error;
    }
    if(fullAnswer(reply,agent))return {kind:'answer',text:reply.text,agent:agent.name,
      conversation_id:reply.chat_id||reply.conversation_id||null,
      status:reply.status,provider:reply.provider,model:reply.model,
      request_id:reply.request_id,message_id:reply.message_id};
    return {kind:'receipt',text:typeof reply.text==='string'?reply.text:
      'Sent to '+agent.name+'. Open its chat to read the reply.',agent:agent.name};
  });
}
module.exports={catalogue:catalogue,options:options,selected:selected,validChoice:validChoice,
  dispatch:dispatch,fullAnswer:fullAnswer,agentId:agentId,UNIVERSAL_ID:UNIVERSAL_ID};
