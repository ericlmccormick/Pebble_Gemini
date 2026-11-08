'use strict';
const assert=require('node:assert/strict');
const Agent=require('../src/pkjs/agent_plugins');
const ai='2c5edc42-b096-4f76-b284-1f27907e6501';
const chatgpt='3f97d5c5-bc28-48ba-b4af-e7ad7f6000f0';
const claude='0d33014e-5d56-42ea-9665-3ebf182b4cfb';
const grok='80ee6780-856f-411f-954b-4553ba7f2af8';
const muse='b8346592-cd59-4b83-9185-87d94e0734b0';
const example=(uuid,name,actions)=>({uuid,name,actions:actions===undefined?[{name:'send_to_agent'}]:actions});
const onlyTwo={enumeratePlugins:()=>[example(ai,'AI Conversation'),example(chatgpt,'ChatGPT')]};
const options=Agent.options(onlyTwo,Agent.agentId());
assert.equal(options.filter(x=>x.value.startsWith('agent:')).length,5);
assert.ok(options.some(x=>x.value==='agent:'+claude&&x.label.includes('not detected')));
assert.ok(options.some(x=>x.value==='agent:'+grok&&x.label.includes('not detected')));
assert.ok(options.some(x=>x.value==='agent:'+muse&&x.label.includes('not detected')));
assert.ok(!options.some(x=>x.value==='agent:'+chatgpt&&x.label.includes('not detected')));
assert.equal(Agent.selected(onlyTwo,'agent:'+muse).detected,false);
assert.equal(Agent.diagnostics(onlyTwo).reported,2);
assert.match(Agent.diagnosticText(onlyTwo),/Grok Bot: not reported/);
const extra='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const all={enumeratePlugins:()=>[...onlyTwo.enumeratePlugins(),example(extra,'Other AI',['send_to_agent']),example(claude,'Claude',[])]};
assert.ok(Agent.options(all,Agent.agentId()).some(x=>x.value==='agent:'+extra));
assert.ok(Agent.options(all,Agent.agentId()).some(x=>x.value==='agent:'+claude&&x.label.includes('action not reported')));
const chosen=Agent.selected(onlyTwo,Agent.agentId());
const complete={ok:true,text:'The real answer',reply_type:'assistant',status:'completed',
  received:true,provider:'openai',model:'gpt-5-mini',
  validation:{provider_http_ok:true,reply_text_present:true},
  request_id:'watch_001',message_id:'m001',chat_id:'s001'};
(async()=>{
 let call;
 const Pb={invokeAction:async opts=>{call=opts;return complete;}};
 const answer=await Agent.dispatch(Pb,chosen,'Please answer');
 assert.equal(call.action,'send_to_agent');
 assert.deepEqual(call.args,{message:'Please answer'});
 assert.equal(answer.kind,'answer');
 const missing=await Agent.dispatch({invokeAction:async opts=>{call=opts;return {ok:false,code:'PLUGIN_UNAVAILABLE',message:'Not installed'};}},Agent.selected(onlyTwo,'agent:'+grok),'Question').then(()=>null,e=>e);
 assert.equal(call.plugin,grok);
 assert.equal(missing.code,'PLUGIN_UNAVAILABLE');
 const receipt=await Agent.dispatch({invokeAction:async()=>({ok:true,text:'Sent to Claude'})},Agent.selected(onlyTwo,'agent:'+claude),'Hello');
 assert.equal(receipt.kind,'receipt');
 const bad=await Agent.dispatch({invokeAction:async()=>({...complete,received:false})},chosen,'No');
 assert.equal(bad.kind,'receipt');
 let calls=0;
 await assert.rejects(Agent.dispatch({invokeAction:async()=>{calls++;return {ok:false,message:'Unknown delivery'};}},chosen,'Hi'),/Unknown delivery/);
 assert.equal(calls,1);
 console.log('PASS: known agent fallback, host detection diagnostics, action compatibility and guarded response handling');
})().catch(e=>{console.error(e);process.exitCode=1;});
