// The voice library: the file exported by `tool/dx7 export-library`, checked,
// kept in IndexedDB, and read as origins, cartridges (folders), banks and
// slots. The file's shape is documented in src/dx7/library.py and the README
// ("The voice library file"); this module reads it and adds nothing to it.

import { SendError, voiceMessage } from "./send.js";

export const LIBRARY_VERSION = 1;

export class LibraryError extends Error {}

// A checked library from the file's text. Throws a LibraryError in plain
// words when the file is not a library, is a version this app does not know,
// or its fixture does not match this app's own assembly of the first voice.
export function parseLibrary(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new LibraryError("Refused: this file is not a voice library (it is not JSON). Open voice-library.json, written by tool/dx7 export-library.");
  }
  if (!doc || typeof doc !== "object" || !("version" in doc)) {
    throw new LibraryError("Refused: this file is not a voice library (it has no version). Open voice-library.json, written by tool/dx7 export-library.");
  }
  if (doc.version !== LIBRARY_VERSION) {
    throw new LibraryError(
      `Refused: the library file is version ${JSON.stringify(doc.version)}, and this app reads version ${LIBRARY_VERSION} only. ` +
      "Export the library again from the repo, or update the app.");
  }
  if (!Array.isArray(doc.voices) || !Array.isArray(doc.banks)) {
    throw new LibraryError("Refused: the library file has no voices or no banks.");
  }
  checkFixture(doc);
  return new Library(doc);
}

// The file carries one complete message, made by the core: the first voice at
// address 1. The app's own header and checksum must give the same bytes, or
// every send would be wrong.
function checkFixture(doc) {
  const fixture = doc.fixture;
  const refused = (why) => new LibraryError(
    `Refused: the library's fixture does not match this app's own message for voice ${fixture?.voice ?? 0} ` +
    `at address ${fixture?.address ?? 1} (${why}). The app and the export disagree about the message; nothing was loaded.`);
  if (!fixture || typeof fixture !== "object" || typeof fixture.message !== "string") throw refused("the file has no fixture");
  const entry = doc.voices[fixture.voice];
  if (!entry || typeof entry.voice !== "string") throw refused("the fixture's voice is not in the file");
  let mine, theirs;
  try {
    mine = voiceMessage(fromBase64(entry.voice), fixture.address);
    theirs = fromBase64(fixture.message);
  } catch (e) {
    throw refused(e instanceof SendError ? e.message : "its bytes are not base64");
  }
  if (mine.length !== theirs.length) throw refused(`${theirs.length} bytes in the file, ${mine.length} from the app`);
  const at = mine.findIndex((b, i) => b !== theirs[i]);
  if (at >= 0) throw refused(`byte ${at} differs`);
}

function fromBase64(base64) {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Why a slot whose voice entry is null cannot be sent.
export const UNSENDABLE = "its source file holds a value a voice message cannot carry";

// A slot as the pages show it: { number (1 to 32), name (as published),
// voice (the voice entry, or null when the voice cannot be sent),
// favourite ("love", "like" or null), detail (the attribution line) }.
export class Library {
  constructor(doc) {
    this.exported = doc.exported ?? null;
    this.voices = doc.voices;
    this.banks = doc.banks;
    // origin name -> folder name -> bank indices, each in the file's order.
    this.tree = new Map();
    this.keys = new Map();
    this.banks.forEach((bank, i) => {
      if (!this.tree.has(bank.origin)) this.tree.set(bank.origin, new Map());
      const folders = this.tree.get(bank.origin);
      if (!folders.has(bank.folder)) folders.set(bank.folder, []);
      folders.get(bank.folder).push(i);
      this.keys.set(bankKey(bank), i);
    });
  }

  get origins() {
    return [...this.tree.keys()];
  }

  folders(origin) {
    return [...(this.tree.get(origin)?.keys() ?? [])];
  }

  // Bank indices in one folder of an origin.
  banksIn(origin, folder) {
    return this.tree.get(origin)?.get(folder) ?? [];
  }

  bankCount(origin) {
    let n = 0;
    for (const banks of this.tree.get(origin)?.values() ?? []) n += banks.length;
    return n;
  }

  // A bank's stable name across exports (its origin, file and bank number),
  // for remembering a position; and the bank index for one, or -1.
  keyOf(bank) {
    return bankKey(this.banks[bank]);
  }

  bankAt(key) {
    return this.keys.get(key) ?? -1;
  }

  slot(bank, slot) {
    const entry = this.banks[bank]?.slots[slot];
    if (!entry) return null;
    const voice = this.voiceOf(entry);
    return {
      number: slot + 1,
      name: this.publishedName(entry).trim(),
      voice,
      favourite: voice?.favourite ?? null,
      detail: voice ? attribution(voice) : `Cannot be sent: ${UNSENDABLE}.`,
    };
  }

  voiceOf(entry) {
    return entry.voice === null || entry.voice === undefined ? null : this.voices[entry.voice] ?? null;
  }

  // The name a slot's copy was published under: its own, or its voice's.
  publishedName(entry) {
    return entry.name ?? this.voiceOf(entry)?.name ?? "";
  }

  // Searching. Every slot of every bank, once per library and only when first
  // asked for: its published name as matched (normaliseName), and whether it
  // is a favourite and can be sent. Some 137,000 slots: a pass over them is a
  // few milliseconds.
  get index() {
    if (!this._index) {
      const names = [], banks = [], slots = [], flags = [];
      this.banks.forEach((bank, b) => bank.slots.forEach((entry, s) => {
        const voice = this.voiceOf(entry);
        names.push(normaliseName(this.publishedName(entry)));
        banks.push(b);
        slots.push(s);
        flags.push((voice ? SENDABLE : 0) | (voice?.favourite ? FAVOURITE : 0));
      }));
      this._index = { names, banks: Int32Array.from(banks), slots: Uint8Array.from(slots), flags: Uint8Array.from(flags) };
    }
    return this._index;
  }

  // The slots ({ bank, slot }, in the file's order) whose published name
  // contains text, matched as normaliseName gives both; only favourites when
  // favouritesOnly. Empty text matches every slot.
  find(text, favouritesOnly = false) {
    const { names, banks, slots, flags } = this.index;
    const wanted = normaliseName(text);
    const found = [];
    for (let i = 0; i < names.length; i++) {
      if (favouritesOnly && !(flags[i] & FAVOURITE)) continue;
      if (wanted && !names[i].includes(wanted)) continue;
      found.push({ bank: banks[i], slot: slots[i] });
    }
    return found;
  }

  // A random slot that can be sent ({ bank, slot }), from the whole library,
  // or null when no slot can be sent (or there are none).
  randomSlot() {
    const { banks, slots, flags } = this.index;
    const i = randomIndex(flags.length, (n) => flags[n] & SENDABLE);
    return i < 0 ? null : { bank: banks[i], slot: slots[i] };
  }

  // A value made once per library under a key (a search's list, say), so
  // that showing a list again does not search again. Keeps the last few.
  cached(key, make) {
    this._cache ??= new Map();
    if (!this._cache.has(key)) {
      if (this._cache.size >= 8) this._cache.delete(this._cache.keys().next().value);
      this._cache.set(key, make());
    }
    return this._cache.get(key);
  }

  // The data bytes to send for a slot ({ voice, addendum }, as send.js takes
  // them), or null when the slot's voice cannot be sent.
  sendableVoice(bank, slot) {
    const voice = this.slot(bank, slot)?.voice;
    if (!voice) return null;
    return { voice: fromBase64(voice.voice), addendum: voice.addendum ? fromBase64(voice.addendum) : null };
  }
}

const SENDABLE = 1;
const FAVOURITE = 2;

// A random index from 0 to count - 1 for which ok(index) holds, or -1 when
// none does. A few random tries first (most slots can be sent), then a pick
// among all that qualify, so it ends even when none or few do.
export function randomIndex(count, ok) {
  for (let tries = 0; tries < 32 && count; tries++) {
    const i = Math.floor(Math.random() * count);
    if (ok(i)) return i;
  }
  const all = [];
  for (let i = 0; i < count; i++) if (ok(i)) all.push(i);
  return all.length ? all[Math.floor(Math.random() * all.length)] : -1;
}

// A name as searched: upper case, runs of spaces as one, no leading or
// trailing space ("brass  1 " and "BRASS 1" match).
export function normaliseName(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

function bankKey(bank) {
  return `${bank.origin}\n${bank.file}\n${bank.bank}`;
}

// How the attribution line says each level the file carries (dx7.manifest's
// levels); a level this app does not know is shown as the file says it.
const LEVEL_WORDS = { confirmed: "confirmed", "archive-attributed": "archive-attributed", unknown: "unknown designer" };

// "Brian Eno · archive-attributed", or for a built voice "dx7 build agent ·
// 2026-10-28-eno-glass · confirmed": what the file says, nothing added.
function attribution(voice) {
  const who = [voice.designer, voice.publisher].filter(Boolean);
  return [...who, LEVEL_WORDS[voice.attribution] ?? voice.attribution].join(" · ");
}

// Keeping the library: one record in IndexedDB, the file's text as loaded.
// Loading a file replaces it. The text is parsed and checked again on open.

const DB = "dx7-app";
const STORE = "library";
const KEY = "current";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new LibraryError("This browser cannot keep the library (no IndexedDB)."));
      return;
    }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new LibraryError(`The library cannot be kept in this browser: ${request.error?.message ?? "storage refused"}.`));
    request.onblocked = () => reject(new LibraryError("The library store is busy in another tab. Close the app's other tabs and reload."));
  });
}

function transact(mode, act) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = act(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(new LibraryError(`The library cannot be kept in this browser: ${tx.error?.message ?? "storage refused"}.`));
    };
  }));
}

// Keep the text of a checked library, with the file's name, replacing any
// earlier one.
export function keepLibrary(text, fileName) {
  return transact("readwrite", (store) => store.put({ text, fileName, loadedAt: new Date().toISOString() }, KEY));
}

// The kept library, checked again: { library, fileName, loadedAt }, or null
// when none is kept. Throws a LibraryError when the kept one is refused now
// (a newer app that no longer reads its version, say).
export async function keptLibrary() {
  const record = await transact("readonly", (store) => store.get(KEY));
  if (!record) return null;
  return { library: parseLibrary(record.text), fileName: record.fileName, loadedAt: record.loadedAt };
}
