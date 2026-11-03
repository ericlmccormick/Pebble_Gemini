# Gemini 1.5.0 audio transport

This branch introduces a watch-acknowledged, sequential audio transport. The goal is to begin spoken answers promptly, without sacrificing complete sentence playback. Both the C watch app and the PebbleKit JS file are required; installing only one will not work.

## Playback and startup

- Output format: signed mono **8-kHz, 16-bit PCM** to the speaker, carried as **4-bit IMA ADPCM** over AppMessage (~4,000 encoded bytes per second of speech).
- The old settings for 16-kHz / 8-bit playback were removed because the corresponding modes were not implemented in the decoder/output. A single reliable format is used across platforms.
- Each generated sentence is encoded sequentially; the ADPCM predictor is carried between sentences.
- Short sentences (up to 4,800 encoded bytes, about 1.2 seconds of audio) start when their complete compressed audio is buffered.
- Longer sentences can begin once the ring contains enough reserve: normally ~2,400 bytes (0.6 seconds) on a sufficiently fast link, ~3,600 bytes on a marginal link, or a larger amount if the measured BLE transfer rate is below real-time playback.
- The watch re-evaluates startup reserve as the phone measures actual transfer speed. When an unexpected connection stall causes underrun, it pauses and builds a larger reserve rather than discarding samples. Network pauses can still cause a noticeable gap; **no finite buffer can guarantee uninterrupted playback under arbitrary Bluetooth outages.**
- The Pebble speaker hardware may accept a partial PCM write. We retain and retry remaining PCM bytes before decoding more.

## Delivery protocol

One in-flight data packet at a time. Every `AUDIO_CHUNK` includes `STREAM_ID`, `SEQ`, `SENTENCE_TOTAL`, `BUFFER_HINT`, and `CHUNK` (up to 360 bytes). The watch accepts it only for its active session and next expected sequence. It acknowledges accepted data with `AUDIO_ACK` and reports buffer capacity in `BUFFER_FREE`. A duplicate packet is acknowledged again, but never inserted twice. `AUDIO_WAIT` means the ring lacks space, so the sender retries the *same* sequence later. `AUDIO_SENTENCE_END` is also sequence-acknowledged.

The phone invalidates old requests when a new dictation response starts, guards stale Gemini/TTS callbacks, limits failed send attempts, and reports audio failure without deleting the text answer.

## Basic regression test

Run from the repository root:

```sh
node tests/pkjs_protocol_test.js
```

This tests WAV decoding, ADPCM output length, packet ordering, duplicate/stale acknowledgments, and cancellation. It does not replace on-watch compilation or Bluetooth/speaker testing.

## Watch test matrix

1. Ask a short question, then a long one. Verify prompt text arrives before audio, and audio starts after a short safe buffer.
2. Ask for a multi-sentence reply. Listen for all sentence endings, no clicks/dropouts, and no permanently visible buffering label.
3. Ask a new question while a previous answer is speaking. Verify the prior audio stops and the new answer does not mix with it.
4. Temporarily interrupt Bluetooth for a few seconds. Verify retry/rebuffering rather than duplicate, reordered, or dropped speech. Extended loss may end audio while leaving text intact.
5. Disable TTS; turn volume down to 0; then re-enable. Each should preserve text-only responses and saved keys.
6. Save Clay settings without entering API keys again. Existing keys must remain saved.
7. Test one non-speaker platform (e.g. basalt/chalk) for text-only behavior and one speaker platform (emery) for playback.
8. Test emoji/accented responses for valid UTF-8 watch messages.

**Known limits:** This is an implementation branch. No Pebble SDK compilation, physical speaker/BLE throughput testing, or deployment to CloudPebble has been performed here. The latest hardware speaker API confirms that stream writes can be partial, which the current watch code handles.
