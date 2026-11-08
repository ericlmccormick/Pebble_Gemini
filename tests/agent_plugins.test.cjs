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
const options=Agent.options(onlyTwo);
assert.equal(options.filter(x=>x.value.startsWith('agent:')).length,2);
for(const id of [claude,grok,muse]){
 assert.equal(options.some(x=>x.value==='agent:'+id),false,'uninstalled agents must stay hidden');
 assert.equal(Agent.selected(onlyTwo,'agent:'+id),null);
}
assert.equal(Agent.validChoice(onlyTwo,'agent:'+claude),'agent:'+ai);
assert.equal(Agent.validChoice(onlyTwo,'agent:'+chatgpt),'agent:'+chatgpt);
assert.equal(Agent.validChoice(onlyTwo,'direct'),'direct');
assert.equal(Agent.validChoice({enumeratePlugins:()=>[]},'agent:'+ai),'direct');
assert.equal(Agent.options({enumeratePlugins:()=>[]}).some(x=>x.value.startsWith('agent:')),false);
const extra='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const expanded={enumeratePlugins:()=>[
 ...onlyTwo.enumeratePlugins(),
 example(claude,'Claude',['send_to_agent']),
 example(extra,'Other AI',[{name:'send_to_agent'}]),
 example(grok,'Grok Bot',[{name:'refresh'}])]};
assert.equal(Agent.options(expanded).some(x=>x.value==='agent:'+claude),true);
assert.equal(Agent.options(expanded).some(x=>x.value==='agent:'+extra),true);
assert.equal(Agent.options(expanded).some(x=>x.value==='agent:'+grok),false,
 'installed plugin without the send action must not be offered');
assert.equal(Agent.catalogue(expanded).length,4);
const chosen=Agent.selected(onlyTwo,'agent:'+ai);
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
 await assert.rejects(Agent.dispatch(Pb,Agent.selected(onlyTwo,'agent:'+grok),'Question'),/not installed/);
 const receipt=await Agent.dispatch({invokeAction:async()=>({ok:true,text:'Sent to ChatGPT'})},Agent.selected(onlyTwo,'agent:'+chatgpt),'Hello');
 assert.equal(receipt.kind,'receipt');
 const bad=await Agent.dispatch({invokeAction:async()=>({...complete,received:false})},chosen,'No');
 assert.equal(bad.kind,'receipt');
 const lean=await Agent.dispatch({invokeAction:async()=>({
   ok:true,text:'A spoken answer',reply_type:'assistant',status:'completed',received:true,
   provider:'gemini'})},chosen,'Hello');
 assert.equal(lean.kind,'answer','real answers must not require validation fields');
 const missingReceived=await Agent.dispatch({invokeAction:async()=>({
   ok:true,text:'A spoken answer',reply_type:'assistant',status:'completed'})},chosen,'Hello');
 assert.equal(missingReceived.kind,'answer','optional received flag must not suppress TTS');
 const leanFallback=await Agent.dispatch({invokeAction:async()=>({
   ok:true,text:'A spoken answer',status:'completed',received:true,provider:'gemini'})},chosen,'Hello');
 assert.equal(leanFallback.kind,'answer');
 const bareReceipt=await Agent.dispatch({invokeAction:async()=>({
   ok:true,text:'Message delivered',received:true,status:'completed'})},chosen,'Hello');
 assert.equal(bareReceipt.kind,'receipt','do not speak send-only acknowledgement');
 const failedProvider=await Agent.dispatch({invokeAction:async()=>({
   ...complete,validation:{provider_http_ok:false,reply_text_present:true}})},chosen,'Hello');
 assert.equal(failedProvider.kind,'receipt','explicit provider failures are not speech');

 let calls=0;
 await assert.rejects(Agent.dispatch({invokeAction:async()=>{calls++;return {ok:false,message:'Unknown delivery'};}},chosen,'Hi'),/Unknown delivery/);
 assert.equal(calls,1);
 console.log('PASS: installed-only agent discovery, safe provider fallback and guarded responses');
})().catch(e=>{console.error(e);process.exitCode=1;});
