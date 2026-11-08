'use strict';
const assert=require('node:assert/strict');
const moduleAgent=require('../src/pkjs/agent_plugins');
const full='2c5edc42-b096-4f76-b284-1f27907e6501';
const send=(uuid,name)=>({uuid,name,actions:[{name:'send_to_agent',parameters:{properties:{message:{type:'string'}}}}]});
const plugins=[
{uuid:full,name:'Gemini Conversation',actions:[{name:'conversation'}]},
send('3f97d5c5-bc28-48ba-b4af-e7ad7f6000f0','ChatGPT'),
send('0d33014e-5d56-42ea-9665-3ebf182b4cfb','Claude'),
send('80ee6780-856f-411f-954b-4553ba7f2af8','Grok Bot'),
send('b8346592-cd59-4b83-9185-87d94e0734b0','Muse'),
{uuid:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Weather',actions:[{name:'refresh'}]}
];
let invoked=[];
const Pebble={enumeratePlugins:()=>plugins,invokeAction:async request=>{invoked.push(request);return {ok:true,text:'Message accepted'};}};
const options=moduleAgent.options(Pebble,'plugin');
assert.equal(options[0].value,'plugin');
assert.ok(options.some(x=>x.label.includes('ChatGPT')&&x.label.includes('send only')));
assert.ok(options.some(x=>x.label.includes('Claude')));
assert.ok(options.some(x=>x.label.includes('Muse')));
assert.ok(options.some(x=>x.label.includes('Grok Bot')));
assert.equal(options.some(x=>x.label.includes('Weather')),false);
assert.equal(options.filter(x=>x.value==='plugin').length,1);
assert.equal(options[options.length-1].value,'direct');
assert.equal(moduleAgent.options({enumeratePlugins:()=>[]},'agent:3f97d5c5-bc28-48ba-b4af-e7ad7f6000f0').some(x=>x.label.includes('not installed')),true);
const chosen=moduleAgent.selected(Pebble,'agent:3f97d5c5-bc28-48ba-b4af-e7ad7f6000f0');
assert.equal(chosen.name,'ChatGPT');
(async()=>{
 const reply=await moduleAgent.dispatch(Pebble,chosen,'What is 2+2?');
 assert.equal(reply.message.includes('Sent to ChatGPT.'),true);
 assert.equal(reply.message.includes('2+2'),false);
 assert.equal(invoked[0].action,'send_to_agent');
 assert.deepEqual(invoked[0].args,{message:'What is 2+2?'});
 assert.equal(moduleAgent.selected({enumeratePlugins:()=>[]},'agent:'+chosen.uuid),null);
 await assert.rejects(moduleAgent.dispatch(Pebble,null,'hello'),/not installed/);
 let count=0;
 await assert.rejects(moduleAgent.dispatch({invokeAction:()=>{count++;return Promise.resolve({ok:false,code:'TIMEOUT',message:'Unknown delivery'})}},chosen,'hi'),/Unknown delivery/);
 assert.equal(count,1,'uncertain sends must never be retried');
 console.log('PASS: installed agent discovery, filtering, delivery-receipt-only behavior');
})().catch(e=>{console.error(e);process.exitCode=1;});
