'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// One synchronous, sender-validated bootstrap runs before any application script.
const initial = ipcRenderer.sendSync('muyu:bootstrap');
contextBridge.exposeInMainWorld('__MUYU_NATIVE__', {
  ...initial, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
});
contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: { muyu: { postMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (['settings', 'layout', 'menu', 'ready', 'status', 'error', 'desktopGesture', 'desktopSize', 'desktopScale'].includes(message.type)) {
      ipcRenderer.send('muyu:message', message);
    }
  } } },
});
