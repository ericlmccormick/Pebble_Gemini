# Gemini with voice — legacy Pebble app

**Current source version:** 1.4.4. **Display name:** Gemini with voice.

This repository preserves the original standalone Gemini voice app. The separate **[WISP](https://github.com/ericlmccormick/Pebble-WISP)** project is its unreleased successor and should not be confused with this released app.

## Setup

Install the PBW and open its settings in the Pebble phone app. Provide a Gemini API key and select a supported Gemini model. On speaker-equipped watches, optionally enable spoken replies and configure a **Google Cloud Text-to-Speech API key** and voice. Gemini API and Google Cloud TTS access may require separate billing/permissions. TTS defaults off on new installs unless an existing saved TTS key enables the upgrade behavior.

The app stores settings and chat history on the phone. This legacy integration contacts Google APIs directly; it does **not** require Universal AI or Universal TTS plugins.

## Platforms and development

The manifest targets Basalt, Chalk, Diorite and Emery; audio output requires compatible speaker hardware. The manifest and `src/pkjs/index.js` are the source of truth for settings and API behavior. Build using a compatible Pebble SDK or [the build workflow](.github/workflows/direct-pbw.yml).

## Support

Do not include API keys in bug reports. Include watch model, Pebble app version and whether text works independently of speech. https://ko-fi.com/ericmccormick
