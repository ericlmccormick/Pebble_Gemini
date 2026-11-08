/* Google Cloud TTS Bridge reusable watch audio SDK v1. MIT License.
 * Copy ha_audio.h and ha_audio.c to src/c.
 * The app owns AppMessage registration; pass received dictionaries to
 * google_tts_audio_handle_message(). No Home Assistant credentials on the watch.
 */
#ifndef GOOGLE_TTS_BRIDGE_AUDIO_H
#define GOOGLE_TTS_BRIDGE_AUDIO_H
#include <pebble.h>
void google_tts_audio_init(void);
void google_tts_audio_deinit(void);
void google_tts_audio_stop(void);
bool google_tts_audio_handle_message(DictionaryIterator *iterator);
void google_tts_audio_set_volume(float volume);
bool google_tts_audio_is_playing(void);
#endif
