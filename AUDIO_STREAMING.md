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

## Release-hardening additions (1.5.0)

- **Conversation retention:** Only the last three complete user/model turns are retained, with an additional 8,000-character storage budget. Malformed and incomplete saved conversations are ignored.
- **Conversation deletion:** Settings > Conversation & Privacy > Clear Conversation History on Save. This deletes saved Q&A content without removing API keys or voice preferences.
- **Network failures:** Gemini requests expire after 30 seconds, and each TTS request after 20 seconds. Errors identify missing permissions/API keys, quotas, and timeouts without exposing credentials.
- **Privacy and billing:** Prompts and conversation context are submitted to the Gemini API; text from answers is sent to Google Cloud TTS when voice is enabled. API keys and saved conversation context are kept in PebbleKit localStorage, not explicitly encrypted by this app. Costs depend on the Google services and selected voice family.
- **Lifecycle:** The spinner stops when leaving the thinking screen and on window unload; volume timers are canceled, and speaker playback is reset when a new answer arrives.
- **Version consistency:** Both package version and pebble.version are 1.5.0.
- **CI:** `.github/workflows/js-tests.yml` runs Node syntax checks and the regression script on push and pull requests.

### Required manual release checks

1. CloudPebble: import/update **both** `src/pkjs/index.js` and `src/c/main.c`, along with `package.json`. Confirm the generated message key IDs match the new protocol.
2. Compile all platforms listed in `package.json` (basalt, chalk, diorite, emery) using CloudPebble or Pebble SDK; review warnings and memory usage. This is **not yet verified** by the regression tests.
3. On a speaker-equipped watch, test short and long answers, early playback, TTS cost tiers, multiple sentences, and interruption during streaming.
4. On a nonspeaker watch, verify text-only mode and readable results.
5. Force a network outage and a rate-limited or invalid-key response; verify the displayed errors are understandable and do not delete prior history.
6. Clear conversation via settings, reopen settings, verify history stays cleared and API keys are unchanged; then ask a question.
7. Test settings changes while audio is in progress, and long answers containing emoji/accented characters.

### Release decision

Do not merge the draft PR or publish until the SDK builds and on-watch smoke test are satisfactory. Tests cover the protocol simulation and JavaScript behavior but **not** the actual Bluetooth stack, native speaker driver, or SDK platform headers.

## Continuous amplifier session (1.5.0 audio-pop fix)

The watch now treats each spoken answer as **one speaker session**, even though synthesis and Bluetooth transfer are divided into multiple sentences.

- `AUDIO_SENTENCE_END` marks a sentence's tail for decoding, but **does not close the speaker**.
- When the audio ring becomes empty while the phone is preparing another sentence, the watch sends zero-valued PCM to the already-open speaker. This keeps the hardware stream active and reduces amp power-cycling pops between sentences.
- Only after all TTS requests have completed, all audio chunks and sentence boundaries have been acknowledged, the phone sends a sequenced `AUDIO_STREAM_END` marker. The watch keeps playing until its compressed ring and pending decoded PCM are empty, then outputs a brief silent tail before calling `speaker_stream_close()`.
- If the phone disappears mid-answer, an approximately 30-second idle failsafe prevents the amplifier remaining powered indefinitely. A new answer or manual stop still closes the old session immediately.
- The end marker follows the existing session ID, sequence number, and ACK/retry protocol; it is not sent at every sentence boundary.
- **Tradeoff:** Keeping the speaker open consumes more power during inter-sentence TTS pauses. This is intentional, and the added idle failsafe bounds that cost.

### Targeted watch checks

1. Play a 4–5 sentence answer with noticeable synthesis gaps. Listen for no click/pop between sentences and verify the speaker closes after the entire response.
2. Ask another question immediately afterward, and interrupt one answer with the Select button.
3. Disconnect Bluetooth between sentences, then reconnect. Verify the amplifier does not turn off during the normal pause, and the idle failsafe eventually releases it if the phone never resumes.
4. Verify the final sentence is not truncated, and that the 700-ms silent tail does not produce an audible extra word or a prolonged hum.

The Node CI suite checks phone-side final-marker sequencing. Actual amplifier behavior must be validated on Pebble hardware.

## PCM pacing fix for comma/phrase stutters

Keeping the amplifier continuously active revealed a separate scheduling issue: the watch previously decoded 800 ADPCM bytes (200 ms of speech) and immediately appended silence on a transient empty compressed ring. The hardware could have already queued real PCM, so silence was inadvertently inserted *before the next spoken words*, exaggerating ordinary comma pauses.

The playback loop now:
- Decodes **up to 160 ADPCM bytes (40 ms)** at a time, even if the current sentence has not reached its end marker.
- Calls the speaker on a **35-ms refill interval**, retaining any unwritten partial PCM for the next attempt.
- Only writes keep-alive silence on a tick when **neither pending PCM nor compressed bytes are available**.
- Uses **30-ms silence frames** so they do not accumulate in the speaker FIFO faster than the 35-ms timer interval.
- Keeps the amplifier open across all sentences until the acknowledged `AUDIO_STREAM_END` plus its final drain period.

This specifically reduces artificial pauses caused by buffering and silence insertion; punctuation pauses naturally present in the synthesized speech remain unchanged. The 16-KB compressed ring, sequenced ACK transport, adaptive *initial* buffering and explicit final amp shutdown are preserved.

On-device regression check: have Gemini say a long sentence with several commas (no periods) followed by multiple sentences. Check that commas sound natural, syllables do not break up, there are no between-sentence pops, and the final word is complete.

## Supported watches (1.5.0)

The native package now targets basalt, chalk, diorite, flint, emery and gabbro. All six have a microphone for spoken dictation. Phone-side speaker detection enables synthesized replies for Flint (Pebble 2 Duo) and Emery (Pebble Time 2) only. Basalt, Chalk, Diorite and Gabbro (Pebble Round 2) show the answer as text; Round 2 has no speaker. Aplite (original Pebble/Steel) is excluded because it has no microphone and this app currently provides no alternative question input.

Flint uses the existing Diorite black-and-white logo. Gabbro uses the Chalk round logo. Both share the existing native PBL_ROUND/PBL_SPEAKER compile-time paths. Recheck actual speaker playback on Flint hardware when a device becomes available. The six-platform Pebble SDK build is now checked in GitHub Actions, in addition to the JavaScript and protocol regression suite.
