'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The ported UI talks to its host exactly the way a VS Code webview does:
 * `acquireVsCodeApi()` for outgoing messages plus a `message` event for incoming ones.
 * Reproducing that shape here is what lets `media/main.ts` stay byte-identical to the
 * extension — every future re-port is a diff, not a rewrite.
 */
const state = { value: undefined };

contextBridge.exposeInMainWorld('acquireVsCodeApi', () => ({
  postMessage(message) {
    ipcRenderer.send('panel:message', message);
  },
  getState() {
    return state.value;
  },
  setState(next) {
    state.value = next;
    return next;
  }
}));

// Host → UI. `window.postMessage` keeps the renderer's own listener contract intact
// (`event.data` is the message), so the UI cannot tell the difference.
ipcRenderer.on('panel:message', (_event, message) => {
  window.postMessage(message, '*');
});
