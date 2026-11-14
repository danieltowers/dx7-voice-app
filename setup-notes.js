// The panel settings that matter, per instrument, and the Timepiece routing:
// the one copy of the wording, shown by the library page's setup view and the
// hardware page. Verbatim from the spec's user story 18 (the instrument's name
// standing as the heading of its note) and ticket 05, with the fourth target's
// note added later; a line after the first spells
// a note out. If a note proves wrong on the hardware, correct it here,
// in the spec and in research/sysex-reception.md.

export const SETUP_NOTES = Object.freeze([
  ["DX7IID", "Button 32, device number 1, Single mode."],
  ["DX7s", "Button 32, Exclusive on, device number 1."],
  ["TX816", "Modules on Common, receive channel 1 or Omni."],
  ["Timepiece", "Timepiece routing of the phone's input to all three.",
    "That is: the DX7s, the TX816's Common MIDI IN and the DX7IID."],
  ["Another DX7 or Dexed", "Its own target, off until you turn it on: the voice only, never the addendum, at its own address.",
    "An original DX7: SYS INFO AVAIL on, the address its MIDI receive channel. Dexed: the phone's MIDI output as its MIDI input."],
]);

// Fill a <dl> with the notes: the instrument, then each of its lines.
export function showSetupNotes(list) {
  list.replaceChildren(...SETUP_NOTES.flatMap(([instrument, ...lines]) => {
    const dt = document.createElement("dt");
    dt.textContent = instrument;
    return [dt, ...lines.map((line) => {
      const dd = document.createElement("dd");
      dd.textContent = line;
      return dd;
    })];
  }));
}
