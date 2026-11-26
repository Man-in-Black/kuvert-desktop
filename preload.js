'use strict';
/**
 * Brücke zwischen Kuvert-Weboberfläche und Desktop-App. Die Seite erkennt die App an
 * window.kuvertDesktop (web/src/lib/desktop.ts). main.js prüft bei jedem Aufruf, ob er
 * von der eingestellten Kuvert-Adresse bzw. der Einrichtungsseite kommt.
 */
const { contextBridge, ipcRenderer } = require('electron');

const versionArg = process.argv.find((a) => a.startsWith('--kuvert-desktop-version='));

// mailto:-Links, die ankommen, bevor Kuvert sich angemeldet hat, puffern
const queue = [];
let handler = null;
ipcRenderer.on('kuvert:mailto', (_e, raw) => {
  if (handler) handler(String(raw));
  else queue.push(String(raw));
});

contextBridge.exposeInMainWorld('kuvertDesktop', {
  version: versionArg ? versionArg.split('=')[1] : '',
  platform: process.platform,
  /** Fenster nach vorn holen (z. B. Klick auf eine Benachrichtigung) */
  show: () => ipcRenderer.send('kuvert:show'),
  /** Neue Nachricht aus einem mailto:-Link (Systemaufruf oder „Neue E-Mail" im Infobereich) */
  onMailto: (cb) => {
    if (typeof cb !== 'function') return;
    handler = (raw) => {
      try {
        cb(raw);
      } catch {
        /* Fehler der Seite nicht in die Brücke tragen */
      }
    };
    while (queue.length) handler(queue.shift());
  },
  isDefaultMailClient: () => ipcRenderer.invoke('kuvert:mail-default:get'),
  setDefaultMailClient: () => ipcRenderer.invoke('kuvert:mail-default:set'),
});

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('kuvertSetup', {
    save: (url) => ipcRenderer.invoke('setup:save', String(url)),
  });
}
