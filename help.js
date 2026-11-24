// The help page: the library page's explanations, kept off its controls, and
// the setup notes (setup-notes.js, the one copy of their wording).

import { showSetupNotes } from "./setup-notes.js";
import { keepShell } from "./shell.js";

showSetupNotes(document.getElementById("setup-notes"));
keepShell();
