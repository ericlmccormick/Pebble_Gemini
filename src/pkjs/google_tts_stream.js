/* Google Cloud TTS -> Gemini watch bridge.
 * Uses the HA Bridge's verified 6000-byte WAV session format and
 * rolling 3-request chunk window; preserves existing Gemini watch-level
 * ACK/SEQ/STREAM_ID speaker protocol by yielding ADPCM segments.
 * Avoids the incompatible HA watch AUDIO_RESET packet format.
 */
'use strict';
var DEFAULT_PLUGIN_ID='2c5edc42-b096-4f76-b284-1f27907e6502';
var B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decode64(input){
  if(typeof input!=='string'||input.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(input))
    throw Error('Invalid Google TTS base64 chunk');
  var out=[],b=0,n=0;
  for(var i=0;i<input.length;i++){var v=B64.indexOf(input.charAt(i));if(v<0)break;
    b=(b<<6)|v;n+=6;if(n>=8){n-=8;out.push((b>>n)&255);}}
  return out;
}
function hash(bytes,prior){
  var h=prior===undefined?2166136261>>>0:prior>>>0;
  for(var i=0;i<bytes.length;i++)h=Math.imul((h^bytes[i])>>>0,16777619)>>>0;
  return h>>>0;
}
function parse(reply,label){
  if(!reply||!reply.ok)throw Error(label+': '+String(reply&&reply.message||'plugin unavailable or permission denied'));
  try{return JSON.parse(reply.text||'{}');}
  catch(e){throw Error(label+': invalid plugin JSON');}
}
module.exports={create:function(options){
  options=options||{};
  var Pebble=options.Pebble,pluginId=options.pluginId||DEFAULT_PLUGIN_ID;
  if(!Pebble||typeof Pebble.invokeAction!=='function')throw Error('Pebble plugin support required');
  if(typeof options.encodeADPCM!=='function')throw Error('ADPCM encoder required');
  function action(name,args){return Pebble.invokeAction({plugin:pluginId,action:name,args:args});}
  function stream(sentence,handlers){
    handlers=handlers||{};
    var cancelled=handlers.cancelled||function(){return false;};
    var onChunk=handlers.onChunk;
    if(typeof onChunk!=='function')return Promise.reject(Error('onChunk callback required'));
    var sid='',rolling=2166136261>>>0,count=0,prev1=0,prev2=0;
    var totalLength=0,totalSamples=0,expectHash=0,step=6000;
    function check(){if(cancelled())throw Error('TTS cancelled');}
    function emit(offset,b64,checksum){
      check();
      var bytes=decode64(b64);
      if(bytes.length!==Math.min(step,totalLength-offset)||hash(bytes)!==(checksum>>>0))
        throw Error('Google TTS WAV chunk checksum mismatch at '+offset);
      if(offset===0){
        function tag(p){return String.fromCharCode(bytes[p],bytes[p+1],bytes[p+2],bytes[p+3]);}
        function u16(p){return bytes[p]|bytes[p+1]<<8;}
        function u32(p){return (bytes[p]|bytes[p+1]<<8|bytes[p+2]<<16|bytes[p+3]<<24)>>>0;}
        if(bytes.length<44||tag(0)!=='RIFF'||tag(8)!=='WAVE'||tag(12)!=='fmt '||
          tag(36)!=='data'||u16(20)!==1||u16(22)!==1||u32(24)!==8000||
          u16(34)!==16||u32(40)!==totalSamples*2)
          throw Error('Google TTS WAV header mismatch');
      }
      rolling=hash(bytes,rolling);
      var first=offset===0?44:0,pcm=[];
      if((bytes.length-first)%2)throw Error('Unaligned Google TTS PCM chunk');
      for(var p=first;p<bytes.length;p+=2){
        var sample=bytes[p]|bytes[p+1]<<8;
        if(sample>32767)sample-=65536;
        var filtered=count<2?sample:(sample+prev1+prev2)/3;
        pcm.push(filtered);
        prev2=prev1;prev1=sample;count++;
      }
      var last=offset+bytes.length===totalLength;
      if(last&&(rolling>>>0)!==expectHash)throw Error('Google TTS WAV final checksum mismatch');
      if(last&&count!==totalSamples)throw Error('Google TTS sample count mismatch');
      var adpcm=options.encodeADPCM(pcm);
      return Promise.resolve(onChunk(adpcm,last,Math.ceil(totalSamples/2)));
    }
    function chunks(start){
      // Rolling 3-request pipeline: fetches may complete out of order,
      // but byte order and ADPCM predictor state are preserved.
      return new Promise(function(resolve,reject){
        var nextRequest=start,nextEmit=start,active=0,draining=false,finished=false,held={};
        function fail(e){if(finished)return;finished=true;reject(e);}
        function schedule(){
          if(finished)return;
          try{check();}catch(e){fail(e);return;}
          while(active<3&&nextRequest<totalLength&&nextRequest-nextEmit<step*3){
            (function(offset){
              nextRequest+=step;active++;
              action('tts_chunk',{session_id:sid,offset:offset}).then(function(reply){
                active--;
                if(finished)return;
                var data=parse(reply,'Google TTS chunk');
                var b=decode64(data.audio||'');
                if(data.offset!==offset||b.length!==Math.min(step,totalLength-offset))
                  throw Error('Unexpected Google TTS chunk offset/length');
                held[offset]={audio:data.audio,checksum:data.checksum,length:b.length};
                drain();schedule();
              }).catch(fail);
            })(nextRequest);
          }
        }
        function drain(){
          if(finished||draining)return;
          try{check();}catch(e){fail(e);return;}
          var part=held[nextEmit];
          if(!part){
            if(nextEmit>=totalLength&&active===0){finished=true;resolve();}
            return;
          }
          delete held[nextEmit];draining=true;
          emit(nextEmit,part.audio,part.checksum).then(function(){
            nextEmit+=part.length;draining=false;schedule();drain();
          }).catch(fail);
        }
        schedule();drain();
      });
    }
    return action('tts_prepare',{text:sentence}).then(function(r){
      check();
      var meta=parse(r,'Google TTS preparation');
      if(meta.format!=='pcm_s16le_wav'||meta.sample_rate!==8000||
        meta.channels!==1||meta.bits_per_sample!==16||
        !Number.isInteger(meta.sample_count)||meta.sample_count<1||
        !Number.isInteger(meta.length)||meta.length!==44+meta.sample_count*2||
        meta.length>1500000||meta.chunk_bytes!==6000||
        !Number.isInteger(meta.wav_checksum)||!/^tts[a-z0-9]+$/.test(meta.session_id||'')||
        typeof meta.first_chunk!=='string'||!Number.isInteger(meta.first_chunk_checksum))
        throw Error('Google TTS bridge format incompatible; update plugin');
      sid=meta.session_id;totalLength=meta.length;totalSamples=meta.sample_count;expectHash=meta.wav_checksum>>>0;
      return emit(0,meta.first_chunk,meta.first_chunk_checksum).then(function(){
        return chunks(Math.min(step,totalLength));
      });
    }).then(function(){check();},function(e){throw e;}).then(function(){
      if(sid)action('tts_release',{session_id:sid}).catch(function(){});
    },function(e){
      if(sid)action('tts_release',{session_id:sid}).catch(function(){});
      throw e;
    });
  }
  return {stream:stream};
}};
