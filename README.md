# dx7-voice-app

A web app that sends Yamaha DX7 voices over Web MIDI into an instrument's edit
buffer: an original DX7, the DX7s, the DX7IID, the TX816, or Dexed. Browse a
voice library, tap a voice to send it, and edit it live with the controls.

**Open it:** <https://danieltowers.github.io/dx7-voice-app/>

- Use Chrome or Edge, on Android or a computer. Safari and every browser on an
  iPhone or iPad have no Web MIDI, so the app cannot send there.
- Tap **Load the starter voices** for a small library of voices made by the
  DX7 build agent, or open a library file of your own.
- **Help** in the app has the setup for each instrument. The
  [hardware page](https://danieltowers.github.io/dx7-voice-app/hardware.html)
  sends one fixed voice, to check the connection.

Install it from the browser's menu (Add to home screen, or Install app) and it
works offline. Edits live only in the instrument's edit buffer: nothing stored
on an instrument is changed.

This repository holds the published app only; it is built and published from
the `dx7-sound-builder-agent` project.

MIT licence: see [LICENSE](LICENSE).
