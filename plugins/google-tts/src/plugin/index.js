/* Google Cloud TTS plugin. Compatible with Home Assistant Bridge audio SDK v1.
 * Key saved in Pebble.secureStorage; persistent bounded WAV chunks survive
 * plugin script restart between tts_prepare and tts_chunk actions.
 * WAV format: canonical mono 8000 Hz signed PCM16, chunk size 6000 bytes.
 */
'use strict';
var KEY='google_tts_cloud_api_key_v1';
var VOICE_KEY='google_tts_voice_v1';
var DEFAULT_VOICE='en-US-Wavenet-F';
function failure(code,message){return {ok:false,code:code,message:message};}
function configuredVoice(){return localStorage.getItem(VOICE_KEY)||DEFAULT_VOICE;}
function validVoice(name){return typeof name==='string'&&/^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9-]{2,80}$/.test(name);}
function base64Decode(input){
  if(typeof input!=='string'||!input||input.length>3000000)throw Error('Invalid base64 audio size');
  if(input.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(input))throw Error('Invalid base64 audio');
  return new Uint8Array(pluginDecodeBase64(input));
}
var pluginB64Alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function pluginDecodeBase64(input){
  var output=[],buffer=0,bits=0;
  for(var i=0;i<input.length;i++){
    var ch=input.charAt(i);
    if(ch==='=')break;
    var v=pluginB64Alphabet.indexOf(ch);
    if(v<0)throw Error('Invalid plugin audio encoding');
    buffer=(buffer<<6)|v;bits+=6;
    if(bits>=8){bits-=8;output.push((buffer>>bits)&255);}
  }
  return output;
}

var MAX_TTS_BYTES=1500000,TTS_CHUNK_BYTES=6000;
var TTS_INDEX_KEY='google_tts_sessions_v1',TTS_TTL_MS=180000;
function base64Bytes(bytes) {
  var abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out='';
  for(var i=0;i<bytes.length;i+=3){
    var a=bytes[i],b=i+1<bytes.length?bytes[i+1]:0,c=i+2<bytes.length?bytes[i+2]:0;
    out+=abc[a>>2]+abc[((a&3)<<4)|(b>>4)]+(i+1<bytes.length?abc[((b&15)<<2)|(c>>6)]:'=')+
      (i+2<bytes.length?abc[c&63]:'=');
  }
  return out;
}
function sessionKey(id){return 'google_tts_v1_'+id;}
function sessionList(){
  try{var value=JSON.parse(localStorage.getItem(TTS_INDEX_KEY)||'[]');
    return Array.isArray(value)?value:[];}catch(e){return [];}
}
function deleteTtsSession(id){
  var key=sessionKey(id),raw=localStorage.getItem(key),count=0;
  try{count=JSON.parse(raw||'{}').count||0;}catch(e){}
  // Reject tampered metadata that would otherwise trigger unbounded deletion.
  count=Math.min(251,Math.max(0,count));
  for(var i=0;i<count;i++)localStorage.removeItem(key+'_'+i);
  localStorage.removeItem(key);
}
function cleanTtsSessions(){
  var now=Date.now(),keep=[];
  sessionList().forEach(function(id){
    if(!/^tts[a-z0-9]+$/.test(id))return;
    var meta=null;
    try{meta=JSON.parse(localStorage.getItem(sessionKey(id))||'null');}catch(e){}
    if(!meta||meta.expires<now){deleteTtsSession(id);return;}
    keep.push(id);
  });
  localStorage.setItem(TTS_INDEX_KEY,JSON.stringify(keep));
  return keep;
}
function storeTtsSession(bytes){
  var keep=cleanTtsSessions();
  // Keep up to three concurrent speech sessions: the active sentence, one
  // prepared-ahead sentence, and a spare for overlapping release actions.
  // An older active transfer must never be deleted by the next prepare.
  while(keep.length>=3){
    deleteTtsSession(keep.shift());
  }
  localStorage.setItem(TTS_INDEX_KEY,JSON.stringify(keep));
  var id='tts'+Date.now().toString(36)+Math.floor(Math.random()*0x100000000).toString(36);
  var key=sessionKey(id),count=Math.ceil(bytes.length/TTS_CHUNK_BYTES);
  var hashes=[];
  for(var n=0;n<count;n++){
    var pos=n*TTS_CHUNK_BYTES;
    hashes.push(wavChecksum(bytes.subarray(pos,Math.min(bytes.length,pos+TTS_CHUNK_BYTES))));
  }
  var meta={length:bytes.length,count:count,hashes:hashes,expires:Date.now()+TTS_TTL_MS};
  try{
    localStorage.setItem(key,JSON.stringify(meta));
    for(var i=0;i<count;i++){
      var start=i*TTS_CHUNK_BYTES;
      localStorage.setItem(key+'_'+i,base64Bytes(bytes.subarray(start,start+TTS_CHUNK_BYTES)));
    }
    localStorage.setItem(TTS_INDEX_KEY,JSON.stringify(keep.concat([id])));
    return {session_id:id,length:bytes.length,chunk_bytes:TTS_CHUNK_BYTES};
  }catch(e){
    deleteTtsSession(id);
    return null;
  }
}
// Decode a complete mono PCM16 WAV. HA may ignore the preferred sample rate;
// inspect the returned header rather than treating bytes as a different codec.
function wavPcm16(bytes) {
  if(bytes.length<44)return {ok:false,error:'WAV too short'};
  var view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  function tag(p){return String.fromCharCode(bytes[p],bytes[p+1],bytes[p+2],bytes[p+3]);}
  if(tag(0)!=='RIFF'||tag(8)!=='WAVE')return {ok:false,error:'TTS did not return RIFF WAV'};
  var pos=12,fmt=null,start=-1,dataLength=0,declaredSize=0;
  while(pos+8<=bytes.length) {
    var size=view.getUint32(pos+4,true),data=pos+8,name=tag(pos);
    if(name==='fmt ') {
      if(size<16||data+size>bytes.length)return {ok:false,error:'Invalid WAV format'};
      fmt={encoding:view.getUint16(data,true),channels:view.getUint16(data+2,true),
        rate:view.getUint32(data+4,true),bits:view.getUint16(data+14,true)};
    }
    if(name==='data'){start=data;declaredSize=size;break;}
    if(size>bytes.length-data)return {ok:false,error:'Truncated WAV '+name};
    pos=data+size+(size&1);
  }
  if(!fmt||start<0)return {ok:false,error:'Missing WAV audio format or data'};
  if(fmt.encoding!==1||fmt.channels!==1||fmt.bits!==16||
     fmt.rate<8000||fmt.rate>48000)
    return {ok:false,error:'TTS requires mono PCM16 WAV (8-48 kHz)'};
  // Respect a valid finite 'data' chunk length; a WAV can contain trailing
  // LIST, INFO or metadata chunks. Do not decode those non-audio bytes as PCM.
  // Home Assistant streamed WAV may use unknown (0xFFFFFFFF/0x7FFFFFFF)
  // or overstated sizes, so in those cases use available complete frames.
  var available=bytes.length-start;
  var streamed=declaredSize===0||declaredSize===0xFFFFFFFF||declaredSize===0x7FFFFFFF||declaredSize===0xFDFDFDFD;
  var usable=(streamed||declaredSize>available)?
    available:Math.min(available,declaredSize);
  usable-=usable%2;
  var length=usable/2;
  if(!length)return {ok:false,error:'Empty WAV audio'};
  var samples=new Int16Array(length);
  for(var i=0;i<length;i++)samples[i]=view.getInt16(start+i*2,true);
  return {ok:true,samples:samples,rate:fmt.rate,
    byte_order_analysis:inspectPcmByteOrder(bytes,start,length),
    declared_data_bytes:declaredSize,available_data_bytes:available,
    used_data_bytes:usable,streamed_data:streamed};
}
// Convert source PCM16 to the native Gemini-compatible 8 kHz playback rate.
// If HA supplies 16 kHz, use a 31-tap windowed-sinc low-pass FIR *before*
// dropping every other sample to avoid audible aliasing. Other supported
// sample rates are converted with a band-limited interpolation kernel.
function resample8k(samples,rate) {
  if(rate===8000)return samples;
  var outLength=Math.max(1,Math.round(samples.length*8000/rate));
  var out=new Int16Array(outLength);
  var cutoff=Math.min(0.45,3600/rate);
  var radius=16;
  for(var i=0;i<outLength;i++) {
    var center=i*rate/8000,sum=0,weight=0;
    var midpoint=Math.floor(center);
    for(var j=midpoint-radius+1;j<=midpoint+radius;j++) {
      var distance=j-center;
      if(Math.abs(distance)>radius)continue;
      var x=2*cutoff*distance;
      var sinc=Math.abs(x)<1e-9?1:Math.sin(Math.PI*x)/(Math.PI*x);
      var window=0.5+0.5*Math.cos(Math.PI*distance/radius);
      var coefficient=2*cutoff*sinc*window;
      var sample=samples[Math.max(0,Math.min(samples.length-1,j))];
      sum+=sample*coefficient;weight+=coefficient;
    }
    out[i]=Math.max(-32768,Math.min(32767,Math.round(sum/weight)));
  }
  return out;
}
// Gemini consumes a canonical 44-byte WAV header followed by signed,
// little-endian 8kHz mono PCM16 samples. Keep ADPCM encoding in the phone app.
function geminiWav8k(samples) {
  var out=new Uint8Array(44+samples.length*2),v=new DataView(out.buffer);
  function tag(p,t){for(var i=0;i<t.length;i++)out[p+i]=t.charCodeAt(i);}
  tag(0,'RIFF');v.setUint32(4,out.length-8,true);tag(8,'WAVE');
  tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);
  v.setUint16(22,1,true);v.setUint32(24,8000,true);
  v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
  tag(36,'data');v.setUint32(40,samples.length*2,true);
  for(var i=0;i<samples.length;i++)v.setInt16(44+i*2,samples[i],true);
  return out;
}
// Match the phone-side checksum before ADPCM encoding; a corrupt or missing
// base64 chunk must fail instead of being decoded as audible static.
function wavChecksum(bytes) {
  var hash=2166136261>>>0;
  for(var i=0;i<bytes.length;i++) {
    hash=Math.imul((hash^bytes[i])>>>0,16777619)>>>0;
  }
  return hash>>>0;
}
function pcmStats(samples,rate) {
  var peak=0,power=0,zeroCrossings=0,clipped=0,prev=0;
  for(var i=0;i<samples.length;i++){
    var value=samples[i];
    peak=Math.max(peak,Math.abs(value));
    power+=value*value;
    if(i&&((value<0)!==(prev<0)))zeroCrossings++;
    if(Math.abs(value)>=32760)clipped++;
    prev=value;
  }
  return {peak:peak,rms:Math.round(Math.sqrt(power/Math.max(1,samples.length))),
    zero_crossings:zeroCrossings,clipped:clipped,
    duration_ms:Math.round(samples.length*1000/(rate||8000))};
}
// The bridge already knows the real WAV bytes. Compare both PCM16 byte
// interpretations without changing the actual playback signal. Misread
// endianness has dramatically different adjacent-sample roughness.
function inspectPcmByteOrder(bytes,offset,count) {
  var view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  var leDiff=0,beDiff=0,lePower=0,bePower=0,leCross=0,beCross=0;
  var lastLE=0,lastBE=0,n=Math.min(count,24000);
  for(var i=0;i<n;i++) {
    var le=view.getInt16(offset+2*i,true),be=view.getInt16(offset+2*i,false);
    lePower+=le*le;bePower+=be*be;
    if(i) {
      leDiff+=Math.abs(le-lastLE);beDiff+=Math.abs(be-lastBE);
      if((le<0)!==(lastLE<0))leCross++;
      if((be<0)!==(lastBE<0))beCross++;
    }
    lastLE=le;lastBE=be;
  }
  return {examined_samples:n,
    little_endian:{mean_step:Math.round(leDiff/Math.max(1,n-1)),
      rms:Math.round(Math.sqrt(lePower/Math.max(1,n))),crossings:leCross},
    big_endian:{mean_step:Math.round(beDiff/Math.max(1,n-1)),
      rms:Math.round(Math.sqrt(bePower/Math.max(1,n))),crossings:beCross}};
}
function bridgeTestTone() {
  var samples=new Int16Array(8000*7);
  for(var i=0;i<samples.length;i++)
    samples[i]=Math.round(9000*Math.sin(2*Math.PI*440*i/8000));
  return samples;
}
function packageWavSession(pcm,source) {
  var wav=geminiWav8k(pcm);
  if(wav.length>MAX_TTS_BYTES)
    return failure('PLUGIN_UNAVAILABLE','TTS PCM audio exceeds size limit');
  var session=storeTtsSession(wav);
  if(!session)return failure('PLUGIN_UNAVAILABLE','Insufficient plugin storage for TTS audio');
  session.format='pcm_s16le_wav';
  session.sample_rate=8000;
  session.channels=1;
  session.bits_per_sample=16;
  session.sample_count=pcm.length;
  session.wav_checksum=wavChecksum(wav);
  // Return the first already-stored chunk with prepare. This avoids another
  // plugin startup / interprocess round trip before the phone can assemble
  // the first sentence. Older clients simply ignore the optional field.
  session.first_chunk=localStorage.getItem(sessionKey(session.session_id)+'_0');
  session.first_chunk_checksum=wavChecksum(wav.subarray(0,Math.min(wav.length,TTS_CHUNK_BYTES)));
  session.audio_diagnostics={source:source,output:pcmStats(pcm)};
  return {ok:true,data:session};
}

function ttsChunk(args){
  cleanTtsSessions();
  var id=String(args.session_id||''),offset=Number(args.offset);
  if(!/^tts[a-z0-9]+$/.test(id))return failure('INVALID_ARGS','Invalid TTS session');
  var meta=null;
  try{meta=JSON.parse(localStorage.getItem(sessionKey(id))||'null');}catch(e){}
  if(!meta)return failure('PLUGIN_UNAVAILABLE','TTS session expired; start a new request');
  if(!Number.isInteger(offset)||offset<0||offset>=meta.length||offset%TTS_CHUNK_BYTES!==0)
    return failure('INVALID_ARGS','Invalid TTS chunk offset');
  var index=offset/TTS_CHUNK_BYTES;
  var audio=localStorage.getItem(sessionKey(id)+'_'+index);
  if(!audio)return failure('PLUGIN_UNAVAILABLE','TTS audio chunk unavailable');
  meta.expires=Date.now()+TTS_TTL_MS;
  localStorage.setItem(sessionKey(id),JSON.stringify(meta));
  return {ok:true,data:{offset:offset,length:meta.length,audio:audio,
    checksum:meta.hashes&&meta.hashes[index],
    done:index===meta.count-1}};
}

async function prepareTts(args){
  if(args.test_tone===true)return packageWavSession(bridgeTestTone(),'google_tts_test_tone');
  if(typeof args.text!=='string'||!args.text.trim()||args.text.length>500)
    return failure('INVALID_ARGS','Speech text must contain 1–500 characters.');
  var voice=args.voice===undefined?configuredVoice():args.voice;
  if(!validVoice(voice))return failure('INVALID_ARGS','Invalid Google voice name.');
  var token=await Pebble.secureStorage.getItem(KEY);
  if(!token)return failure('AUTH_REQUIRED','Configure Google TTS API key in plugin settings.');
  try{
    var audioConfig={audioEncoding:'LINEAR16',sampleRateHertz:16000};
    // Chirp 3 HD voices do not support standard speakingRate.
    if(voice.indexOf('-Chirp3-HD-')<0)audioConfig.speakingRate=0.92;
    var response=await fetch('https://texttospeech.googleapis.com/v1/text:synthesize',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':token},
      body:JSON.stringify({input:{text:args.text},voice:{languageCode:voice.split('-').slice(0,2).join('-'),name:voice},audioConfig:audioConfig})
    });
    if(!response.ok){
      if(response.status===401||response.status===403)return failure('AUTH_REQUIRED','Google TTS key or permission rejected.');
      if(response.status===429)return failure('RATE_LIMITED','Google TTS quota or rate limit exceeded.');
      if(response.status===400)return failure('INVALID_ARGS','Google TTS rejected the voice or request.');
      return failure('PLUGIN_UNAVAILABLE','Google TTS HTTP '+response.status);
    }
    var result=await response.json();
    if(!result||typeof result.audioContent!=='string')
      return failure('PLUGIN_UNAVAILABLE','Google TTS returned no WAV audio.');
    var bytes=base64Decode(result.audioContent);
    if(bytes.length<44||bytes.length>MAX_TTS_BYTES)
      return failure('PLUGIN_UNAVAILABLE','Google TTS audio is empty or exceeds size limit.');
    var parsed=wavPcm16(bytes);
    if(!parsed.ok)return failure('PLUGIN_UNAVAILABLE',parsed.error);
    var pcm=resample8k(parsed.samples,parsed.rate);
    var session=packageWavSession(pcm,'google_cloud');
    if(session.ok){
      session.data.audio_diagnostics.input_rate=parsed.rate;
      session.data.audio_diagnostics.voice=voice;
      session.data.audio_diagnostics.binary_transport='base64_json';
      session.data.audio_diagnostics.input=pcmStats(parsed.samples,parsed.rate);
    }
    return session;
  }catch(e){return failure('PLUGIN_UNAVAILABLE','Google TTS failed to synthesize or decode audio.');}
}
Pebble.registerActionHandler(async function(request,respond){
  var args=request.args||{},r;
  switch(request.action){
    case 'get_config':r={ok:true,data:{configured:!!(await Pebble.secureStorage.getItem(KEY)),voice:configuredVoice(),audio_format:'pcm_s16le_wav',sample_rate:8000}};break;
    case 'tts_prepare':r=await prepareTts(args);break;
    case 'tts_chunk':r=ttsChunk(args);break;
    case 'tts_release':{
      var id=String(args.session_id||'');
      if(!/^tts[a-z0-9]+$/.test(id)){r=failure('INVALID_ARGS','Invalid session_id');break;}
      deleteTtsSession(id);
      localStorage.setItem(TTS_INDEX_KEY,JSON.stringify(sessionList().filter(function(x){return x!==id;})));
      r={ok:true,data:{released:true}};break;
    }
    default:respond.error('INVALID_REQUEST','Unknown action');return;
  }
  if(!r.ok){respond.error(r.code,r.message);return;}
  respond.ok({text:JSON.stringify(r.data).slice(0,20000)});
});
Pebble.registerConfigHandler(async function(message,respond){
  var m=message||{};
  if(m.type==='status'){
    respond({ok:true,configured:!!(await Pebble.secureStorage.getItem(KEY)),voice:configuredVoice()});return;
  }
  if(m.type==='save'){
    if(!validVoice(m.voice)){respond({ok:false,error:'Select a valid Google TTS voice.'});return;}
    var key=typeof m.api_key==='string'?m.api_key.trim():'';
    if(key)await Pebble.secureStorage.setItem(KEY,key);
    if(!(await Pebble.secureStorage.getItem(KEY))){respond({ok:false,error:'Enter a Google Cloud TTS API key.'});return;}
    localStorage.setItem(VOICE_KEY,m.voice);
    respond({ok:true,configured:true,voice:m.voice});return;
  }
  if(m.type==='forget'){
    await Pebble.secureStorage.removeItem(KEY);
    localStorage.removeItem(VOICE_KEY);
    cleanTtsSessions().forEach(deleteTtsSession);
    localStorage.removeItem(TTS_INDEX_KEY);
    respond({ok:true});return;
  }
  respond({ok:false,error:'Unknown configuration request.'});
});
