// The edit: changes made from the library page's Edit drawer to the voice
// last sent, heard on the targets as parameter changes (parameter-change.js).
// Pure and free of the page, and never stored: it lives only in the
// instruments' edit buffers, and every send of a voice replaces it.
//
// The page tells it each send of a voice as it starts (begin) and how it
// ended (settle); status is then
//
//   "none"        nothing sent yet, or the current voice is gone (clear)
//   "unsendable"  the current voice cannot be sent, so it cannot be edited
//   "sending"     its send has not finished
//   "sent"        its send succeeded: the controls may send changes
//   "failed"      its send failed or was replaced: the controls stay off
//
// A control is an entry of CONTROLS in parameter-change.js. The values set
// are kept by control id while the voice stays current, so the drawer shows
// them again when it reopens. The page tells it how each change ended
// (settleChange), so that a control whose change could not be sent goes back
// to the value the instruments last received. A Reset is a send like any
// other, offered while edited is true.

import { isWholeIn, startingValue } from "./parameter-change.js";

export class Edit {
  constructor() {
    this.clear();
  }

  // No current voice: nothing to edit, as before any send.
  clear() {
    this.name = null; // the voice's name and slot, as the page shows it
    this.data = null; // its 155 single-voice data bytes
    this.status = "none";
    this.send = null;
    this.values = new Map(); // control id -> the value last set
    this.received = new Map(); // control id -> the value of the last change that went out
    this.newest = new Map(); // control id -> the last change set returned
    this.editLeft = false; // the instruments may still hold an edit made before this send
  }

  // A send of the voice named name (data its 155 single-voice data bytes, or
  // null when it is unsendable) starts. Any edit is gone. Returns the token
  // to settle it with. Until a send succeeds, the instruments may still hold
  // an edit made before it.
  begin(name, data) {
    const editLeft = this.#mayDiffer;
    this.clear();
    this.editLeft = editLeft;
    this.name = name;
    if (!data) {
      this.status = "unsendable";
      return null;
    }
    this.data = data;
    this.status = "sending";
    this.send = {};
    return this.send;
  }

  // The send begin returned token for ended: sent or not. Only the newest
  // send counts; an older one ending late changes nothing.
  settle(token, sent) {
    if (!token || token !== this.send || this.status !== "sending") return;
    this.status = sent ? "sent" : "failed";
  }

  // Whether the drawer may open: a sendable voice has been sent (or is being
  // sent, or failed to be: the drawer then says why its controls are off).
  get canOpen() {
    return this.data !== null;
  }

  // Whether the controls may send: the current voice's send succeeded.
  get ready() {
    return this.status === "sent";
  }

  // Whether the instruments may hold anything but the voice as published: a
  // control has been set since the voice was sent, or no send has succeeded
  // since an edit was left on them.
  get #mayDiffer() {
    return this.values.size > 0 || (this.status !== "sent" && this.editLeft);
  }

  // Whether Reset is offered: the voice's send has ended (sent, or failed),
  // and the instruments may hold anything but the voice as published.
  get edited() {
    return (this.status === "sent" || this.status === "failed") && this.#mayDiffer;
  }

  // A control's value: the one last set, otherwise the voice's stored value.
  value(control) {
    return this.values.get(control.id) ?? startingValue(control, this.data);
  }

  // The control's span for this voice: { min, max }.
  range(control) {
    return control.range(this.data);
  }

  // A value of the control (by default its value now) as the panel shows it.
  label(control, value = this.value(control)) {
    return control.label(value, this.data);
  }

  // Set a control to value. When it is a new value to send (the voice's send
  // has succeeded, the value is in the control's span, and it is not the
  // value the control already has), returns the change to settle once it has
  // been sent or not; otherwise null.
  set(control, value) {
    if (!this.ready) return null;
    const { min, max } = this.range(control);
    if (!isWholeIn(value, min, max)) return null;
    if (value === this.value(control)) return null;
    this.values.set(control.id, value);
    const change = { send: this.send, control, value };
    this.newest.set(control.id, change);
    return change;
  }

  // The change set returned ended: sent true, not sent false, or null when a
  // newer change to the same control replaced it. When the newest change to
  // a control is not sent, the control goes back to the value the
  // instruments last received (and counts as unedited if they never received
  // a change to it); an older one failing leaves the newer to decide. A
  // change to a voice since replaced by another send changes nothing.
  settleChange(change, sent) {
    if (!change || change.send !== this.send) return;
    const { control, value } = change;
    if (sent === true) {
      this.received.set(control.id, value);
    } else if (sent === false && this.newest.get(control.id) === change) {
      if (this.received.has(control.id)) this.values.set(control.id, this.received.get(control.id));
      else this.values.delete(control.id);
    }
  }
}
