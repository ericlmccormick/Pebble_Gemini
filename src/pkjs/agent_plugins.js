/* Discover installed Pebble agent plugins by their send_to_agent action.
 * Sending a message is not receiving a model response. Never synthesize a
 * delivery receipt as if it were an AI answer.
 */
'use strict';
var GEMINI_ID='2c5edc42-b096-4f76-b284-1f27907e6501';
function catalogue(Pebble){
  if(!Pebble||typeof Pebble.enumeratePlugins!=='function')return [];
  var list;
  try{list=Pebble.enumeratePlugins();}catch(e){return [];}
  if(!Array.isArray(list))return [];
  return list.filter(function(p){return p&&typeof p.uuid==='string'&&
    /^[a-f0-9-]{36}$/i.test(p.uuid)&&
    p.uuid.toLowerCase()!==GEMINI_ID&&
    Array.isArray(p.actions)&&p.actions.some(function(a){
      return a&&a.name==='send_to_agent'&&a.parameters&&
        a.parameters.properties&&a.parameters.properties.message;
    });
  }).map(function(p){
    return {uuid:p.uuid.toLowerCase(),name:String(p.name||'Agent').slice(0,50),kind:'send_only'};
  }).sort(function(a,b){return a.name.localeCompare(b.name);})
  .filter(function(p,i,all){return all.findIndex(function(r){return r.uuid===p.uuid;})===i;});
}
function options(Pebble,chosen){
  var installed=catalogue(Pebble);
  var names=[{value:'plugin',label:'Gemini Conversation plugin (full reply)'}];
  installed.forEach(function(p){names.push({value:'agent:'+p.uuid,label:p.name+' (send only)'});});
  if(typeof chosen==='string'&&chosen.indexOf('agent:')===0&&
     !names.some(function(x){return x.value===chosen})){
    names.push({value:chosen,label:'Previously selected agent (not installed)'});
  }
  names.push({value:'direct',label:'Direct Gemini API (legacy)'});
  return names;
}
function selected(Pebble,choice){
  if(typeof choice!=='string'||choice.slice(0,6)!=='agent:')return null;
  var uuid=choice.slice(6).toLowerCase();
  return catalogue(Pebble).filter(function(p){return p.uuid===uuid;})[0]||null;
}
function dispatch(Pebble,agent,prompt){
  if(!agent)return Promise.reject(Error('Selected agent plugin is not installed. Choose an installed agent.'));
  if(!prompt||!String(prompt).trim())return Promise.reject(Error('No message to send.'));
  if(!Pebble||typeof Pebble.invokeAction!=='function')return Promise.reject(Error('Pebble phone app needs plugin support.'));
  return Pebble.invokeAction({plugin:agent.uuid,action:'send_to_agent',args:{message:String(prompt)}}).then(function(reply){
    if(!reply||!reply.ok){
      var failure=Error(reply&&reply.message||'Agent delivery failed. Check sign-in and plugin permissions.');
      failure.code=reply&&reply.code||'UNKNOWN';
      throw failure;
    }
    return {message:'Sent to '+agent.name+'. Open its chat to read the reply.',agent:agent.name};
  });
}
module.exports={catalogue:catalogue,options:options,selected:selected,dispatch:dispatch};
