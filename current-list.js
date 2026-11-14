// The current list: the slots that next and previous step through, and which
// of them is current. Opening a bank shows that bank's list; tapping a slot
// in a shown list makes that list the current one. Any list of slots can be
// current: a bank's 32, a search's hits or the favourites, each built with
// makeList from any slots of the library.
//
// A list is { kind, title, key, entries }: kind names where it came from
// ("bank", "search", "favourites" or "history"), title is what the page heads it with,
// key identifies it among lists of its kind (the bank's key; the search text
// as normalised), and entries are { bank, slot } (bank index into the
// library, slot index from 0), in the order stepped through.

import { normaliseName } from "./library.js";
import { readStored, writeStored } from "./settings.js";

function makeList(kind, title, key, entries) {
  return Object.freeze({ kind, title, key, entries: Object.freeze(entries) });
}

export function bankList(library, bank) {
  const b = library.banks[bank];
  return makeList("bank", b.name, library.keyOf(bank), b.slots.map((_, slot) => ({ bank, slot })));
}

// The filter on the library page: { query, favourites }. The list of slots it
// selects across the whole library, in the file's order, or null when it
// selects nothing in particular (no text, favourites off). Search text is
// matched without regard to case or runs of spaces (normaliseName).
export const FILTER_KINDS = Object.freeze(["search", "favourites"]);

export function filterList(library, { query = "", favourites = false }) {
  const key = normaliseName(query);
  if (!key && !favourites) return null;
  const kind = favourites ? "favourites" : "search";
  const title = favourites
    ? (key ? `Favourites named “${key}”` : "Favourites")
    : `Named “${key}”`;
  return library.cached(`${kind}\n${key}`, () => makeList(kind, title, key, library.find(key, favourites)));
}

// The filter a filter list was made from, or null for a bank's list.
export function filterOf(list) {
  if (!list || !FILTER_KINDS.includes(list.kind)) return null;
  return { query: list.key, favourites: list.kind === "favourites" };
}

// The history: the voices sent, newest first, kept in localStorage as
// { bank (key), slot, at (ISO time) }. Sending a slot again moves it to the
// top, so each slot appears once. Its list's entries also carry `at`.
// When a voice was sent, for the history: "Today 21:04", "Yesterday 09:12"
// or "3 Nov 2026 18:30".
export function whenAt(at) {
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return "";
  const clock = time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(time)) / 86400000);
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Yesterday ${clock}`;
  return `${time.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} ${clock}`;
}

export const HISTORY_KEY = "dx7-app.history";
const HISTORY_MAX = 200;

function storedHistory() {
  const kept = readStored(HISTORY_KEY, []);
  return Array.isArray(kept)
    ? kept.filter((h) => h && typeof h.bank === "string" && Number.isInteger(h.slot) && typeof h.at === "string")
    : [];
}

function recordSent(library, entry, at) {
  const bank = library.keyOf(entry.bank);
  const rest = storedHistory().filter((h) => !(h.bank === bank && h.slot === entry.slot));
  writeStored(HISTORY_KEY, [{ bank, slot: entry.slot, at: at.toISOString() }, ...rest].slice(0, HISTORY_MAX));
}

// A send of a voice, entry of the current list list, as the history notes it:
// at the top, at time at; except while the history is the current list, so
// walking it leaves its order alone. (A Reset, which sends the voice last
// sent again, already in the history, is not a send to note.)
export function noteSent(library, list, entry, at = new Date()) {
  if (list.kind === "history") return;
  recordSent(library, entry, at);
}

export function clearHistory() {
  writeStored(HISTORY_KEY, []);
}

export function historyCount() {
  return storedHistory().length;
}

// The history as a list of this library's slots (a slot whose bank this
// library no longer has is left out).
export function historyList(library) {
  const entries = [];
  for (const h of storedHistory()) {
    const bank = library.bankAt(h.bank);
    if (bank >= 0 && library.slot(bank, h.slot)) entries.push({ bank, slot: h.slot, at: h.at });
  }
  return makeList("history", "History", "", entries);
}

// The current list and the index of its current entry (-1: none yet).
export class Current {
  constructor() {
    this.list = null;
    this.index = -1;
  }

  set(list, index) {
    this.list = list;
    this.index = index;
  }

  clear() {
    this.set(null, -1);
  }

  get entry() {
    return this.list?.entries[this.index] ?? null;
  }

  // Whether a step of delta (1 next, -1 previous) stays in the list.
  canStep(delta) {
    if (!this.list) return false;
    const to = this.index + delta;
    return to >= 0 && to < this.list.entries.length;
  }

  // Move by delta and return the new entry, or null at either end.
  step(delta) {
    if (!this.canStep(delta)) return null;
    this.index += delta;
    return this.entry;
  }

  isShowing(list) {
    return !!this.list && !!list && this.list.kind === list.kind && this.list.key === list.key;
  }
}

// The last position, kept in localStorage: the current entry's bank (by its
// key, stable across exports) and slot, and, when the current list is a
// search or the favourites, that list's kind and key. Restoring opens that
// list again at the same slot, or the bank when the list no longer holds it.
export const POSITION_KEY = "dx7-app.position";

export function positionOf(library, current) {
  const entry = current.entry;
  if (!entry) return null;
  const position = { bank: library.keyOf(entry.bank), slot: entry.slot };
  if (filterOf(current.list)) position.list = { kind: current.list.kind, key: current.list.key };
  return position;
}

// The list and index for a kept position, or null when the library no
// longer has that bank or slot.
export function restorePosition(library, position) {
  if (!position || typeof position.bank !== "string") return null;
  const bank = library.bankAt(position.bank);
  if (bank < 0) return null;
  const list = bankList(library, bank);
  if (!(Number.isInteger(position.slot) && position.slot >= 0 && position.slot < list.entries.length)) return null;
  const filter = filterOf(position.list);
  if (filter && typeof position.list.key === "string") {
    const filtered = filterList(library, filter);
    const index = filtered?.entries.findIndex((e) => e.bank === bank && e.slot === position.slot) ?? -1;
    if (index >= 0) return { list: filtered, index };
  }
  return { list, index: position.slot };
}
