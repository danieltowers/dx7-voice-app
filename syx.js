// Reading a .syx file of DX7 voices, as a DX7, an archive or Dexed's "Save
// cart" writes it, into banks the library page can list. Nothing leaves the
// device: the file is read here and its banks kept in IndexedDB (library.js).
//
// What is read, the same as the core's dataset reader (src/dx7/bank.py):
// - 32-voice bank dumps, F0 43 0n 09 20 00, 32 packed voices of 128 bytes, a
//   checksum and F7 (4104 bytes). A file may hold several, one bank each.
//   The byte count and checksum are not checked (some banks in the wild get
//   them wrong, and still load in Dexed).
// - single-voice dumps, F0 43 0n 00 01 1B, 155 bytes, a checksum and F7: all
//   of a file's single voices make one bank.
// - bare voice data: 4096 seven-bit bytes, 32 packed voices with no sysex.
// Any other message (a DX7II addendum or performance, say) is passed over:
// a voice goes out without its DX7II addendum.
//
// A packed voice is unpacked to the single-voice layout (VCED) the app sends,
// one parameter a byte, as src/dx7/edit_buffer.py does; tests/test_app_syx.py
// holds the two to the same bytes. A voice holding a value a single-voice
// message cannot carry (above 7F) has no data: its slot cannot be sent.

export const BANK_VOICES = 32;
const PACKED = 128;
const VOICE = 155;
const BANK_MESSAGE = 6 + BANK_VOICES * PACKED + 2; // 4104
const VOICE_MESSAGE = 6 + VOICE + 2; // 163

export class SyxError extends Error {}

// Whether a file is to be read as .syx rather than as a library file.
export function looksLikeSyx(bytes, fileName = "") {
  return bytes[0] === 0xf0 || /\.syx$/i.test(fileName) ||
    (bytes.length === BANK_VOICES * PACKED && bytes[0] !== 0x7b); // 7b: "{", a JSON file
}

// The banks of a .syx file: [{ name, voices: [{ name, data }] }], data the 155
// single-voice bytes or null when the voice cannot be sent. Throws a
// SyxError in plain words when the file holds no DX7 voice.
export function readSyx(bytes, fileName = "") {
  const stem = fileName.replace(/\.[^.]*$/, "") || "Bank";
  const banks = [];
  const singles = [];
  for (const message of messages(bytes)) {
    if (message.length === BANK_MESSAGE) banks.push(packedVoices(message.subarray(6, -2)).map(fromPacked));
    else singles.push(fromSingle(message.subarray(6, -2)));
  }
  if (!banks.length && !singles.length && bytes.length === BANK_VOICES * PACKED && bytes.every((b) => b < 0x80)) {
    banks.push(packedVoices(bytes).map(fromPacked));
  }
  if (singles.length) banks.push(singles);
  if (!banks.length) {
    throw new SyxError("it holds no DX7 voices (no 32-voice bank, no single voice). Open a .syx bank of DX7 voices.");
  }
  return banks.map((voices, i) => ({ name: banks.length > 1 ? `${stem} bank ${i + 1}` : stem, voices }));
}

// Each bank or single-voice dump in the file, in its order. A dump is taken
// by its header and its length, ending in F7, as the core takes a bank: a
// stray F7 inside a malformed bank's data does not cut it short. Any other
// message is passed over to its F7.
function* messages(bytes) {
  let start = bytes.indexOf(0xf0);
  while (start >= 0) {
    const yamahaDump = bytes[start + 1] === 0x43 && !(bytes[start + 2] & 0xf0);
    const length = !yamahaDump ? 0
      : bytes[start + 3] === 0x09 ? BANK_MESSAGE
      : bytes[start + 3] === 0x00 ? VOICE_MESSAGE
      : 0;
    let end;
    if (length && bytes[start + length - 1] === 0xf7) {
      end = start + length - 1;
      yield bytes.subarray(start, end + 1);
    } else {
      end = bytes.indexOf(0xf7, start + 1);
      if (end < 0) return;
    }
    start = bytes.indexOf(0xf0, end + 1);
  }
}

function packedVoices(data) {
  return Array.from({ length: BANK_VOICES }, (_, i) => data.subarray(i * PACKED, (i + 1) * PACKED));
}

function fromPacked(packed) {
  const data = unpackVoice(packed);
  return { name: nameOf(packed.subarray(118, 128)), data };
}

function fromSingle(data) {
  const copy = Uint8Array.from(data);
  return { name: nameOf(copy.subarray(145, 155)), data: copy.some((b) => b > 0x7f) ? null : copy };
}

function nameOf(bytes) {
  return String.fromCharCode(...bytes.map((b) => (b < 0x20 || b > 0x7e ? 0x20 : b))).trimEnd();
}

// The 155 single-voice bytes of a 128-byte packed voice, or null when one of
// its values is above 7F. Operator 6 comes first in both.
export function unpackVoice(p) {
  const v = new Uint8Array(VOICE);
  for (let k = 0; k < 6; k++) {
    const s = k * 17, d = k * 21;
    for (let i = 0; i < 11; i++) v[d + i] = p[s + i]; // EG rates and levels, break point, depths
    v[d + 11] = p[s + 11] & 3; // left curve
    v[d + 12] = (p[s + 11] >> 2) & 3; // right curve
    v[d + 13] = p[s + 12] & 7; // rate scaling
    v[d + 20] = (p[s + 12] >> 3) & 15; // detune
    v[d + 14] = p[s + 13] & 3; // amplitude modulation sensitivity
    v[d + 15] = (p[s + 13] >> 2) & 7; // key velocity sensitivity
    v[d + 16] = p[s + 14]; // output level
    v[d + 17] = p[s + 15] & 1; // oscillator mode
    v[d + 18] = (p[s + 15] >> 1) & 31; // frequency coarse
    v[d + 19] = p[s + 16]; // frequency fine
  }
  for (let i = 0; i < 8; i++) v[126 + i] = p[102 + i]; // pitch EG rates and levels
  v[134] = p[110] & 31; // algorithm
  v[135] = p[111] & 7; // feedback
  v[136] = (p[111] >> 3) & 1; // oscillator key sync
  for (let i = 0; i < 4; i++) v[137 + i] = p[112 + i]; // LFO speed, delay, pitch and amplitude depth
  v[141] = p[116] & 1; // LFO key sync
  v[142] = (p[116] >> 1) & 7; // LFO wave
  v[143] = (p[116] >> 4) & 7; // pitch modulation sensitivity
  v[144] = p[117]; // transpose
  for (let i = 0; i < 10; i++) v[145 + i] = p[118 + i]; // name
  return v.some((b) => b > 0x7f) ? null : v;
}
