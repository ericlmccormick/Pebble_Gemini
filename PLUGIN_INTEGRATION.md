# Gemini with Voice — plugin integration

This feature branch contains the **watch application only**. The plugins have moved to their own GitHub repositories and are now independently maintained.

| Component | Repository | UUID | Version |
| --- | --- | --- | --- |
| Gemini Conversation plugin | [Pebble-Gemini-plugin](https://github.com/ericlmccormick/Pebble-Gemini-plugin) | `2c5edc42-b096-4f76-b284-1f27907e6501` | 0.2.0 |
| Google Cloud TTS plugin | [Pebble-Google-TTS-plugin](https://github.com/ericlmccormick/Pebble-Google-TTS-plugin) | `2c5edc42-b096-4f76-b284-1f27907e6502` | 0.2.0 |
| Gemini with Voice app | [Pebble_Gemini](https://github.com/ericlmccormick/Pebble_Gemini) | Watch app UUID unchanged | 1.6.1 preview |

## Architecture
- Gemini Conversation plugin: `conversation` action returns text plus `conversation_id`. The plugin exclusively stores its Google API key and selected model. The app stores only the conversation ID.
- Google Cloud TTS plugin: `tts_prepare`, `tts_chunk`, `tts_release` return checksum-verified 8 kHz mono PCM16 WAV chunks. The app adapter converts to IMA-ADPCM and sends acknowledged 360-byte BLE AppMessages.
- The native watch decoder keeps its existing `AUDIO_ACK/SEQ/STREAM_ID` protocol, which differs from Home Assistant's `AUDIO_RESET` protocol. Do not mix them.
- Either plugin can be installed and used independently with compatible apps.
- New installs select plugin providers by default. Existing direct API key users remain in direct mode unless they opt in. Plugin-selected settings hide direct key/model/voice fields but preserve their saved values.

## Development and installation
- Install/configure the plugins from their own repositories. Each plugin has its own CI, downloadable PBW, tests and permanent source-of-truth.
- Build the app on the `feature/gemini-plugin-integration` branch. CI builds six native platforms and publishes the **watch app PBW only** to `builds/plugin-previews`.
- The original `feature/gemini-conversation-plugin` and `feature/google-tts-plugin` branches in this repository are historical staging snapshots; do not publish new plugin releases from them.
- Cloud usage is billed separately from personal Gemini subscriptions. Plugin permissions require a compatible Pebble phone app. These are development builds pending physical watch validation.

## 1.6.2: Clay webview-only visibility fix
The Clay settings callback is serialized into its own browser context. Earlier app code accidentally referenced outer PebbleKit JS variables (`geminiBackend`, `ttsBackend`, `enableTts`) from that callback and failed before hiding any fields. The callback is now fully self-contained and driven only by actual Clay selector values. On opening settings, the app also synchronizes provider selections from its saved state into Clay's cached settings so stale legacy settings cannot override selected plugins.

The regression test now executes the callback in a separate JavaScript VM, checks plugin/legacy changes live, checks speaker toggling, and verifies direct API credentials aren't overwritten while hidden. Plugin UUIDs and the established audio protocol are unchanged.
