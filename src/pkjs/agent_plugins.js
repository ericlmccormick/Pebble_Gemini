'use strict';
// The Pebble host's enumeratePlugins() can report fewer plugins than a user
// has installed or permitted. This list is a KNOWN registry, not proof of
// installation. Only advertise native Pebble agent actions, never fake a grant.
var UNIVERSAL_ID='2c5edc42-b096-4f76-b284-1f27907e6501';
var KNOWN=[
 {uuid:UNIVERSAL_ID,name:'AI Conversation',kind:'full_reply'},
 {uuid:'3f97d5c5-bc28-48ba-b4af-e7ad7f6000f0',name:'ChatGPT',kind:'send_only'},
 {uuid:'0d33014e-5d56-42ea-9665-3ebf182b4cfb',name:'Claude',kind:'send_only'},
 {uuid:'80ee6780-856f-411f-954b-4553ba7f2af8',name:'Grok Bot',kind:'send_only'},
 {uuid:'b8346592-cd59-4b83-9185-87d94e0734b0',name:'Muse',kind:'send_only'}
];
function agentId(){return 'agent:'+UNIVERSAL_ID;}
function rawCatalogue(Pebble){
  if(!Pebble||typeof Pebble.enumeratePlugins!=='function')return [];
  try {var list=Pebble.enumeratePlugins();return Array.isArray(list)?list:[];}
  catch(e){return [];}
}
function normalized(entry){
  if(!entry||typeof entry.uuid!=='string')return null;
  var id=entry.uuid.toLowerCase();
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))return null;
  var names=Array.isArray(entry.actions)?entry.actions.map(function(a){
    return typeof a==='string'?a:a&&a.name;
  }):[];
  var compatible=names.indexOf('send_to_agent')!==-1;
  return {uuid:id,name:String(entry.name||'Agent').slice(0,50),compatible:compatible};
}
function catalogue(Pebble){
  var found=rawCatalogue(Pebble).map(normalized).filter(Boolean);
  var rows=KNOWN.map(function(p){
    var match=found.filter(function(f){return f.uuid===p.uuid;})[0];
    return {uuid:p.uuid,name:match&&match.name||p.name,kind:p.kind,
      detected:!!match,actionReported:!!(match&&match.compatible),known:true};
  });
  found.forEach(function(f){
    if(!f.compatible||rows.some(function(p){return p.uuid===f.uuid;}))return;
    rows.push({uuid:f.uuid,name:f.name,kind:'send_only',detected:true,actionReported:true,known:false});
  });
  return rows;
}
function options(Pebble,choice){
  var rows=catalogue(Pebble).map(function(p){
    var suffix=p.detected?(p.actionReported?'': ' · action not reported'):' · not detected';
    return {value:'agent:'+p.uuid,label:p.name+(p.kind==='full_reply'?' (full replies)':' (send only)')+suffix};
  });
  if(typeof choice==='string'&&choice.slice(0,6)==='agent:'&&
    !rows.some(function(p){return p.value===choice})){
    rows.push({value:choice,label:'Previously selected agent (not detected)'});
  }
  rows.push({value:'direct',label:'Direct Gemini API (legacy)'});
  return rows;
}
function selected(Pebble,value){
  if(typeof value!=='string'||value.slice(0,6)!=='agent:')return null;
  var id=value.slice(6).toLowerCase();
  return catalogue(Pebble).filter(function(p){return p.uuid===id;})[0]||null;
}
function diagnostics(Pebble){
  var reported=rawCatalogue(Pebble),known=catalogue(Pebble);
  return {reported:reported.length,agents:known.map(function(p){
    return {name:p.name,uuid:p.uuid,detected:p.detected,actionReported:p.actionReported};
  })};
}
function diagnosticText(Pebble){
  var info=diagnostics(Pebble);
  return 'Pebble reports '+info.reported+' total plugins. Agent detection: '+
    info.agents.map(function(p){
      return p.name+': '+(p.detected?(p.actionReported?'detected':'reported; action missing'):'not reported');
    }).join(' | ')+
    '. You may select a known agent that is not reported. If invoking it fails, check the plugin installation and permission in the Pebble phone app.';
}
function fullAnswer(reply,agent){
  return agent.uuid===UNIVERSAL_ID&&reply.reply_type==='assistant'&&
    (reply.status==='completed'||reply.status==='incomplete')&&reply.received===true&&
    reply.validation&&reply.validation.provider_http_ok===true&&
    reply.validation.reply_text_present===true&&typeof reply.text==='string'&&!!reply.text.trim();
}
function dispatch(Pebble,agent,prompt){
  if(!agent)return Promise.reject(Error('Selected agent is unknown. Reopen WISP settings.'));
  if(typeof prompt!=='string'||!prompt.trim())return Promise.reject(Error('No message to send.'));
  if(!Pebble||typeof Pebble.invokeAction!=='function')return Promise.reject(Error('Pebble phone app needs plugin support.'));
  // A missing enumeration entry does not prove the plugin is absent.
  // The host enforces installation and grants during invokeAction().
  return Pebble.invokeAction({plugin:agent.uuid,action:'send_to_agent',args:{message:prompt}}).then(function(reply){
    if(!reply||!reply.ok){
      var error=Error(reply&&reply.message||
        ('Cannot contact '+agent.name+'. Check installation, enablement and permissions in Pebble.'));
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
module.exports={catalogue:catalogue,options:options,selected:selected,dispatch:dispatch,
  fullAnswer:fullAnswer,agentId:agentId,UNIVERSAL_ID:UNIVERSAL_ID,
  diagnostics:diagnostics,diagnosticText:diagnosticText};
