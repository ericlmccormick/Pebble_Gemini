# Gemini Conversation + Google Cloud TTS plugin integration (experimental)

Three branches in this repository (no changes to `main`):
- `feature/gemini-conversation-plugin`: standalone Gemini text conversation plugin in `plugins/gemini-conversation/`.
- `feature/google-tts-plugin`: standalone Google Cloud TTS plugin in `plugins/google-tts/`, including versioned MIT Home Assistant-derived audio SDK.
- `feature/gemini-plugin-integration`: both plugin directories plus Gemini watch-app integration.

## How the app works
- Backends are independently selectable in watchapp settings. New installs default to plugins; existing users with direct API keys stay on direct mode until they opt in.
- Gemini text request → Gemini plugin `conversation` → return text + `conversation_id`. Plugin stores the API key; app stores only its conversation ID.
- Optional Google TTS plugin `tts_prepare` → verified WAV header and first chunk → rolling `tts_chunk` requests with per-chunk and whole-WAV checksums → 8 kHz mono PCM16 → existing app IMA-ADPCM encoding → 360-byte acknowledged AppMessages → Pebble Time 2/Duo speaker.
- The existing watch C decoder and ACK/SEQ streaming protocol are deliberately preserved. **Do not install the copied Home Assistant audio watch SDK in this app without also migrating the C protocol.** The included `google_tts_stream.js` is an adapter inspired by the HA SDK and uses its exact plugin-side TTS session contract.
- Both plugins can be used separately by other apps; Google TTS doesn't need Gemini; Gemini plugin doesn't require TTS.
- Plugin app permission prompts are required; API access and Google Cloud TTS may incur separately billed charges.

## Build
Pushes automatically run the plugin unit tests and package each independent .pbw through the pinned Core Devices packer. The existing native watch build workflow should be run against this branch with **SDK 4.44+** because plugin permissions require manifest v2. The feature branch has not been hardware-validated.

## Plan for splitting repositories
Copy `plugins/gemini-conversation/` and `plugins/google-tts/` each to the root of a separate repository, preserving UUIDs, action names and the 6000-byte chunk format. Keep copies of the audio SDK pinned to a commit. Then update the app's dependency documentation, not its plugin IDs.
