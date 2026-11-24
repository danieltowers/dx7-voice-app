// Written by scripts/write_hardware_messages.py (.venv/Scripts/python scripts/write_hardware_messages.py); do not edit.
// Complete System Exclusive messages at address 1, made by the dx7 core's
// single_voice_message and single_addendum_message from the committed dataset.
export default {
  "command": ".venv/Scripts/python scripts/write_hardware_messages.py",
  "core": {
    "name": "BRASS 1",
    "source": "DX7 ROM1A slot 1, as published",
    "voice": "F0 43 00 00 01 1B 31 63 1C 44 62 62 5B 00 27 36 32 01 01 04 00 02 52 00 01 00 07 4D 24 29 47 63 62 62 00 27 00 00 03 03 00 00 02 62 00 01 00 08 4D 24 29 47 63 62 62 00 27 00 00 03 03 00 00 02 63 00 01 00 07 4D 4C 52 47 63 62 62 00 27 00 00 03 03 00 00 02 63 00 01 00 05 3E 33 1D 47 52 5F 60 00 1B 00 07 03 01 00 00 00 56 00 00 00 0E 48 4C 63 47 63 58 60 00 27 00 0E 03 03 00 00 00 62 00 00 00 0E 54 5F 5F 3C 32 32 32 32 15 07 01 25 00 05 00 00 04 03 18 42 52 41 53 53 20 20 20 31 20 2B F7"
  },
  "addendum": {
    "name": "BRASS 1 +A",
    "source": "BRASS 1 with a distinctive DX7II addendum",
    "voice": "F0 43 00 00 01 1B 31 63 1C 44 62 62 5B 00 27 36 32 01 01 04 00 02 52 00 01 00 07 4D 24 29 47 63 62 62 00 27 00 00 03 03 00 00 02 62 00 01 00 08 4D 24 29 47 63 62 62 00 27 00 00 03 03 00 00 02 63 00 01 00 07 4D 4C 52 47 63 62 62 00 27 00 00 03 03 00 00 02 63 00 01 00 05 3E 33 1D 47 52 5F 60 00 1B 00 07 03 01 00 00 00 56 00 00 00 0E 48 4C 63 47 63 58 60 00 27 00 0E 03 03 00 00 00 62 00 00 00 0E 54 5F 5F 3C 32 32 32 32 15 07 01 25 00 05 00 00 04 03 18 42 52 41 53 53 20 31 20 2B 41 7F F7",
    "addendum": "F0 43 00 05 00 31 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 02 0C 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 32 00 00 00 32 00 0B 16 21 00 37 42 4D 00 07 00 7F F7",
    "panel": [
      {
        "parameter": "key mode",
        "value": "UNISON POLY",
        "byte": 15,
        "yamaha": 15
      },
      {
        "parameter": "unison detune depth",
        "value": 7,
        "byte": 47,
        "yamaha": 72
      },
      {
        "parameter": "pitch bend range",
        "value": 12,
        "byte": 16,
        "yamaha": 16
      },
      {
        "parameter": "foot controller 2 pitch modulation range",
        "value": 11,
        "byte": 39,
        "yamaha": 64
      },
      {
        "parameter": "foot controller 2 amplitude modulation range",
        "value": 22,
        "byte": 40,
        "yamaha": 65
      },
      {
        "parameter": "foot controller 2 eg bias range",
        "value": 33,
        "byte": 41,
        "yamaha": 66
      },
      {
        "parameter": "midi control pitch modulation range",
        "value": 55,
        "byte": 43,
        "yamaha": 68
      },
      {
        "parameter": "midi control amplitude modulation range",
        "value": 66,
        "byte": 44,
        "yamaha": 69
      },
      {
        "parameter": "midi control eg bias range",
        "value": 77,
        "byte": 45,
        "yamaha": 70
      }
    ]
  }
};
