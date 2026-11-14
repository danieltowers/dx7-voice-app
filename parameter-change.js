// Parameter changes: one parameter of the voice in an instrument's edit
// buffer set over MIDI, the rest left as it was. Pure and free of the page,
// shared by the hardware page's trial and the library page's Edit drawer.

import { byAddress, targetsOn } from "./settings.js";

// Yamaha's voice parameters, 0 to 155: the 155 single-voice data bytes at
// their own numbers, and 155, operator on/off, which only a change carries.
const LAST_VOICE_PARAMETER = 155;
const VOICE_GROUP = 0;
const VOICE_DATA_SIZE = 155;

// The pause between two parameter change messages, and after the last one
// of a change: none, until the hardware trial (ticket 02) shows that an
// instrument needs one. Change it only here.
export const CHANGE_PAUSE_MS = 0;

// A message or a change that cannot be made, in plain words.
export class ChangeRefused extends Error {}

// Whether value is a whole number from min to max.
export function isWholeIn(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

// Yamaha's parameter change, seven bytes: F0 43 1n gg pp vv F7. n is the
// address minus one, as in a single-voice message; gg is 0gggggpp, the
// group (0, the voice parameters) and the parameter number's top two bits;
// pp its low seven bits; vv the value.
export function parameterChangeMessage(parameter, value, address) {
  if (!isWholeIn(parameter, 0, LAST_VOICE_PARAMETER)) {
    throw new ChangeRefused(`parameter ${parameter} is not a voice parameter (0 to ${LAST_VOICE_PARAMETER})`);
  }
  if (!isWholeIn(value, 0, 127)) {
    throw new ChangeRefused(`value ${value} is not from 0 to 127`);
  }
  if (!isWholeIn(address, 1, 16)) {
    throw new ChangeRefused(`address ${address} is not from 1 to 16`);
  }
  return Uint8Array.from([
    0xf0, 0x43, 0x10 | (address - 1), (VOICE_GROUP << 2) | (parameter >> 7), parameter & 0x7f, value, 0xf7,
  ]);
}

// The messages that set a control to value on the targets that are on: one
// per distinct address, as for a voice, so with every address at 1 one
// message reaches every target. The fourth target gets it too. Each step is
// { kind: "change", parameter, value, address, targets, bytes }, targets
// being the labels it is meant for. No target on gives no step.
export function planChange(control, value, settings) {
  if (!isWholeIn(value, control.min, control.max)) {
    throw new ChangeRefused(`${control.name} ${value} is not from ${control.min} to ${control.max}.`);
  }
  return byAddress(targetsOn(settings), settings).map(([address, targets]) => ({
    kind: "change", parameter: control.parameter, value, address, targets,
    bytes: parameterChangeMessage(control.parameter, value, address),
  }));
}

// The controls, by Yamaha's voice parameter number, which is also the
// control's offset in the 155 single-voice data bytes (operator 6 first, 21
// bytes an operator: operator 1 at 105 to 125, src/dx7/edit_buffer.py).
// Each control is { id, name, parameter, min, max, range(data), read(data),
// label(value, data) }: min and max bound any value sent; range is the
// slider's span for this voice; read is the slider's starting position; label
// shows a value as the DX7's panel does. data are 155 voice data bytes.
const OPERATOR_1 = { mode: 122, coarse: 123, fine: 124 };
const FIXED = 1; // oscillator mode: 0 is frequency ratio, 1 fixed frequency

const fixedMode = (data) => data[OPERATOR_1.mode] === FIXED;

export const OPERATOR_1_COARSE = Object.freeze({
  id: "operator-1-coarse",
  name: "Operator 1 coarse",
  parameter: OPERATOR_1.coarse,
  min: 0,
  max: 31,
  // In fixed-frequency mode only coarse's low two bits count (1, 10, 100 or
  // 1000 Hz), so the slider has four positions.
  range: (data) => ({ min: 0, max: fixedMode(data) ? 3 : 31 }),
  read: (data) => (fixedMode(data) ? data[OPERATOR_1.coarse] & 3 : data[OPERATOR_1.coarse]),
  label: (coarse, data) => frequencyLabel(fixedMode(data), coarse, data[OPERATOR_1.fine]),
});

// An operator's frequency as the panel shows it. Ratio mode: coarse (0 is
// 0.50) times 1 + fine / 100, to two places (the DX7 owner's manual, printed
// pp. 32 and 33). Fixed-frequency mode: 10 ** (coarse's low two bits + fine /
// 100) Hz, to four figures, which reproduces the TX816 owner's manual's chart
// (printed p. 58: 1.000, 1.023, ... 3.162, ... 9.772 Hz for fine 0 to 99 at
// coarse 0; 1, 10, 100, 1000 Hz for coarse 0 to 3, and 4 is 1 again).
function frequencyLabel(fixed, coarse, fine) {
  if (fixed) return `${(10 ** ((coarse & 3) + fine / 100)).toPrecision(4)} Hz`;
  // In hundredths, so the whole ratios are exact; coarse 0 with an odd fine
  // falls on a half hundredth, rounded up.
  const hundredths = Math.round(((coarse === 0 ? 50 : coarse * 100) * (100 + fine)) / 100);
  return (hundredths / 100).toFixed(2);
}

export const CONTROLS = Object.freeze([OPERATOR_1_COARSE]);

// Where a control's slider starts for a voice: its stored value.
export function startingValue(control, data) {
  return control.read(voiceData(data));
}

function voiceData(data) {
  if (!(data instanceof Uint8Array) || data.length !== VOICE_DATA_SIZE) {
    throw new ChangeRefused(`expected ${VOICE_DATA_SIZE} voice data bytes, got ${data?.length ?? "none"}`);
  }
  return data;
}
