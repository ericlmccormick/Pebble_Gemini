'use strict';
const assert=require('node:assert/strict');
const Agent=require('../src/pkjs/agent_plugins');
const ai='2c5edc42-b096-4f76-b284-1f27907e6501';
const example=(uuid,name)=>({uuid,name,actions:[{name:'send_to_agent',
  parameters:{properties:{message:{type:'string'}}}}]});
const installed=[example(ai,'AI Conversation'),example('3f97d5c5-bc28-48ba-b4af-e7ad7f6000f0','ChatGPT'),
  example('80ee6780-856f-411f-954b-4553ba7f2af8','Grok Bot')];
const menu=Agent.options({enumeratePlugins:()=>installed},Agent.agentId());
assert.equal(menu[0].value,'agent:'+ai);
assert.ok(menu[0].label.includes('full replies'));
assert.ok(menu.some(x=>x.label.includes('Grok Bot')&&x.label.includes('send only')));
assert.equal(menu[menu.length-1].value,'direct');
assert.equal(Agent.options({enumeratePlugins:()=>[]},Agent.agentId())[0].label.includes('install'),true);
const chosen=Agent.selected({enumeratePlugins:()=>installed},Agent.agentId());
assert.equal(chosen.uuid,ai);
const complete={ok:true,text:'The real answer',reply_type:'assistant',
  status:'completed',received:true,provider:'openai',model:'gpt-5-mini',
  validation:{provider_http_ok:true,reply_text_present:true},
  request_id:'watch_001',message_id:'m001',chat_id:'s001'};
(async()=>{
 let call;
 const Pebble={invokeAction:async options=>{call=options;return complete;}};
 const reply=await Agent.dispatch(Pebble,chosen,'Please answer');
 assert.equal(call.action,'send_to_agent');
 assert.deepEqual(call.args,{message:'Please answer'});
 assert.equal(reply.kind,'answer');
 assert.equal(reply.text,'The real answer');
 assert.equal(reply.provider,'openai');
 assert.equal(reply.conversation_id,'s001');
 assert.equal(reply.status,'completed');
 const receipt=await Agent.dispatch({invokeAction:async()=>({ok:true,text:'Sent to ChatGPT',reply_type:'assistant'})},
   Agent.selected({enumeratePlugins:()=>installed},'agent:3f97d5c5-bc28-48ba-b4af-e7ad7f6000f0'),'Hello');
 assert.equal(receipt.kind,'receipt');
 assert.equal(receipt.text,'Sent to ChatGPT');
 const unverified=await Agent.dispatch({invokeAction:async()=>({...complete,received:false})},chosen,'Question');
 assert.equal(unverified.kind,'receipt');
 assert.equal(Agent.fullAnswer({...complete,validation:{reply_text_present:true}},chosen),false);
 await assert.rejects(Agent.dispatch(Pebble,null,'Hello'),/not installed/);
 let calls=0;
 await assert.rejects(Agent.dispatch({invokeAction:async()=>{calls++;return {ok:false,code:'TIMEOUT',message:'Delivery unknown'};}},chosen,'Hello'),/Delivery unknown/);
 assert.equal(calls,1,'uncertain deliveries must never be retried');
 console.log('PASS: uniform send_to_agent, full-reply verification, receipt and no-retry handling');
})().catch(e=>{console.error(e);process.exitCode=1;});
