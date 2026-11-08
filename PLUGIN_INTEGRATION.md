# WISP — Wrist Intelligence & Speech Portal · plugin integration

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

## v1.6.3 — Speech-provider simplification
Speech provider is now **None**, **Google Cloud TTS plugin**, or **Direct TTS (legacy)**. The ENABLE_TTS toggle has been removed. None is a fully text-only mode. New installs default to Gemini Conversation and Google Cloud TTS plugins. Existing direct API keys/providers remain untouched; users with an explicitly disabled old speech toggle are migrated once to None. Direct TTS key/voice fields appear only for Direct mode.

## v1.6.4 — Installed agent discovery
The phone app calls `Pebble.enumeratePlugins()` whenever the configuration page opens and adds any installed agent with a `send_to_agent({message})` action. This includes Grok Bot, Muse, ChatGPT and Claude when installed. The Gemini Conversation plugin remains the new-install default and uses its own full-reply `conversation` action. Legacy direct Gemini remains available. Other plugins are labeled **send only**, since their action contract returns a message-delivery receipt rather than an assistant response. Sending via a send-only agent shows confirmation on the watch but does **not** synthesize that receipt through TTS. Grok has a separate read action, not yet integrated. Third-party plugin invocations require user approval. If the selected plugin is uninstalled, the old choice remains labeled unavailable until changed; no hidden provider switch occurs. Provider discovery does not add plugin permissions dynamically to the manifest; built-in UUID declarations include InvokeAction for Grok Bot, Muse, ChatGPT and Claude.

## v1.7.0 — Core Devices agent compatibility
All installed agent choices use the standard `send_to_agent({message})` action, including AI Conversation v0.4.0. The old plugin-specific `conversation` call has been removed. The plugin itself chooses provider/model and maintains its default chat. Replies carrying explicit `reply_type:'assistant'`, validated response metadata, and matching universal plugin UUID are displayed and sent to Google TTS; send-only agents show their actual receipts without speech. The previous stored 'plugin' setting migrates to the universal agent selection. Direct Gemini mode remains optional.

## v2.0.0 — WISP rebrand
- Renamed the same app from **Gemini with Voice** to **WISP**. Expanded name: **Wrist Intelligence & Speech Portal**.
- The watch displays **WISP**; the phone settings header and README/store listing include the expanded name.
- Preserved watch app UUID `426c68c7-bdd7-445a-860a-ea587a188993`, persisted settings keys, existing agent selection, and independent speech plugin.
- Package name is now `wisp`; no new app or separate install is necessary.
- This naming update does not change the on-watch logo resource images; those remain the existing artwork until a separate replacement design is selected.
