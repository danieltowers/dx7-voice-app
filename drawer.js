// The library page's Edit drawer: a row for each of the voice's controls
// (parameter-change.js, CONTROLS: algorithm and feedback), then a block for
// each operator, 1 to 6 (OPERATORS), headed with its number and whether it is
// a carrier or a modulator in the algorithm as edited, holding its frequency
// slider with a radio group choosing the slider's setting, and its output
// level slider; each slider is over the voice last sent as edited. Its
// name line, Close and Reset stay in view while the controls scroll. A
// move to a new position goes to the targets that are on as the parameter
// changes it writes; the status line speaks only when one fails, and the
// parameters it wrote then go back to what the instruments last received.
// Reset, on once something has been edited, sends the voice again. Its edit
// state is edit.js's; the settings are its own. It lives in the dock
// with the step bar, and the room the list leaves below follows the dock's
// height. The page provides elements with these ids:
//
//   dock                          the bar along the bottom, the drawer in it
//   edit                          the step bar's button that opens and closes it
//   drawer, drawer-title          the drawer and the voice's name and slot
//   drawer-note, drawer-controls  why its controls are off, and their box
//   close-drawer, reset           its two buttons, in its head with the title
//   status                        the status line, which a wide screen's pane starts below
//
// In the browser's history the drawer is an entry of its own over the view
// on screen, the same view with drawer set, so the back gesture closes it
// (DrawerHistory). A replace of the view keeps it open (shuffle, a filter);
// going to another view leaves it behind, and coming back to its entry opens
// it again.

import {
  CONTROLS, FREQUENCY_SETTINGS, OPERATORS, frequencyControl, levelControl, operatorRole,
} from "./parameter-change.js";
import { UNSENDABLE } from "./library.js";

const $ = (id) => document.getElementById(id);

function visuallyHidden(text) {
  const span = document.createElement("span");
  span.className = "visually-hidden";
  span.textContent = text;
  return span;
}

// The drawer's history entries, over a history (the browser's) whose entries
// are { view, depth, ... }, depth counting from the first. Closing it, by
// Close or by the back gesture, leaves the history as if it had been opened
// over the view now under it, even when a replace changed that view while it
// was open: the entry beneath it then takes that view. The page tells it
// when it shows the current entry (shown) and when the history moved (popped).
export class DrawerHistory {
  constructor(history) {
    this.history = history;
    this.over = null; // the drawer's entry as last shown, while open
  }

  get isOpen() {
    return !!this.history.state?.drawer;
  }

  // Open over the view on screen.
  open() {
    const state = this.history.state;
    this.history.pushState({ ...state, depth: (state?.depth ?? 0) + 1, drawer: true }, "");
  }

  // Back to the entry beneath (popped then gives it the view on screen); an
  // entry with none beneath, as a reload leaves, is closed where it is.
  close() {
    const state = this.history.state;
    if (!state?.drawer) return;
    if (state.depth > 0) {
      this.history.back();
    } else {
      const { drawer: _, ...rest } = state;
      this.history.replaceState(rest, "");
    }
  }

  // The page shows the current entry.
  shown() {
    const state = this.history.state;
    this.over = state?.drawer ? state : null;
  }

  // The history moved (popstate). When it left the drawer's entry for the one
  // beneath, that entry takes the view that was under the drawer, so the
  // page stays on it.
  popped() {
    const state = this.history.state;
    if (this.over && state?.depth === this.over.depth - 1) {
      this.history.replaceState({ ...state, view: this.over.view }, "");
    }
  }
}

// What the drawer says when its controls are off.
const DRAWER_NOTES = {
  none: "Nothing sent yet: send a voice to edit it.",
  unsendable: `This voice cannot be sent (${UNSENDABLE}), so it cannot be edited.`,
  sending: "Sending the voice. The controls come on once it has gone out.",
  failed: "The voice was not sent, so the controls are off: no instrument is known to hold it. The status line says why; send it again.",
  sent: "",
};

// The drawer for edit (edit.js), sending its changes through controls
// (controls.js); reset sends the voice last sent again. Returns { show,
// popped }: show draws the drawer and the Edit button as the history and
// the edit now stand, and popped is for the page's popstate listener, before
// it decides what to draw.
export function createDrawer({ edit, controls, reset }) {
  const place = new DrawerHistory(history);

  function open() {
    if (place.isOpen || !edit.canOpen) return;
    place.open();
    show();
    const first = rows.find((row) => !row.input.disabled);
    (first ? first.input : $("close-drawer")).focus();
  }

  function close() {
    if (!place.isOpen) return;
    place.close();
    show();
    $("edit").focus();
  }

  $("edit").addEventListener("click", () => (place.isOpen ? close() : open()));
  $("close-drawer").addEventListener("click", close);
  $("drawer").addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // Each operator's frequency setting: coarse when the app opens, kept while
  // it is open (across sends and closing the drawer), never stored.
  const settings = new Map(OPERATORS.map((n) => [n, "coarse"]));

  // A slider row over the control controlNow() gives (it may change, as an
  // operator's setting does), named by name: its text, and any part only a
  // screen reader needs.
  function sliderRow(controlNow, name, hidden = "") {
    const row = document.createElement("div");
    row.className = "row control";
    const input = document.createElement("input");
    input.type = "range";
    input.step = 1;
    input.id = `control-${controlNow().id}`;
    const label = document.createElement("label");
    label.htmlFor = input.id;
    if (hidden) label.append(visuallyHidden(hidden));
    label.append(name);
    const output = document.createElement("output");
    output.htmlFor = input.id;
    row.append(label, input, output);
    input.addEventListener("input", () => {
      const control = controlNow();
      const move = edit.set(control, Number(input.value));
      if (move) {
        controls.change(move.writes, `${control.name} ${edit.label(control)}`).then((sent) => {
          edit.settleMove(move, sent);
          show();
        });
      }
      show();
    });
    rows.push({ controlNow, input, output });
    return row;
  }

  // An operator's frequency settings, one radio group per operator. Choosing
  // one sends nothing: the slider moves to where the operator's values sit
  // on it.
  function settingGroup(n) {
    const group = document.createElement("fieldset");
    group.className = "frequency-setting";
    const legend = document.createElement("legend");
    legend.className = "visually-hidden";
    legend.textContent = `Operator ${n} frequency steps`;
    group.append(legend);
    for (const setting of FREQUENCY_SETTINGS) {
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `operator-${n}-setting`;
      radio.id = `operator-${n}-${setting}`;
      radio.value = setting;
      radio.checked = settings.get(n) === setting;
      radio.addEventListener("change", () => {
        settings.set(n, setting);
        show();
      });
      const label = document.createElement("label");
      label.htmlFor = radio.id;
      label.textContent = setting;
      group.append(radio, label);
    }
    return group;
  }

  // An operator's block: headed with its number and its role in the
  // algorithm as edited (drawn by show), holding its frequency slider and
  // settings, then its output level slider.
  function operatorBlock(n) {
    const block = document.createElement("section");
    block.className = "operator";
    block.setAttribute("aria-labelledby", `operator-${n}-name`);
    const head = document.createElement("h3");
    head.id = `operator-${n}-name`;
    head.textContent = `Operator ${n}`;
    heads.push({ n, head });
    const frequency = sliderRow(() => frequencyControl(n, settings.get(n)), "frequency", `Operator ${n} `);
    frequency.append(settingGroup(n));
    const level = levelControl(n);
    block.append(head, frequency, sliderRow(() => level, "output level", `Operator ${n} `));
    return block;
  }

  // The voice's own controls, algorithm and feedback, above the operators.
  function voiceControls() {
    const group = document.createElement("div");
    group.className = "voice-controls";
    group.append(...CONTROLS.map((control) => sliderRow(() => control, control.name)));
    return group;
  }

  function operatorBlocks() {
    const group = document.createElement("div");
    group.className = "operators";
    group.append(...OPERATORS.map(operatorBlock));
    return group;
  }

  const rows = [];
  const heads = [];
  $("drawer-controls").replaceChildren(voiceControls(), operatorBlocks());

  $("reset").addEventListener("click", () => {
    if (!edit.edited) return;
    $("close-drawer").focus(); // Reset turns itself off as the send starts
    reset();
  });

  function show() {
    place.shown();
    const open = place.isOpen;
    $("edit").disabled = !edit.canOpen;
    $("edit").setAttribute("aria-expanded", String(open));
    $("drawer").hidden = !open;
    if (!open) return;
    $("drawer-title").textContent = edit.name ?? "No voice";
    const note = DRAWER_NOTES[edit.status];
    $("drawer-note").textContent = note;
    $("drawer-note").hidden = !note;
    $("drawer-controls").hidden = !edit.canOpen;
    if (edit.canOpen) {
      for (const row of rows) showControl(row);
      const voice = edit.voice;
      for (const { n, head } of heads) head.textContent = `Operator ${n} · ${operatorRole(n, voice)}`;
    }
    $("reset").disabled = !edit.edited;
  }

  // Every control is drawn from the voice as edited, so one that reads a
  // parameter another control wrote is always current.
  function showControl({ controlNow, input, output }) {
    const control = controlNow();
    const { min, max } = edit.span(control);
    input.min = min;
    input.max = max;
    input.value = edit.position(control);
    input.disabled = !edit.ready;
    const label = edit.label(control);
    output.textContent = label;
    input.setAttribute("aria-valuetext", label);
  }

  // The room the list leaves below for the dock follows its height.
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--dock-height", `${$("dock").offsetHeight}px`);
  }).observe($("dock"));

  // On a wide screen the drawer is a pane from the status line's foot down
  // (style.css), and that foot moves as the page scrolls until the sticky
  // line reaches the top, and when the line or the page changes size.
  function followStatus() {
    const foot = Math.max(0, $("status").getBoundingClientRect().bottom);
    document.documentElement.style.setProperty("--status-foot", `${foot}px`);
  }
  window.addEventListener("scroll", followStatus, { passive: true });
  window.addEventListener("resize", followStatus);
  new ResizeObserver(followStatus).observe($("status"));

  return { show, popped: () => place.popped() };
}
