// Sending one voice to the instruments over Web MIDI: the messages, their
// order, the pause between them, and the MIDI port. Shared by the hardware
// page and the library page.
//
// A voice is { voice, addendum }: the 155 single-voice data bytes (Yamaha
// format 0) and, when the voice has one, the 49 single-addendum data bytes
// (format 5), each as a Uint8Array without header or checksum. The data come
// from the dx7 core; this module adds only the header, the address nibble,
// the checksum and the end byte (research/sysex-reception.md).

import { TARGETS } from "./settings.js";

// The order on the DX7s and the DX7IID when a voice has an addendum: true
// sends the addendum message(s) first, then the voice message(s). The manuals
// do not say (research/sysex-reception.md, finding 5); addendum first is what
// the repo has said, after the TX81Z's rule. The hardware milestone (the
// hardware page's two addendum buttons) settles it; change it only here.
export const ADDENDUM_FIRST = true;

const VOICE_HEADER = [0xf0, 0x43, 0x00, 0x00, 0x01, 0x1b];
const ADDENDUM_HEADER = [0xf0, 0x43, 0x00, 0x05, 0x00, 0x31];
// Both messages: this many header bytes before the data, then the checksum
// and the end byte after it.
export const HEADER_SIZE = VOICE_HEADER.length;
export const TRAILER_SIZE = 2;
export const VOICE_DATA_SIZE = 155;
export const ADDENDUM_DATA_SIZE = 49;

// MIDI runs at 31,250 baud, ten bits a byte: a 163-byte voice message takes
// 52 ms on the cable. Chrome hands a message on at once, so the pause between
// two messages is counted from the end of the first one's time on the cable.
const MS_PER_BYTE = 10 / 31.25;

export class SendError extends Error {}

// Two's complement of the sum of the data, low seven bits, as for banks.
export function checksum(data) {
  let sum = 0;
  for (const byte of data) sum += byte;
  return (128 - (sum & 0x7f)) & 0x7f;
}

// The complete single-voice message (163 bytes) for 155 data bytes, at an
// address from 1 to 16 (a DX7s or DX7IID device number, a TX816 channel).
export function voiceMessage(data, address) {
  return message(VOICE_HEADER, data, VOICE_DATA_SIZE, address);
}

// The complete single-addendum message (57 bytes) for 49 data bytes.
export function addendumMessage(data, address) {
  return message(ADDENDUM_HEADER, data, ADDENDUM_DATA_SIZE, address);
}

function message(header, data, size, address) {
  if (!(data instanceof Uint8Array) || data.length !== size) {
    throw new SendError(`expected ${size} data bytes, got ${data?.length ?? "none"}`);
  }
  if (!Number.isInteger(address) || address < 1 || address > 16) {
    throw new SendError(`address ${address} is not from 1 to 16`);
  }
  const out = new Uint8Array(header.length + size + TRAILER_SIZE);
  out.set(header);
  out[2] = address - 1;
  out.set(data, header.length);
  out[out.length - 2] = checksum(data);
  out[out.length - 1] = 0xf7;
  return out;
}

// The messages that send a voice to the targets that are on, in order. One
// message per distinct header byte: with every address at 1, one voice
// message reaches all three instruments. The addendum goes to each distinct
// DX7s/DX7IID address (never on behalf of the TX816), before or after the
// voice messages as order says. Each step is { kind, address, targets, bytes },
// targets being the labels it is meant for.
export function planSend(voice, settings, { addendumFirst = ADDENDUM_FIRST } = {}) {
  const on = TARGETS.filter((t) => settings.targets[t.id]?.on);
  const voices = byAddress(on, settings).map(([address, targets]) => ({
    kind: "voice", address, targets, bytes: voiceMessage(voice.voice, address),
  }));
  const addenda = voice.addendum
    ? byAddress(on.filter((t) => t.addendum), settings).map(([address, targets]) => ({
        kind: "addendum", address, targets, bytes: addendumMessage(voice.addendum, address),
      }))
    : [];
  return addendumFirst ? [...addenda, ...voices] : [...voices, ...addenda];
}

function byAddress(targets, settings) {
  const groups = new Map();
  for (const t of targets) {
    const address = settings.targets[t.id].address;
    if (!groups.has(address)) groups.set(address, []);
    groups.get(address).push(t.label);
  }
  return [...groups];
}

// "addendum to DX7s and DX7IID at 1, then voice to DX7s, DX7IID and TX816 at 1"
export function describePlan(plan) {
  return plan.map((m) => `${m.kind} to ${listed(m.targets)} at ${m.address}`).join(", then ");
}

function listed(labels) {
  return labels.length < 2 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

// Send the plan's messages on output, pauseMs apart (after each message's own
// time on the cable). Sends queue behind each other, so two quick taps never
// interleave. Resolves when the last message has been handed on; rejects
// with a SendError in plain words.
let queue = Promise.resolve();

export function sendPlan(output, plan, pauseMs) {
  const run = queue.then(() => sendNow(output, plan, pauseMs));
  queue = run.catch(() => {});
  return run;
}

// planSend then sendPlan with the settings' pause: what a tap on a voice does.
// Resolves to the plan sent.
export async function sendVoice(output, voice, settings, options) {
  return sendPlan(output, planSend(voice, settings, options), settings.pauseMs);
}

async function sendNow(output, plan, pauseMs) {
  if (!output) throw new SendError("No MIDI output is chosen.");
  if (plan.length === 0) throw new SendError("No target is on: turn on the DX7s, the DX7IID or the TX816.");
  for (const [i, step] of plan.entries()) {
    if (output.state === "disconnected") throw new SendError(gone(output));
    try {
      output.send(step.bytes);
    } catch (e) {
      throw new SendError(
        e?.name === "InvalidAccessError"
          ? "Chrome refused System Exclusive on this port. Allow MIDI for this site and reload."
          : e?.name === "InvalidStateError" ? gone(output) : `The send failed: ${e?.message ?? e}`,
      );
    }
    if (i < plan.length - 1) await sleep(Math.ceil(step.bytes.length * MS_PER_BYTE) + pauseMs);
  }
  return plan;
}

function gone(output) {
  return `The MIDI output "${output.name}" is gone. Check the cable and the OTG adapter.`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Web MIDI with System Exclusive. Chrome asks once per site and remembers.
export async function openMidi() {
  if (!window.isSecureContext) {
    throw new SendError("This page is not on https, so Chrome offers no MIDI. Open it from its https address.");
  }
  if (!navigator.requestMIDIAccess) {
    throw new SendError("This browser has no Web MIDI. Use Chrome on the phone.");
  }
  try {
    return await navigator.requestMIDIAccess({ sysex: true });
  } catch (e) {
    if (e?.name === "SecurityError" || e?.name === "NotAllowedError") {
      throw new SendError("MIDI with System Exclusive was not allowed. Allow MIDI for this site in Chrome's site settings, then reload.");
    }
    throw new SendError(`MIDI could not be opened: ${e?.message ?? e}`);
  }
}

// The outputs present now, in a stable order.
export function outputsOf(access) {
  return [...access.outputs.values()]
    .filter((o) => o.state !== "disconnected")
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The output to use: the only one when there is one, otherwise the one
// whose name was remembered, otherwise null (the page offers a chooser).
export function chooseOutput(outputs, rememberedName) {
  if (outputs.length === 1) return outputs[0];
  return outputs.find((o) => o.name === rememberedName) ?? null;
}

// What the status line says about the ports when no output is in use.
export function noOutputMessage(outputs) {
  return outputs.length === 0
    ? "No MIDI output. Plug in the USB-MIDI cable through the OTG adapter."
    : "Choose a MIDI output.";
}
