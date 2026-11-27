'use strict';
/**
 * Brücke zwischen Kuvert-Weboberfläche und Desktop-App. Die Seite erkennt die App an
 * window.kuvertDesktop (web/src/lib/desktop.ts). main.js prüft bei jedem Aufruf, ob er
 * von der eingestellten Kuvert-Adresse bzw. der Einrichtungsseite kommt.
 */
const { contextBridge, ipcRenderer } = require('electron');

const versionArg = process.argv.find((a) => a.startsWith('--kuvert-desktop-version='));

// mailto:-Links und Klicks auf Benachrichtigungen, die ankommen, bevor Kuvert sich angemeldet hat, puffern
function channel(name) {
  const queue = [];
  let handler = null;
  ipcRenderer.on(name, (_e, value) => {
    if (handler) handler(String(value));
    else queue.push(String(value));
  });
  return (cb) => {
    if (typeof cb !== 'function') return;
    handler = (value) => {
      try {
        cb(value);
      } catch {
        /* Fehler der Seite nicht in die Brücke tragen */
      }
    };
    while (queue.length) handler(queue.shift());
  };
}
const onMailto = channel('kuvert:mailto');
const onNavigate = channel('kuvert:navigate');

contextBridge.exposeInMainWorld('kuvertDesktop', {
  version: versionArg ? versionArg.split('=')[1] : '',
  platform: process.platform,
  /** Fenster nach vorn holen (z. B. Klick auf eine Benachrichtigung) */
  show: () => ipcRenderer.send('kuvert:show'),
  /** Neue Nachricht aus einem mailto:-Link (Systemaufruf oder „Neue E-Mail" im Infobereich) */
  onMailto,
  /** Native Systembenachrichtigung: { title, body, tag, url, requireInteraction } */
  notify: (n) => {
    if (!n || typeof n !== 'object') return;
    ipcRenderer.send('kuvert:notify', {
      title: String(n.title ?? ''),
      body: n.body == null ? '' : String(n.body),
      tag: n.tag == null ? '' : String(n.tag),
      url: n.url == null ? '' : String(n.url),
      requireInteraction: !!n.requireInteraction,
    });
  },
  /** Pfad in Kuvert öffnen, nachdem eine Benachrichtigung angeklickt wurde */
  onNavigate,
  isDefaultMailClient: () => ipcRenderer.invoke('kuvert:mail-default:get'),
  setDefaultMailClient: () => ipcRenderer.invoke('kuvert:mail-default:set'),
});

if (location.protocol === 'file:' && location.pathname.endsWith('/setup.html')) {
  contextBridge.exposeInMainWorld('kuvertSetup', {
    save: (url) => ipcRenderer.invoke('setup:save', String(url)),
  });
}

// Auswahl für die Bildschirmfreigabe (picker.html)
if (location.protocol === 'file:' && location.pathname.endsWith('/picker.html')) {
  contextBridge.exposeInMainWorld('kuvertPicker', {
    sources: () => ipcRenderer.invoke('picker:sources'),
    choose: (id) => ipcRenderer.send('picker:choose', String(id ?? '')),
  });
}
