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
The new mobile settings page provides a Google-key-based model refresh, text-generation-only model dropdown, and indicative input/output token pricing with relative cost tiers. The optional `list_models` read action exposes `{models,checkedAt,hasMore}` with the `GeminiRead` permission. Unlisted or newly added models show "price not listed" rather than guessed rates. Source: https://ai.google.dev/gemini-api/docs/pricing/.
