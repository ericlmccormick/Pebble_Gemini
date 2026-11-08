# Gemini Conversation plugin (prototype)
Independent, plugin-only Pebble project. Source copied out into its own repository later without modification.
## Setup
Build from this directory with plugin-capable Pebble tooling. In Pebble plugins, install this plugin, open its settings, and enter your own Google Gemini Developer API key. The consumer Gemini subscription does not provide API credits.
## Permissions and API
Plugin UUID: `2c5edc42-b096-4f76-b284-1f27907e6501`. Required consuming-app `pebble.usesPermissions`:
```json
[{"name":"GeminiConverse","plugin":"2c5edc42-b096-4f76-b284-1f27907e6501"},{"name":"InvokeAction","plugin":"2c5edc42-b096-4f76-b284-1f27907e6501"}]
```
- `conversation({text,conversation_id?,instructions?,model?})` → `{text,conversation_id,model}` inside `result.text` JSON. Reuse `conversation_id` on later turns. History remains in this plugin's local storage; up to 3 Q&A pairs per session, 12 sessions.
- `get_config({})` → `{configured,model}` (also requires `GeminiRead` permission).
- `clear_conversation({conversation_id})` or `clear_conversation({all:true})`.
No TTS or audio, intentionally. Another app can combine this with the standalone Google TTS plugin.
Security: credentials in secureStorage, never returned; network requests to the official Gemini API, with key in the request header. API quotas and costs are the user's responsibility. Plugin API is currently preview and subject to change.

## Model selection and pricing (v0.2.0)
The phone plugin settings have a responsive light/dark layout, a **model dropdown**, a price panel, and a **Refresh available models** control. Refresh uses the user's Gemini Developer API key against Google's official `/v1beta/models` endpoint. Only models advertising `generateContent` and suitable for a text conversation are listed; incompatible image, live-audio, TTS, transcription, embedding and research endpoints are excluded.

Without a key or network connection the page shows a clearly marked, non-exhaustive list of common models. Unknown model prices are labeled *price not listed*; they are not assigned invented rates. Published paid standard pricing (input and output per 1M text tokens) and relative cost tiers are displayed next to the selected model. Some 3.6–3.8 Flash pricing is promotional through December 2026; older 2.5 models may not be available for all accounts. The live model list does not provide prices. Always check [Google's current pricing](https://ai.google.dev/gemini-api/docs/pricing/).

Additional read-only action: `list_models({})` returns `{models:[{id,name,description}],checkedAt,hasMore?}` for the authenticated account (requires `GeminiRead` and `InvokeAction` plugin permissions). No credentials are returned.
