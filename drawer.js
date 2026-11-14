// The library page's Edit drawer: one row per control (parameter-change.js,
// CONTROLS), each a slider over the voice last sent, and Reset. A new whole
// value goes to the targets that are on as a parameter change; the status
// line speaks only when one fails, and the slider then goes back to the value
// the instruments last received. Reset, on once something has been edited,
// sends the voice again. Its edit state is edit.js's; it lives in the dock
// with the step bar, and the room the list leaves below follows the dock's
// height. The page provides elements with these ids:
//
//   dock                          the bar along the bottom, the drawer in it
//   edit                          the step bar's button that opens and closes it
//   drawer, drawer-title          the drawer and the voice's name and slot
//   drawer-note, drawer-controls  why its controls are off, and their box
//   close-drawer, reset           its two buttons
//
// In the browser's history the drawer is an entry of its own over the view
// on screen, the same view with drawer set, so the back gesture closes it
// (DrawerHistory). A replace of the view keeps it open (shuffle, a filter);
// going to another view leaves it behind, and coming back to its entry opens
// it again.

import { CONTROLS } from "./parameter-change.js";
import { UNSENDABLE } from "./library.js";

const $ = (id) => document.getElementById(id);

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

  const rows = CONTROLS.map((control) => {
    const row = document.createElement("div");
    row.className = "row control";
    const input = document.createElement("input");
    input.type = "range";
    input.step = 1;
    input.id = `control-${control.id}`;
    const name = document.createElement("label");
    name.htmlFor = input.id;
    name.textContent = control.name;
    const output = document.createElement("output");
    output.htmlFor = input.id;
    row.append(name, input, output);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      const change = edit.set(control, value);
      if (change) {
        controls.change(control, value, `${control.name} ${edit.label(control)}`).then((sent) => {
          edit.settleChange(change, sent);
          show();
        });
      }
      show();
    });
    return { control, input, output };
  });
  $("drawer-controls").replaceChildren(...rows.map((row) => row.input.parentElement));

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
    if (edit.canOpen) for (const row of rows) showControl(row);
    $("reset").disabled = !edit.edited;
  }

  function showControl({ control, input, output }) {
    const { min, max } = edit.range(control);
    input.min = min;
    input.max = max;
    input.value = edit.value(control);
    input.disabled = !edit.ready;
    const label = edit.label(control);
    output.textContent = label;
    input.setAttribute("aria-valuetext", label);
  }

  // The room the list leaves below for the dock follows its height.
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--dock-height", `${$("dock").offsetHeight}px`);
  }).observe($("dock"));

  return { show, popped: () => place.popped() };
}
