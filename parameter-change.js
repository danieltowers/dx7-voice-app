// Parameter changes: one parameter of the voice in an instrument's edit
// buffer set over MIDI, the rest left as it was. Pure and free of the page,
// shared by the hardware page's trial and the library page's Edit drawer.

import { CARRIERS } from "./algorithms.js";
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

// The voice parameters the Edit controls set, by Yamaha's parameter number,
// which is also the parameter's offset in the 155 single-voice data bytes
// (src/dx7/edit_buffer.py, OPERATOR_POSITIONS and VOICE_POSITIONS): operator
// 6 first, 21 bytes an operator, so operator n starts at 21 * (6 - n); within
// it output level is 16, coarse 18 and fine 19. After the operators,
// algorithm is 134 (stored 0 to 31) and feedback 135. Each is { name, min,
// max }, min and max bounding any value sent; the controls take their names
// and spans from here. Controls that set further parameters add them here.
const OPERATOR_SIZE = 21;
const operatorStart = (n) => OPERATOR_SIZE * (6 - n);
const OPERATOR_FIELDS = { level: 16, mode: 17, coarse: 18, fine: 19 };

const ALGORITHM_PARAMETER = 134;
const FEEDBACK_PARAMETER = 135;

const PARAMETERS = new Map();
for (let n = 1; n <= 6; n++) {
  PARAMETERS.set(operatorStart(n) + OPERATOR_FIELDS.level, { name: `Operator ${n} output level`, min: 0, max: 99 });
  PARAMETERS.set(operatorStart(n) + OPERATOR_FIELDS.coarse, { name: `Operator ${n} coarse`, min: 0, max: 31 });
  PARAMETERS.set(operatorStart(n) + OPERATOR_FIELDS.fine, { name: `Operator ${n} fine`, min: 0, max: 99 });
}
PARAMETERS.set(ALGORITHM_PARAMETER, { name: "Algorithm", min: 0, max: 31 });
PARAMETERS.set(FEEDBACK_PARAMETER, { name: "Feedback", min: 0, max: 7 });

// The messages that set one parameter to a value ({ parameter, value }) on
// the targets that are on: one per distinct address, as for a voice, so with
// every address at 1 one message reaches every target. The fourth target
// gets it too. Each step is { kind: "change", parameter, value, address,
// targets, bytes }, targets being the labels it is meant for. No target on
// gives no step.
export function planChange({ parameter, value }, settings) {
  const known = PARAMETERS.get(parameter);
  if (!known) throw new ChangeRefused(`parameter ${parameter} is not one the Edit controls set.`);
  if (!isWholeIn(value, known.min, known.max)) {
    throw new ChangeRefused(`${known.name} ${value} is not from ${known.min} to ${known.max}.`);
  }
  return byAddress(targetsOn(settings), settings).map(([address, targets]) => ({
    kind: "change", parameter, value, address, targets,
    bytes: parameterChangeMessage(parameter, value, address),
  }));
}

// The controls. A control is a view of a voice (its 155 single-voice data
// bytes, as edited):
//
//   { id, name, span(voice), position(voice), label(voice), writes(position, voice) }
//
// span is the slider's { min, max } for this voice; position is where the
// voice sits on it; label shows the voice as the DX7's panel does; writes is
// what moving to a position sets, a list of { parameter, value } (one or
// more, in the order they are to be sent). A control reads only the voice,
// so it shows parameters another control wrote.
const FIXED = 1; // oscillator mode: 0 is frequency ratio, 1 fixed frequency

// Operator n's parameters (1 to 6), and whether it is in fixed-frequency mode.
function operator(n) {
  if (!isWholeIn(n, 1, 6)) throw new ChangeRefused(`there is no operator ${n}`);
  const start = operatorStart(n);
  return {
    coarse: start + OPERATOR_FIELDS.coarse,
    fine: start + OPERATOR_FIELDS.fine,
    fixed: (voice) => voice[start + OPERATOR_FIELDS.mode] === FIXED,
    level: start + OPERATOR_FIELDS.level,
  };
}

// A slider over one parameter, its positions the parameter's values plus
// offset (the panel's numbering: 1 for the algorithm, stored from 0): its
// span, where the voice sits, and what a position writes.
function byteSlider(parameter, offset = 0) {
  const { min, max } = PARAMETERS.get(parameter);
  return {
    span: () => ({ min: min + offset, max: max + offset }),
    position: (voice) => voice[parameter] + offset,
    writes: (position) => [{ parameter, value: position - offset }],
  };
}

// A control over one parameter, named as PARAMETERS names it and labelled
// with its position.
function byteControl(id, parameter, offset = 0) {
  return Object.freeze({
    id,
    name: PARAMETERS.get(parameter).name,
    label: (voice) => String(voice[parameter] + offset),
    ...byteSlider(parameter, offset),
  });
}

// Operator n's output level (1 to 6), 0 to 99, labelled with the number.
export function levelControl(n) {
  return byteControl(`operator-${n}-level`, operator(n).level);
}

// Operator n's frequency (1 to 6) on a setting, a control. The setting is the
// drawer's (FREQUENCY_SETTINGS); whichever it is, the label is the
// operator's true ratio, or its frequency in Hz in fixed-frequency mode.
//
//   coarse  moves coarse and keeps fine: 0 to 31, or in fixed-frequency mode,
//           where only coarse's low two bits count (1, 10, 100 or 1000 Hz),
//           four positions
//   fine    moves fine across 0 to 99 and keeps coarse, in either mode
//   continuous  moves both along one rising run of ratios (RATIO_RUN), or of
//           frequencies in fixed-frequency mode (FIXED_RUN); a voice off the
//           run sits at the position nearest it until the slider moves
export function frequencyControl(n, setting) {
  const op = operator(n);
  const slider = SLIDER_BY_SETTING[setting];
  if (!slider) throw new ChangeRefused(`operator ${n} has no frequency setting ${setting}`);
  return Object.freeze({
    id: `operator-${n}-frequency`,
    name: `Operator ${n} frequency`,
    label: (voice) => frequencyLabel(op.fixed(voice), voice[op.coarse], voice[op.fine]),
    ...slider(op),
  });
}

// Each setting's slider over an operator: its span, where the voice sits,
// and what a position writes.
const SLIDER_BY_SETTING = {
  coarse: (op) => {
    const ratio = byteSlider(op.coarse);
    return {
      ...ratio,
      span: (voice) => (op.fixed(voice) ? { min: 0, max: 3 } : ratio.span()),
      position: (voice) => (op.fixed(voice) ? voice[op.coarse] & 3 : ratio.position(voice)),
    };
  },
  fine: (op) => byteSlider(op.fine),
  continuous: (op) => {
    const run = (voice) => (op.fixed(voice) ? FIXED_RUN : RATIO_RUN);
    const pitchOf = (voice, coarse = voice[op.coarse], fine = voice[op.fine]) => pitch(op.fixed(voice), coarse, fine);
    return {
      span: (voice) => ({ min: 0, max: run(voice).length - 1 }),
      // The position nearest the operator's ratio (or frequency) as edited;
      // of two as near, the lower.
      position: (voice) => {
        const target = pitchOf(voice);
        const distance = ([coarse, fine]) => Math.abs(pitchOf(voice, coarse, fine) - target);
        const pairs = run(voice);
        let nearest = 0;
        for (let p = 1; p < pairs.length; p++) if (distance(pairs[p]) < distance(pairs[nearest])) nearest = p;
        return nearest;
      },
      // The position's coarse and fine, those that differ from the voice;
      // both in the order firstOfPair chooses.
      writes: (position, voice) => {
        const [coarse, fine] = run(voice)[position];
        const writes = [];
        if (coarse !== voice[op.coarse]) writes.push({ parameter: op.coarse, value: coarse });
        if (fine !== voice[op.fine]) writes.push({ parameter: op.fine, value: fine });
        if (writes.length < 2) return writes;
        const fineFirst = pitchOf(voice, voice[op.coarse], fine);
        const coarseFirst = pitchOf(voice, coarse, voice[op.fine]);
        return firstOfPair(fineFirst, coarseFirst) === "fine" ? writes.reverse() : writes;
      },
    };
  },
};

// Which of a continuous move's coarse and fine goes first ("fine" or
// "coarse") when it changes both, chosen by the operator's frequency between
// the two messages (pitch below): fineFirst is the new fine with the old
// coarse, coarseFirst the new coarse with the old fine. The lower is chosen,
// so a held note dips for that moment rather than jumps up: going up across a
// coarse step that is fine first, going down coarse first (of two as low,
// coarse first). To flip the rule, flip the comparison here; nothing else
// decides it.
function firstOfPair(fineFirst, coarseFirst) {
  return fineFirst < coarseFirst ? "fine" : "coarse";
}

// The continuous run in ratio mode: the (coarse, fine) pairs in rising order
// of ratio, fine running from 0 at each coarse value while the ratio is below
// the next coarse value's whole ratio, c * (1 + fine / 100) < c + 1, so below
// 100 / c (coarse 0, 0.50, and coarse 1 below 100). Coarse 31, the last, runs
// to 99.
const RATIO_RUN = [];
for (let coarse = 0; coarse <= 31; coarse++) {
  for (let fine = 0; fine <= 99 && (coarse === 31 || coarse * fine < 100); fine++) RATIO_RUN.push([coarse, fine]);
}

// A measure that rises with an operator's frequency, exact in whole numbers:
// in ratio mode the ratio in ten-thousandths, coarse (0 is 0.50) times 1 +
// fine / 100; in fixed-frequency mode the exponent of 10 in hundredths,
// coarse's low two bits and fine.
function pitch(fixed, coarse, fine) {
  if (fixed) return (coarse & 3) * 100 + fine;
  return (coarse === 0 ? 50 : coarse * 100) * (100 + fine);
}

// In fixed-frequency mode: coarse 0 to 3 (1, 10, 100 and 1000 Hz), each with
// fine 0 to 99, 1.000 Hz to 9772 Hz.
const FIXED_RUN = [];
for (let coarse = 0; coarse <= 3; coarse++) {
  for (let fine = 0; fine <= 99; fine++) FIXED_RUN.push([coarse, fine]);
}

// The frequency settings frequencyControl takes, in the order the drawer
// offers them.
export const FREQUENCY_SETTINGS = Object.freeze(Object.keys(SLIDER_BY_SETTING));

// The hardware page's trial: operator 1's frequency on coarse.
export const OPERATOR_1_COARSE = Object.freeze({
  ...frequencyControl(1, "coarse"),
  id: "operator-1-coarse",
  name: "Operator 1 coarse",
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

// The algorithm, 1 to 32 as the panel shows it, stored and sent 0 to 31.
export const ALGORITHM = byteControl("algorithm", ALGORITHM_PARAMETER, 1);

// The feedback, 0 to 7.
export const FEEDBACK = byteControl("feedback", FEEDBACK_PARAMETER);

// Whether operator n (1 to 6) is a "carrier" or a "modulator" in the voice's
// algorithm, as edited.
export function operatorRole(n, voice) {
  return CARRIERS[voice[ALGORITHM_PARAMETER]].includes(n) ? "carrier" : "modulator";
}

// The drawer's controls: the voice's own, algorithm and feedback, then a
// block for each operator in OPERATORS, 1 to 6 as on the DX7's panel,
// headed with its role (operatorRole) and holding its frequencyControl on the
// setting the drawer has chosen for it and its levelControl.
export const CONTROLS = Object.freeze([ALGORITHM, FEEDBACK]);
export const OPERATORS = Object.freeze([1, 2, 3, 4, 5, 6]);

// Where a control's slider starts for a voice: where its stored values sit.
export function startingPosition(control, data) {
  return control.position(voiceData(data));
}

// The voice with writes ({ parameter, value } each) laid over it: a copy.
export function withWrites(voice, writes) {
  const out = voiceData(voice).slice();
  for (const { parameter, value } of writes) out[parameter] = value;
  return out;
}

// The label a control shows at a position: the voice's, once the position's
// writes are laid over it.
export function labelAt(control, position, voice) {
  return control.label(withWrites(voice, control.writes(position, voice)));
}

function voiceData(data) {
  if (!(data instanceof Uint8Array) || data.length !== VOICE_DATA_SIZE) {
    throw new ChangeRefused(`expected ${VOICE_DATA_SIZE} voice data bytes, got ${data?.length ?? "none"}`);
  }
  return data;
}
