// The controls every sending page shares: the status line, the MIDI port and
// its chooser, the target toggles and addresses, the pause, a send that
// reports on the status line, and a parameter change that reports only when
// it fails. A page provides elements with these ids:
//
//   port-line, result-line      the two lines of the status line
//   output-row, output          the chooser row (shown with two or more outputs)
//   retry-row, retry            "ask for MIDI again", shown when MIDI was refused
//   targets, pause              the target rows' box and the pause input
//
// The settings themselves live in settings.js, the messages in send.js.

import { TARGETS, loadSettings, normalise, saveSettings } from "./settings.js";
import { CHANGE_PAUSE_MS, ChangeRefused, planChange } from "./parameter-change.js";
import {
  SendError, chooseOutput, describePlan, noOutputMessage, openMidi, outputsOf, sendChange, sendVoice,
} from "./send.js";

const $ = (id) => document.getElementById(id);

export function createControls() {
  let settings = loadSettings();
  let access = null;
  let output = null;
  let warnedStorage = false;

  function showPort(text, isError = false) {
    $("port-line").textContent = text;
    $("port-line").classList.toggle("error", isError);
  }

  function showResult(text, isError = false) {
    $("result-line").textContent = text;
    $("result-line").classList.toggle("error", isError);
  }

  // Saving keeps only valid values; when storage is blocked, what is on
  // screen lasts until the page closes.
  function remember() {
    settings = normalise(settings);
    if (!saveSettings(settings) && !warnedStorage) {
      warnedStorage = true;
      showResult("Settings cannot be remembered in this browser (storage is blocked); they last until the page closes.", true);
    }
  }

  function renderTargets() {
    const box = $("targets");
    box.replaceChildren();
    for (const t of TARGETS) {
      const row = document.createElement("div");
      row.className = "row target";
      const on = document.createElement("input");
      on.type = "checkbox";
      on.id = `on-${t.id}`;
      on.checked = settings.targets[t.id].on;
      const name = document.createElement("label");
      name.htmlFor = on.id;
      name.textContent = t.label;
      const addressLabel = document.createElement("label");
      addressLabel.htmlFor = `address-${t.id}`;
      addressLabel.textContent = t.addressLabel;
      addressLabel.className = "address-label";
      const address = document.createElement("input");
      address.type = "number";
      address.inputMode = "numeric";
      address.id = `address-${t.id}`;
      address.min = 1;
      address.max = 16;
      address.value = settings.targets[t.id].address;
      on.addEventListener("change", () => {
        settings.targets[t.id].on = on.checked;
        remember();
      });
      address.addEventListener("change", () => {
        settings.targets[t.id].address = Number(address.value);
        remember();
        address.value = settings.targets[t.id].address;
      });
      row.append(on, name, addressLabel, address);
      box.append(row);
    }
    $("pause").value = settings.pauseMs;
  }

  $("pause").addEventListener("change", () => {
    settings.pauseMs = Number($("pause").value);
    remember();
    $("pause").value = settings.pauseMs;
  });

  // Another page (the hardware page in another tab) changed the settings.
  window.addEventListener("storage", () => {
    settings = loadSettings();
    renderTargets();
  });

  // MIDI is asked for on first use: the first send (or "ask for MIDI
  // again"), not when the page opens. Until then the status line says so.
  showPort("Port: MIDI is asked for on the first send; allow it if Chrome asks.");
  let opening = null;

  function openOnce() {
    opening ??= connect().finally(() => { opening = null; });
    return opening;
  }

  async function connect() {
    $("retry-row").hidden = true;
    showPort("Port: asking for MIDI. Allow it if Chrome asks.");
    try {
      access = await openMidi();
    } catch (e) {
      access = null;
      output = null;
      showPort(e instanceof SendError ? e.message : String(e), true);
      $("retry-row").hidden = false;
      return;
    }
    access.onstatechange = refreshPorts;
    refreshPorts();
  }

  // The only output is used without being saved as the choice, so a
  // remembered choice survives a day with one cable and is matched again by
  // name when the ports change.
  function refreshPorts() {
    const outputs = outputsOf(access);
    output = chooseOutput(outputs, settings.port);
    const select = $("output");
    $("output-row").hidden = outputs.length < 2;
    select.replaceChildren();
    if (outputs.length >= 2) {
      const prompt = new Option("Choose an output", "");
      prompt.disabled = true;
      select.append(prompt, ...outputs.map((o) => new Option(o.name, o.id)));
      select.value = output ? output.id : "";
    }
    if (output) {
      showPort(`Port: ${output.name}`);
    } else {
      showPort(noOutputMessage(outputs), outputs.length === 0);
    }
  }

  $("output").addEventListener("change", () => {
    output = outputsOf(access).find((o) => o.id === $("output").value) ?? null;
    if (output) {
      settings.port = output.name;
      remember();
      showPort(`Port: ${output.name}`);
    }
  });

  $("retry").addEventListener("click", openOnce);

  // Send one voice ({ voice, addendum } data bytes) to the targets that are
  // on, and say on the status line what went: the time, the label, the
  // message count and where each message went. Asks for MIDI first when it
  // has not been asked for yet. Resolves true when sent.
  async function send(voice, label, options) {
    if (!access) await openOnce();
    if (!output) {
      showResult(`${label} not sent. ${access ? noOutputMessage(outputsOf(access)) : "MIDI is not open."}`, true);
      return false;
    }
    let plan;
    try {
      plan = await sendVoice(output, voice, settings, options);
    } catch (e) {
      showResult(`${label} not sent. ${e instanceof SendError ? e.message : String(e)}`, true);
      return false;
    }
    if (!plan) return false; // replaced by a newer send, which reports itself
    const time = new Date().toLocaleTimeString("en-GB");
    const count = plan.length === 1 ? "1 message" : `${plan.length} messages`;
    showResult(`${time}: ${label}, ${count}: ${describePlan(plan)}.`);
    return true;
  }

  // Set one control of the voice in the targets' edit buffers to value, as a
  // parameter change to the targets that are on (parameter-change.js). The
  // status line stays quiet when it goes out, so a drag does not fill it;
  // when it cannot go, the status line says why, naming label (what the
  // value was to show, "Operator 1 coarse 2.00"). Asks for MIDI first when it
  // has not been asked for yet. Resolves true when sent, false when not sent
  // or replaced by a newer change to the same parameter.
  async function change(control, value, label) {
    if (!access) await openOnce();
    if (!output) {
      showResult(`${label} not sent. ${access ? noOutputMessage(outputsOf(access)) : "MIDI is not open."}`, true);
      return false;
    }
    try {
      const plan = planChange(control, value, settings);
      return (await sendChange(output, control.parameter, plan, CHANGE_PAUSE_MS)) !== null;
    } catch (e) {
      const why = e instanceof SendError || e instanceof ChangeRefused ? e.message : String(e);
      showResult(`${label} not sent. ${why}`, true);
      return false;
    }
  }

  renderTargets();

  return { send, change, showResult };
}
