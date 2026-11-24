// Installing the shell: register the service worker (sw.js), which keeps
// every file of the app in a cache so the installed app opens and sends with
// no network. When a newer shell is published, the worker installs it in the
// background on the next open with the network on and takes over; the page
// then reloads once to run the new shell. The library (IndexedDB) and the
// settings and position (localStorage) are not touched: the page finds them
// again as it starts.

export function keepShell() {
  if (!("serviceWorker" in navigator)) return;
  // A worker already in control means any new one is an update; with none,
  // this is the first install and the page already runs the current shell.
  const updating = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!updating || reloading) return;
    reloading = true;
    window.location.reload();
  });
  navigator.serviceWorker.register("sw.js").catch((e) => {
    console.warn("The app cannot be kept for offline use:", e);
  });
}
