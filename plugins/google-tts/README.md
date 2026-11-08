# Google Cloud TTS plugin (prototype)

Standalone Google Cloud Text-to-Speech plugin based on the independently tested Home Assistant Bridge session transport. **No Gemini dependency**: any watch app can ask it to speak arbitrary text. Consumer Google AI subscriptions do not grant Cloud TTS credits.

## Plugin API
UUID `2c5edc42-b096-4f76-b284-1f27907e6502`.
```json
[{"name":"GoogleTtsSpeak","plugin":"2c5edc42-b096-4f76-b284-1f27907e6502"},{"name":"InvokeAction","plugin":"2c5edc42-b096-4f76-b284-1f27907e6502"}]
```
`tts_prepare({text,voice?,test_tone?})` returns an HA SDK v1 compatible JSON payload under `result.text`: `session_id`, `length`, `chunk_bytes=6000`, `format=pcm_s16le_wav`, `sample_rate=8000`, `channels=1`, `bits_per_sample=16`, `sample_count`, `wav_checksum`, `first_chunk`, `first_chunk_checksum`.
`tts_chunk({session_id,offset})` → `{offset,length,audio,checksum,done}`. `tts_release({session_id})` deletes temporary audio.
`get_config({})` → `{configured,voice,audio_format,sample_rate}` (requires `GoogleTtsRead` permission).

The first chunk is inlined to reduce plugin round trips. Per-chunk and whole-WAV FNV-1a checksums ensure no corrupted audio is played; temporary chunks survive plugin restarts in localStorage and have a bounded TTL. Three concurrent sessions allow next-sentence prefetch.
Source Google LINEAR16 WAV can be 8–48kHz; the plugin uses the **exact Home Assistant Bridge WAV parser and 8kHz windowed-sinc resampler**, then emits canonical PCM16 WAV. Keys use Pebble secureStorage. Do not copy credentials into a watch app.

## Reusable audio SDK
The `sdk/` directory contains MIT-licensed copies of the Home Assistant Bridge audio transport SDK with its default plugin UUID changed to Google Cloud TTS. Copy matching `google_tts_audio.js`, `google_tts_audio.c`, and `google_tts_audio.h` to a compatible app. JS consumes plugin tts_prepare/chunk/release and encodes IMA-ADPCM; watch C handles native playback and `AUDIO_* ` AppMessages. All consuming apps still need to compile a native watch C module for speaker access. Source base: [Home Assistant Bridge SDK](https://github.com/ericlmccormick/Pebble-HA-plug-in/tree/main/sdk).
Do not mix this SDK's `AUDIO_RESET/AUDIO_CHUNK` packet protocol with the older Gemini watch's acknowledged `AUDIO_ACK/SEQ` protocol without an adapter.

Build from this directory with plugin-capable Pebble tooling. Test the bridge with `tts_prepare({test_tone:true})` even before configuring an API key. Google Cloud API usage is separately billed.

## Settings layout and voice rates (v0.2.0)
The settings page follows the Home Assistant Bridge visual pattern with readable mobile layouts, light/dark colors, large inputs and separate connection, voice and privacy panels. The default voice dropdown groups the 12 established US-English WaveNet, Neural2 and Chirp 3 HD voices.

The displayed paid rates are WaveNet $4, Neural2 $16 and Chirp 3 HD $30 per 1 million synthesized characters, after free allowances. Actual costs and allowances depend on Google Cloud billing and can change; consult [Google Cloud Text-to-Speech pricing](https://cloud.google.com/text-to-speech/pricing).
