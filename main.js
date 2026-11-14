// The library page: load the library file, browse origin, cartridge (folder),
// bank and slot, search by name, filter to favourites, shuffle, and send a
// voice with a tap; next and previous step through the current list and send.
//
// What is shown is a view, kept in the browser's history so that the phone's
// back gesture goes up a level: { level: "origins" }, { level: "folders",
// origin }, { level: "banks", origin, folder }, { level: "setup" }, or
// { level: "list", kind, key } for a list of slots (kind "bank": a bank, by
// its key; "search" or "favourites": the filter's hits, by the search text;
// "history": the voices sent, newest first).
// The search box and the favourites toggle show the filter of the view on
// screen; changing them replaces a filter view, or pushes one over a browsing
// view. The current list (current-list.js) is separate: browsing elsewhere
// leaves it, and next and previous still step through it.
//
// The Edit drawer (drawer.js) opens over the view on screen as a history
// entry of its own, the same view with drawer set; a replace keeps it.

import { createControls } from "./controls.js";
import { createDrawer } from "./drawer.js";
import { Edit } from "./edit.js";
import {
  Current, FILTER_KINDS, POSITION_KEY, bankList, clearHistory, filterList, filterOf, historyCount,
  historyList, noteSent, positionOf, restorePosition, whenAt,
} from "./current-list.js";
import {
  LibraryError, UNSENDABLE, keepLibrary, keptLibrary, normaliseName, parseLibrary, randomIndex,
} from "./library.js";
import { readStored, writeStored } from "./settings.js";
import { showSetupNotes } from "./setup-notes.js";
import { keepShell } from "./shell.js";

const $ = (id) => document.getElementById(id);

const controls = createControls();
const current = new Current();
const edit = new Edit(); // the edit of the voice last sent, never stored
const drawer = createDrawer({ edit, controls, reset: () => sendCurrent({ reset: true }) });
let library = null; // the library file's, as loaded
let onScreen = null; // the view rendered
let shown = null; // the list on screen, when the view is a list
let rendered = 0; // how many of its entries have rows

const ORIGINS = Object.freeze({ level: "origins" });
const SETUP = Object.freeze({ level: "setup" });
const TIERS = { love: "Love", like: "Like" };
const ROWS = 100; // rows added at a time to a long list (a search for "A" has tens of thousands)
const TYPING_MS = 200; // the search runs this long after the last key

// Views and history. The page places the scroll itself (render goes to the
// top), so closing the drawer by the back gesture leaves the list where it was.

history.scrollRestoration = "manual";

function depth() {
  return history.state?.depth ?? 0;
}

function view() {
  return history.state?.view ?? ORIGINS;
}

function go(next) {
  history.pushState({ view: next, depth: depth() + 1 }, "");
  render(next);
}

// In place of the view on screen, the drawer staying open over it.
function replace(next) {
  history.replaceState({ ...history.state, view: next, depth: depth() }, "");
  render(next);
}

function sameView(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// From the top to a bank: the views passed through, skipping a folder list
// with one folder and a bank list with one bank.
function pathTo(bank) {
  const { origin, folder } = library.banks[bank];
  const path = [ORIGINS];
  if (library.folders(origin).length > 1) path.push({ level: "folders", origin });
  if (library.banksIn(origin, folder).length > 1) path.push({ level: "banks", origin, folder });
  path.push(listView(bankList(library, bank)));
  return path;
}

function listView(list) {
  return { level: "list", kind: list.kind, key: list.key };
}

function isFilterView(v) {
  return v?.level === "list" && FILTER_KINDS.includes(v.kind);
}

// The list a list view shows, or null when this library has no such list.
function listOf(v) {
  if (v.kind === "bank") {
    const bank = library.bankAt(v.key);
    return bank < 0 ? null : bankList(library, bank);
  }
  if (v.kind === "history") return historyList(library);
  const filter = filterOf(v);
  return filter ? filterList(library, filter) : null;
}

// Replace the whole history with the views from the top to the path's end.
function resetHistory(path) {
  history.replaceState({ view: path[0], depth: 0 }, "");
  for (const [i, v] of path.slice(1).entries()) history.pushState({ view: v, depth: i + 1 }, "");
  render(path.at(-1));
}

function openOrigin(origin) {
  const folders = library.folders(origin);
  if (folders.length === 1) openFolder(origin, folders[0]);
  else go({ level: "folders", origin });
}

function openFolder(origin, folder) {
  const banks = library.banksIn(origin, folder);
  if (banks.length === 1) go(listView(bankList(library, banks[0])));
  else go({ level: "banks", origin, folder });
}

function folderName(origin, folder) {
  return folder || origin;
}

// The filter: the search box and the favourites toggle.

function filterNow() {
  return { query: $("search").value, favourites: $("favourites").getAttribute("aria-pressed") === "true" };
}

// Show the filter a view stands for (none for a browsing view), leaving the
// text alone while it already says the same thing.
function showFilter(v) {
  const filter = isFilterView(v) ? filterOf(v) : { query: "", favourites: false };
  if (normaliseName($("search").value) !== filter.query) $("search").value = filter.query;
  $("favourites").setAttribute("aria-pressed", String(filter.favourites));
}

let typing = null;

// Show the filter's list: in place of a filter view, or over a browsing
// view; with the filter cleared, back to where browsing was.
function applyFilter() {
  clearTimeout(typing);
  if (!library) return;
  const list = filterList(library, filterNow());
  const on = view();
  if (list) {
    if (isFilterView(on)) replace(listView(list));
    else go(listView(list));
  } else if (isFilterView(on)) {
    if (depth() > 0) history.back();
    else replace(ORIGINS);
  }
}

$("search").addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(applyFilter, TYPING_MS);
});
$("search").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  applyFilter();
  $("search").blur();
});
$("favourites").addEventListener("click", () => {
  $("favourites").setAttribute("aria-pressed", String(!filterNow().favourites));
  applyFilter();
});

// Shuffle: a random slot that can be sent, from the filter's list when there
// is a filter, otherwise from the whole library (then its bank is shown, and
// next and previous walk that bank).
function shuffle() {
  if (!library) return;
  clearTimeout(typing);
  const list = filterList(library, filterNow());
  if (list) {
    const index = randomIndex(list.entries.length,
      (i) => !!library.slot(list.entries[i].bank, list.entries[i].slot).voice);
    if (index < 0) {
      controls.showResult("Nothing to shuffle: no voice in this list can be sent.", true);
      return;
    }
    current.set(list, index);
    const v = listView(list);
    if (!isFilterView(view())) go(v);
    else if (!current.isShowing(shown)) replace(v);
  } else {
    const picked = library.randomSlot();
    if (!picked) {
      controls.showResult("Nothing to shuffle: no voice in this library can be sent.", true);
      return;
    }
    const { bank, slot } = picked;
    const bankView = listView(bankList(library, bank));
    current.set(bankList(library, bank), slot);
    if (view().level === "list") replace(bankView);
    else go(bankView);
  }
  sendCurrent();
}

$("shuffle").addEventListener("click", shuffle);

// History: the voices sent, newest first. While the history is the current
// list, its sends are not recorded, so walking it leaves its order alone.
$("history").addEventListener("click", () => {
  if (!library) return;
  clearTimeout(typing);
  const v = listView(historyList(library));
  if (view().level === "list" && view().kind === "history") return;
  if (isFilterView(view())) replace(v);
  else go(v);
});

function showHistoryCount() {
  const n = historyCount();
  $("history-line").textContent = n ? `${plural(n, "voice")} in the history.` : "The history is empty.";
  $("clear-history").disabled = !n;
}

$("clear-history").addEventListener("click", () => {
  clearHistory();
  if (current.list?.kind === "history") {
    current.clear();
    edit.clear();
    drawer.show();
  }
  showHistoryCount();
  markCurrent();
});

// Rendering.

function render(v) {
  onScreen = v;
  drawer.show();
  shown = null;
  rendered = 0;
  const setup = v.level === "setup";
  $("setup").hidden = !setup;
  $("browse").hidden = setup;
  $("filters").hidden = setup || !library;
  $("shuffle").disabled = !library;
  $("history").disabled = !library;
  $("history").setAttribute("aria-pressed", String(v.level === "list" && v.kind === "history"));
  $("to-setup").textContent = setup ? "Done" : "Setup";
  $("up").hidden = depth() === 0;
  $("empty").hidden = !!library;
  $("no-hits").hidden = true;
  $("more-row").hidden = true;
  showFilter(v);
  if (setup) {
    showHistoryCount();
    window.scrollTo(0, 0);
    return;
  }
  if (!library) {
    heading("", "No library");
    $("items").replaceChildren();
    return;
  }
  if (v.level === "folders" && library.folders(v.origin).length) {
    heading(v.origin, "Cartridges and folders");
    items(library.folders(v.origin).map((folder) => {
      const n = library.banksIn(v.origin, folder).length;
      return item(folderName(v.origin, folder), plural(n, "bank"), () => openFolder(v.origin, folder));
    }));
  } else if (v.level === "banks" && library.banksIn(v.origin, v.folder).length) {
    heading(v.folder ? v.origin : "", v.folder ? v.folder : `${v.origin}: banks`);
    items(library.banksIn(v.origin, v.folder).map((bank) => {
      const b = library.banks[bank];
      return item(b.name, plural(b.slots.length, "voice"), () => go(listView(bankList(library, bank))));
    }));
  } else if (v.level === "list" && listOf(v)) {
    showList(listOf(v));
  } else {
    heading("", "Origins");
    items(library.origins.map((origin) =>
      item(origin, plural(library.bankCount(origin), "bank"), () => openOrigin(origin))));
  }
  window.scrollTo(0, 0);
}

function heading(context, title) {
  $("view-context").textContent = context;
  $("view-title").textContent = title;
}

function items(nodes) {
  $("items").replaceChildren(...nodes);
}

// A row of a list: one button with a name and a detail line. Returns the row,
// and its button and name for a slot row to add to.
function itemParts(name, detail, onTap) {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "item";
  const title = document.createElement("span");
  title.className = "item-name";
  title.textContent = name;
  const line = document.createElement("span");
  line.className = "item-detail";
  line.textContent = detail;
  button.append(title, line);
  button.addEventListener("click", onTap);
  li.append(button);
  return { li, button, title };
}

function item(name, detail, onTap) {
  return itemParts(name, detail, onTap).li;
}

function plural(n, word) {
  return `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;
}

// A list of slots: a bank's, or a filter's hits across the library (each hit
// then says which bank it is in). A long list gets its rows a hundred at a
// time; next and previous, and the current entry, add rows as they need.
function showList(list) {
  shown = list;
  rendered = 0;
  items([]);
  const kind = LISTS[list.kind];
  heading(kind.context(list), list.title);
  if (!list.entries.length) {
    $("no-hits").textContent = kind.none(list);
    $("no-hits").hidden = false;
  }
  addRows(current.isShowing(list) ? current.index + 1 : 0);
  markCurrent();
}

// What a list of each kind says: the line above its title, what it says when
// it is empty, and each slot's detail line (a hit also says which bank it is in).
const LISTS = {
  bank: {
    context: (list) => {
      const first = library.banks[list.entries[0]?.bank];
      return first ? [first.origin, first.folder].filter(Boolean).join(" › ") : "";
    },
    none: () => "This bank has no slots.",
    detail: (_, slot) => slot.detail,
  },
  search: {
    context: (list) => `Search: ${plural(list.entries.length, "slot")}`,
    none: (list) => `No slot's name contains “${list.key}”.`,
    detail: (entry, slot) => `${whereIs(entry.bank)} · ${slot.detail}`,
  },
  favourites: {
    context: (list) => `Favourites: ${plural(list.entries.length, "slot")}`,
    none: (list) => (list.key ? `No favourite's name contains “${list.key}”.` : "No slot in this library is marked as a favourite."),
    detail: (entry, slot) => `${whereIs(entry.bank)} · ${slot.detail}`,
  },
  history: {
    context: (list) => `History: ${plural(list.entries.length, "voice")}, newest first`,
    none: () => "Nothing sent yet. Each voice you send appears here, newest first.",
    detail: (entry) => `${whenAt(entry.at)} · ${whereIs(entry.bank)}`,
  },
};

// Rows up to at least count entries, in steps of ROWS, and the "more" button.
function addRows(count) {
  const list = shown;
  const upTo = Math.min(list.entries.length, Math.max(rendered + ROWS, Math.ceil(count / ROWS) * ROWS));
  if (upTo <= rendered) return;
  const rows = [];
  for (let index = rendered; index < upTo; index++) rows.push(slotRow(list, index));
  $("items").append(...rows);
  rendered = upTo;
  const left = list.entries.length - rendered;
  $("more-row").hidden = left <= 0;
  $("more").textContent = `Showing ${rendered.toLocaleString("en-GB")} of ${list.entries.length.toLocaleString("en-GB")}. Show ${Math.min(ROWS, left)} more`;
}

$("more").addEventListener("click", () => {
  if (shown) addRows(rendered + ROWS);
  markCurrent();
});

function slotRow(list, index) {
  const entry = list.entries[index];
  const slot = library.slot(entry.bank, entry.slot);
  const { li, button, title } = itemParts(slot.name || "(no name)", LISTS[list.kind].detail(entry, slot), () => {
    current.set(list, index);
    sendCurrent();
  });
  button.classList.add("slot");
  button.dataset.index = index;
  if (!slot.voice) button.classList.add("unsendable");
  const number = document.createElement("span");
  number.className = "slot-number";
  number.textContent = slot.number;
  button.prepend(number);
  if (slot.favourite) {
    const mark = document.createElement("span");
    mark.className = `tier tier-${slot.favourite}`;
    mark.textContent = TIERS[slot.favourite] ?? slot.favourite;
    title.append(" ", mark);
  }
  return li;
}

// Where a bank was published, for a hit: "Original Yamaha/DX7 ROM1 › ROM1A"
// (its cartridge or folder, or its origin when it has none, then its name);
// a bank named as its folder says its name once.
function whereIs(bank) {
  const b = library.banks[bank];
  const place = b.folder || b.origin;
  return place === b.name ? b.name : `${place} › ${b.name}`;
}

// The current entry, highlighted when its list is on screen, and the bar.
function markCurrent(scroll = false) {
  const showing = current.isShowing(shown);
  if (showing && current.index >= rendered) addRows(current.index + 1);
  for (const button of $("items").querySelectorAll(".slot")) {
    const isCurrent = showing && Number(button.dataset.index) === current.index;
    button.classList.toggle("current", isCurrent);
    if (isCurrent) {
      button.setAttribute("aria-current", "true");
      if (scroll) revealRow(button);
    } else {
      button.removeAttribute("aria-current");
    }
  }
  const entry = current.entry;
  if (entry && library) {
    $("now").textContent = labelOf(entry);
    $("now").disabled = showing;
  } else {
    $("now").textContent = "Nothing chosen yet";
    $("now").disabled = true;
  }
  $("prev").disabled = !library || !current.canStep(-1);
  $("next").disabled = !library || !current.canStep(1);
}

// Scroll just enough that a row sits in the part of the screen the sticky
// status line (top) and the dock (bottom: the step bar, and the Edit drawer
// when it is open) leave clear, with a little room
// either side so the next row along shows too.
const REVEAL_ROOM = 24; // px

function revealRow(row) {
  const clearTop = Math.max(0, $("status").getBoundingClientRect().bottom);
  const clearBottom = Math.min(window.innerHeight, $("dock").getBoundingClientRect().top);
  const { top, bottom } = row.getBoundingClientRect();
  if (bottom > clearBottom - REVEAL_ROOM) {
    window.scrollBy(0, bottom - (clearBottom - REVEAL_ROOM));
  } else if (top < clearTop + REVEAL_ROOM) {
    window.scrollBy(0, top - (clearTop + REVEAL_ROOM));
  }
}

// Sending.

// "BRASS 1 (ROM1A slot 1)": the name as published (runs of spaces as one,
// as a page shows them) and where.
function labelOf(entry) {
  const slot = library.slot(entry.bank, entry.slot);
  const name = (slot.name || "(no name)").replace(/\s+/g, " ");
  return `${name} (${library.banks[entry.bank].name} slot ${slot.number})`;
}

// Send the current voice as published: a tap, next, previous, shuffle, or
// Reset (reset true), which sends the voice last sent again and is not noted
// in the history.
function sendCurrent({ reset = false } = {}) {
  const entry = current.entry;
  if (!library) {
    controls.showResult("Not sent: no library is loaded. Open the library file first.", true);
    return;
  }
  if (!entry) return;
  writeStored(POSITION_KEY, positionOf(library, current));
  markCurrent(true);
  const label = labelOf(entry);
  const voice = library.sendableVoice(entry.bank, entry.slot);
  // Every send replaces the edit; the controls come on once it has gone out.
  const sending = edit.begin(label, voice?.voice ?? null);
  drawer.show();
  if (!voice) {
    controls.showResult(`${label} not sent: ${UNSENDABLE}.`, true);
    return;
  }
  if (!reset) noteSent(library, current.list, entry);
  controls.send(voice, label).then((sent) => {
    edit.settle(sending, sent);
    drawer.show();
  });
}

function step(delta) {
  if (current.step(delta)) sendCurrent();
}

$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("up").addEventListener("click", () => history.back());
$("now").addEventListener("click", () => {
  if (current.list) go(listView(current.list));
});
// Setup opens over the view on screen, and its Done button goes back to it.
function toggleSetup() {
  if (view().level !== SETUP.level) go(SETUP);
  else if (depth() > 0) history.back();
  else replace(ORIGINS);
}

$("to-setup").addEventListener("click", toggleSetup);

// Opening or closing the drawer leaves the view under it as it was, scroll
// position included. The drawer may rewrite the entry the history moved to,
// so the view is read from it after.
window.addEventListener("popstate", () => {
  drawer.popped();
  const v = view();
  if (sameView(v, onScreen)) drawer.show();
  else render(v);
});

// Loading the library.

function describe(fileName, exported) {
  const voices = library.voices.length.toLocaleString("en-GB");
  const banks = library.banks.length.toLocaleString("en-GB");
  return `${fileName ?? "The library"}${exported ? `, exported ${exported}` : ""}: ${voices} voices in ${banks} banks.`;
}

// Use a checked library file (or none, null): restore the kept position in
// it and show its list, or the origins when there is none.
function use(next, fileName) {
  library = next;
  edit.clear(); // nothing of the new library has been sent yet
  if (next) $("library-line").textContent = describe(fileName, next.exported);
  if (!library) {
    current.clear();
    resetHistory([ORIGINS]);
    markCurrent();
    return;
  }
  // Build the search index while the page is idle, so the first search is as
  // quick as the rest.
  (window.requestIdleCallback ?? setTimeout)(() => void library.index);
  const restored = restorePosition(library, readStored(POSITION_KEY));
  if (restored) {
    current.set(restored.list, restored.index);
    resetHistory(restored.list.kind === "bank"
      ? pathTo(restored.list.entries[0].bank)
      : [ORIGINS, listView(restored.list)]);
    markCurrent(true);
  } else {
    current.clear();
    resetHistory([ORIGINS]);
    markCurrent();
  }
}

$("file").addEventListener("change", async () => {
  const file = $("file").files[0];
  $("file").value = "";
  if (!file) return;
  controls.showResult(`Reading ${file.name}…`);
  let next, text;
  try {
    text = await file.text();
    next = parseLibrary(text);
  } catch (e) {
    controls.showResult(`${file.name}: ${e instanceof LibraryError ? e.message : `it could not be read (${e?.message ?? e}).`}` +
      (library ? " The library already kept is still in use." : ""), true);
    return;
  }
  let kept = true;
  try {
    await keepLibrary(text, file.name);
  } catch (e) {
    kept = false;
    controls.showResult(`${file.name} is loaded but cannot be kept: ${e.message} Open it again next time.`, true);
  }
  use(next, file.name);
  if (kept) controls.showResult(`Loaded ${describe(file.name, next.exported)}`);
});

async function start() {
  showSetupNotes($("setup-notes"));
  keepShell();
  let kept = null;
  try {
    kept = await keptLibrary();
  } catch (e) {
    controls.showResult(e instanceof LibraryError ? e.message : `The kept library could not be read: ${e?.message ?? e}`, true);
  }
  use(kept?.library ?? null, kept?.fileName);
}

start();
