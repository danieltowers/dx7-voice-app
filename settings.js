// Settings shared by every page of the app: the MIDI port, the three targets
// with their addresses, and the pause between messages. Kept in localStorage
// under one key, so the hardware page and the library page read and write the
// same thing. Storage can be missing or refuse (private window, site data
// blocked); then the defaults apply and nothing is remembered.

export const SETTINGS_KEY = "dx7-app.settings";

// The targets, in the order the pages show them. address is the device
// number on the DX7s and DX7IID and the receive channel on the TX816; the
// header byte carries it the same way. Only the DX7s and DX7IID take the
// DX7II addendum.
export const TARGETS = Object.freeze([
  Object.freeze({ id: "dx7s", label: "DX7s", addressLabel: "Device number", addendum: true }),
  Object.freeze({ id: "dx7iid", label: "DX7IID", addressLabel: "Device number", addendum: true }),
  Object.freeze({ id: "tx816", label: "TX816", addressLabel: "Channel", addendum: false }),
]);

export const DEFAULT_PAUSE_MS = 150;
export const MAX_PAUSE_MS = 1000;

// The first published default. Settings saved before the default changed
// (no SETTINGS_VERSION) holding it move to the new default once; a pause
// chosen afterwards is kept, whatever it is.
const FIRST_DEFAULT_PAUSE_MS = 50;
const SETTINGS_VERSION = 2;

export function defaultSettings() {
  return {
    port: null, // the chosen MIDI output's name; null until one is chosen
    targets: Object.fromEntries(TARGETS.map((t) => [t.id, { on: true, address: 1 }])),
    pauseMs: DEFAULT_PAUSE_MS,
  };
}

// The stored settings, each value checked and replaced by its default when
// missing or out of range.
export function loadSettings() {
  const stored = readStored(SETTINGS_KEY, {});
  const settings = stored && typeof stored === "object" ? stored : {};
  if (settings.version !== SETTINGS_VERSION && settings.pauseMs === FIRST_DEFAULT_PAUSE_MS) {
    delete settings.pauseMs;
  }
  return normalise(settings);
}

export function saveSettings(settings) {
  return writeStored(SETTINGS_KEY, { ...normalise(settings), version: SETTINGS_VERSION });
}

export function normalise(settings) {
  const defaults = defaultSettings();
  const targets = {};
  for (const t of TARGETS) {
    const given = settings.targets?.[t.id] ?? {};
    targets[t.id] = {
      on: typeof given.on === "boolean" ? given.on : defaults.targets[t.id].on,
      address: wholeIn(given.address, 1, 16) ?? defaults.targets[t.id].address,
    };
  }
  return {
    port: typeof settings.port === "string" && settings.port ? settings.port : null,
    targets,
    pauseMs: wholeIn(settings.pauseMs, 0, MAX_PAUSE_MS) ?? defaults.pauseMs,
  };
}

function wholeIn(value, low, high) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return Number.isInteger(n) && n >= low && n <= high ? n : null;
}

// JSON in localStorage, for any page's own keys too (the library page keeps
// its last position this way). Returns fallback when nothing is stored or
// storage cannot be read.
export function readStored(key, fallback = null) {
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? fallback : JSON.parse(text);
  } catch {
    return fallback;
  }
}

// Returns false when storage refused the write.
export function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
