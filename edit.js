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
// The edit holds the voice as edited: the voice's 155 data bytes with the
// parameter values set so far laid over them, kept by parameter number while
// the voice stays current, so the drawer shows them again when it reopens.
// A control (parameter-change.js, CONTROLS) is a view of it, so it shows
// parameters other controls wrote.
//
// A move (set) is one change to the edit, however many parameters it
// writes: { writes }, a list of { parameter, value } to send in order. The
// page tells it what became of each (settleMove). When any of a move's
// messages could not be sent, every parameter it wrote goes back to the
// value the instruments last received. A Reset is a send like any other,
// offered while edited is true.

import { isWholeIn, labelAt, withWrites } from "./parameter-change.js";

export class Edit {
  #asEdited = null; // the voice as edited, built on first read after a change

  constructor() {
    this.clear();
  }

  // No current voice: nothing to edit, as before any send.
  clear() {
    this.name = null; // the voice's name and slot, as the page shows it
    this.data = null; // its 155 single-voice data bytes, as published
    this.status = "none";
    this.send = null;
    this.values = new Map(); // parameter -> the value last set
    this.received = new Map(); // parameter -> the value of the last change to it that went out
    this.newest = new Map(); // parameter -> the last move that wrote it
    this.editLeft = false; // the instruments may still hold an edit made before this send
    this.#asEdited = null;
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
    this.#asEdited = null;
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
  // parameter has been set since the voice was sent, or no send has
  // succeeded since an edit was left on them.
  get #mayDiffer() {
    return this.values.size > 0 || (this.status !== "sent" && this.editLeft);
  }

  // Whether Reset is offered: the voice's send has ended (sent, or failed),
  // and the instruments may hold anything but the voice as published.
  get edited() {
    return (this.status === "sent" || this.status === "failed") && this.#mayDiffer;
  }

  // The voice as edited: 155 data bytes (null with no voice), a copy of the
  // voice built once per change to the edit and the same array until the
  // next; read it, never change it.
  get voice() {
    if (!this.data) return null;
    this.#asEdited ??= withWrites(this.data, [...this.values].map(([parameter, value]) => ({ parameter, value })));
    return this.#asEdited;
  }

  // A parameter's value as set, or (value undefined) back to the voice's own.
  #setValue(parameter, value) {
    if (value === undefined) this.values.delete(parameter);
    else this.values.set(parameter, value);
    this.#asEdited = null;
  }

  // Where the voice as edited sits on a control.
  position(control) {
    return control.position(this.voice);
  }

  // The control's span for the voice as edited: { min, max }.
  span(control) {
    return control.span(this.voice);
  }

  // The control's label for the voice as edited, or for it moved to
  // position: as the panel shows it.
  label(control, position) {
    return position === undefined ? control.label(this.voice) : labelAt(control, position, this.voice);
  }

  // Move a control to position. When that is a move to send (the voice's
  // send has succeeded, the position is in the control's span and is not
  // where the control sits, and it writes a value that differs), returns the
  // move to settle, { send, writes }, writes being only the parameters that
  // differ; otherwise null.
  set(control, position) {
    if (!this.ready) return null;
    const voice = this.voice;
    const { min, max } = control.span(voice);
    if (!isWholeIn(position, min, max) || position === control.position(voice)) return null;
    const writes = control.writes(position, voice).filter(({ parameter, value }) => voice[parameter] !== value);
    if (writes.length === 0) return null;
    const move = { send: this.send, writes };
    for (const { parameter, value } of writes) {
      this.#setValue(parameter, value);
      this.newest.set(parameter, move);
    }
    return move;
  }

  // The move set returned ended: sent has one entry per write, in order,
  // true when it went out, false when it could not be sent, null when a
  // newer change to the same parameter replaced it. What went out is what
  // the instruments last received. When any write could not be sent, each
  // parameter the move wrote goes back to the value the instruments last
  // received (unedited if they never received a change to it), unless a
  // newer move has written it since, which then decides. A move to a voice
  // since replaced by another send changes nothing.
  settleMove(move, sent) {
    if (!move || move.send !== this.send) return;
    move.writes.forEach(({ parameter, value }, i) => {
      if (sent[i] === true) this.received.set(parameter, value);
    });
    if (!sent.includes(false)) return;
    for (const { parameter } of move.writes) {
      if (this.newest.get(parameter) !== move) continue;
      this.#setValue(parameter, this.received.get(parameter));
    }
  }
}
