#include "pebble_process_info.h"
#include "src/resource_ids.auto.h"

const PebbleProcessInfo __pbl_app_info __attribute__((__section__(".pbl_header"), __used__)) = {
  .header = "PBLAPP",
  .struct_version = { PROCESS_INFO_CURRENT_STRUCT_VERSION_MAJOR, PROCESS_INFO_CURRENT_STRUCT_VERSION_MINOR },
  .sdk_version = { PROCESS_INFO_CURRENT_SDK_VERSION_MAJOR, PROCESS_INFO_CURRENT_SDK_VERSION_MINOR },
  .process_version = { 1, 6 },
  .load_size = 0xb6b6,
  .offset = 0xb6b6b6b6,
  .crc = 0xb6b6b6b6,
  .name = "Gemini with voice",
  .company = "Eric McCormick",
  .icon_resource_id = RESOURCE_ID_logo25,
  .sym_table_addr = 0xA7A7A7A7,
  .flags = PROCESS_INFO_PLATFORM_GABBRO,
  .num_reloc_entries = 0xdeadcafe,
  .uuid = { 0x42, 0x6C, 0x68, 0xC7, 0xBD, 0xD7, 0x44, 0x5A, 0x86, 0x0A, 0xEA, 0x58, 0x7A, 0x18, 0x89, 0x93 },
  .virtual_size = 0xb6b6
};
