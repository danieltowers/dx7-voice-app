// The hardware page: three buttons that send fixed voices to the targets.

import fixed from "./fixed-messages.js";
import { createControls } from "./controls.js";
import { ADDENDUM_FIRST, HEADER_SIZE, TRAILER_SIZE, addendumMessage, voiceMessage } from "./send.js";
import { showSetupNotes } from "./setup-notes.js";
import { keepShell } from "./shell.js";

const $ = (id) => document.getElementById(id);

const controls = createControls();

// The fixed messages are complete at address 1; the page sends their data
// through its own assembly, and checks that assembly against them first.
const voices = {
  core: { voice: messageData(fixed.core.voice), addendum: null },
  addendum: { voice: messageData(fixed.addendum.voice), addendum: messageData(fixed.addendum.addendum) },
};
const assembled =
  same(voiceMessage(voices.core.voice, 1), fixed.core.voice) &&
  same(voiceMessage(voices.addendum.voice, 1), fixed.addendum.voice) &&
  same(addendumMessage(voices.addendum.addendum, 1), fixed.addendum.addendum);

function fromHex(hex) {
  return Uint8Array.from(hex.trim().split(/\s+/), (h) => parseInt(h, 16));
}

// A complete message's data bytes: without its header, checksum and end byte.
function messageData(hex) {
  return fromHex(hex).slice(HEADER_SIZE, -TRAILER_SIZE);
}

function same(bytes, hex) {
  const want = fromHex(hex);
  return bytes.length === want.length && bytes.every((b, i) => b === want[i]);
}

function hexOf(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

// Sending.

function send(voice, label, options) {
  if (!assembled) {
    controls.showResult("Not sent: this page's message assembly does not match the core's messages.", true);
    return;
  }
  controls.send(voice, label, options);
}

$("send-core").addEventListener("click", () => send(voices.core, "BRASS 1"));
$("send-addendum-first").addEventListener("click", () =>
  send(voices.addendum, "BRASS 1 +A, addendum first", { addendumFirst: true }));
$("send-voice-first").addEventListener("click", () =>
  send(voices.addendum, "BRASS 1 +A, voice first", { addendumFirst: false }));

// The rest of the page.

function renderPanel() {
  const body = $("panel").querySelector("tbody");
  body.replaceChildren(...fixed.addendum.panel.map((row) => {
    const tr = document.createElement("tr");
    for (const cell of [row.parameter, row.value, row.yamaha, row.byte]) {
      const td = document.createElement("td");
      td.textContent = String(cell);
      tr.append(td);
    }
    return tr;
  }));
}

renderPanel();
showSetupNotes($("setup-notes"));
$("order-now").textContent = ADDENDUM_FIRST ? "first" : "after the voice";
$("provenance").textContent =
  `The fixed messages are made by the dx7 core: ${fixed.command}. ` +
  (assembled
    ? "This page's own assembly of them matches."
    : "This page's own assembly of them does not match: sending is off.");
if (!assembled) {
  controls.showResult("Sending is off: this page's message assembly does not match the core's messages.", true);
  console.error("assembly mismatch", hexOf(voiceMessage(voices.core.voice, 1)), fixed.core.voice);
}
keepShell();
