# WISP — Wrist Intelligence & Speech Portal

**WISP** is a voice-enabled AI assistant for Pebble watches. Talk to your watch, get answers from the AI agent you select, and optionally hear replies on watches with speakers. The expanded name is **Wrist Intelligence & Speech Portal**.

Formerly **Gemini with Voice**. This is the same watch app (same UUID), so existing installs can update in place and keep their settings.

## AI and voice backends

- [AI Conversation plugin](https://github.com/ericlmccormick/Pebble-Gemini-plugin) — select Gemini, OpenAI, Claude, Grok, OpenRouter or DeepSeek centrally; the app uses the common Pebble `send_to_agent({message})` action and receives validated full replies.
- [Google Cloud TTS plugin](https://github.com/ericlmccormick/Pebble-Google-TTS-plugin) — optional spoken responses via the shared audio transport.
- Other installed Core Devices agent plugins with `send_to_agent` can be selected; those currently returning only delivery receipts do not produce spoken answers.

The app also retains a legacy direct Gemini API option for existing users. New installations default to AI Conversation and Google Cloud TTS where supported. Configure credentials and models in the selected plugin, not in WISP.

For technical details, see [PLUGIN_INTEGRATION.md](PLUGIN_INTEGRATION.md).

## Store listing

**Short name:** WISP

**Full name:** WISP — Wrist Intelligence & Speech Portal

**Short description:** Talk to your Pebble. Get AI responses from your preferred agent, with optional spoken answers.

**Description:** WISP (Wrist Intelligence & Speech Portal), formerly Gemini with Voice, connects your Pebble to AI conversations. Choose an installed Pebble agent plugin; the AI Conversation plugin lets you configure Gemini, ChatGPT via the OpenAI API, Claude, Grok and more in one place. WISP handles watch dictation, readable replies and optional voice playback through the separate Google Cloud TTS plugin. Full spoken answers require an agent that returns a complete reply and a watch with a speaker.
