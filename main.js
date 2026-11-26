'use strict';
/**
 * Kuvert Desktop – schlanke Hülle um die Kuvert-Weboberfläche.
 *
 * - lädt die eingestellte Kuvert-Adresse in einem eigenen Fenster (neue Funktionen kommen
 *   wie im Browser direkt vom Server, die Hülle muss dafür nicht neu gebaut werden)
 * - öffnet fremde Links über das Betriebssystem im Standardbrowser; Chromium-Browser
 *   (Vivaldi, Chrome, Edge …) nehmen dafür das zuletzt aktive Profil
 * - Symbol im Infobereich (Tray) mit Hinweis auf neue Nachrichten, läuft beim Schließen weiter
 * - kann als Programm für mailto:-Links dienen
 */
const { app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain, session, dialog, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ASSETS = path.join(__dirname, 'assets');
const ICON = path.join(ASSETS, 'icon.png');
const PRELOAD = path.join(__dirname, 'preload.js');
const SETUP_PAGE = path.join(__dirname, 'setup.html');
/** Schemata, die an das Betriebssystem weitergereicht werden (alles andere wird ignoriert) */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/* ───────────── Einstellungen ───────────── */

const configFile = () => path.join(app.getPath('userData'), 'kuvert-desktop.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

let config = {};

function saveConfig(patch) {
  config = { ...config, ...patch };
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Einstellungen konnten nicht gespeichert werden:', err);
  }
}

/** Eingabe → Ursprung der Kuvert-Instanz (https://mail.example.de), null bei Unsinn */
function normalizeServer(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** --server=https://… auf der Kommandozeile geht der gespeicherten Adresse vor */
function serverFromArgs(argv) {
  const arg = argv.find((a) => a.startsWith('--server='));
  return arg ? normalizeServer(arg.slice('--server='.length)) : null;
}

let serverOverride = null;
const server = () => serverOverride ?? config.server ?? null;

function isOwn(url) {
  const s = server();
  if (!s) return false;
  try {
    return new URL(url).origin === s;
  } catch {
    return false;
  }
}

const isSetupPage = (url) => typeof url === 'string' && url.startsWith('file:') && url.split(/[?#]/)[0].endsWith('/setup.html');

function openExternal(url) {
  try {
    if (EXTERNAL_SCHEMES.has(new URL(url).protocol)) void shell.openExternal(url);
  } catch {
    /* keine gültige Adresse */
  }
}

/* ───────────── mailto: ───────────── */

const mailtoArg = (argv) => argv.find((a) => /^mailto:/i.test(a)) ?? null;
/** mailto:-Link aus dem Start (macOS: open-url vor „ready") */
let launchMailto = null;

/** Neue Nachricht im laufenden Kuvert öffnen – oder Kuvert damit laden */
function openMailto(raw) {
  if (!win) {
    launchMailto = raw;
    return;
  }
  showWindow();
  if (isOwn(win.webContents.getURL()) && !win.webContents.isLoading()) win.webContents.send('kuvert:mailto', raw);
  else if (server()) loadApp(raw);
}

function isDefaultMailClient() {
  // Windows verrät die Wahl des Nutzers nicht zuverlässig – dort führt der Eintrag immer zu den Einstellungen
  if (process.platform === 'win32') return false;
  try {
    return app.isDefaultProtocolClient('mailto');
  } catch {
    return false;
  }
}

function setDefaultMailClient() {
  if (process.platform === 'win32') {
    // Programme dürfen das unter Windows nicht selbst setzen. Der Installer meldet Kuvert als
    // E-Mail-Programm an (assets/installer.nsh), die Wahl trifft der Nutzer in den Einstellungen.
    void shell.openExternal('ms-settings:defaultapps?registeredAppUser=Kuvert');
    return true;
  }
  let ok = false;
  try {
    ok = app.setAsDefaultProtocolClient('mailto');
  } catch {
    ok = false;
  }
  if (!ok) {
    void dialog.showMessageBox({
      type: 'warning',
      title: 'Kuvert',
      message: 'Kuvert konnte nicht als E-Mail-Programm festgelegt werden.',
      detail:
        process.platform === 'linux'
          ? 'Das klappt mit dem .deb-Paket bzw. einer ins System eingebundenen AppImage. Alternativ in den Systemeinstellungen unter „Standardanwendungen" Kuvert für E-Mail wählen.'
          : 'Bitte in den Systemeinstellungen Kuvert als Standard-App für E-Mail wählen.',
    });
  }
  updateTrayMenu();
  return ok;
}

/* ───────────── Autostart ───────────── */

const autostartFile = () => path.join(os.homedir(), '.config', 'autostart', 'kuvert.desktop');

function autostartEnabled() {
  if (process.platform === 'linux') return fs.existsSync(autostartFile());
  return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
}

function setAutostart(on) {
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
    return;
  }
  try {
    if (!on) {
      fs.rmSync(autostartFile(), { force: true });
      return;
    }
    // AppImage: der Pfad der .AppImage-Datei, nicht der des entpackten Programms
    const exe = process.env.APPIMAGE || process.execPath;
    fs.mkdirSync(path.dirname(autostartFile()), { recursive: true });
    fs.writeFileSync(
      autostartFile(),
      ['[Desktop Entry]', 'Type=Application', 'Name=Kuvert', `Exec="${exe.replace(/(["`$\\])/g, '\\$1')}" --hidden`, 'Icon=kuvert', 'X-GNOME-Autostart-enabled=true', ''].join('\n'),
    );
  } catch (err) {
    void dialog.showMessageBox({ type: 'error', title: 'Kuvert', message: 'Autostart konnte nicht geändert werden.', detail: String(err) });
  }
}

/* ───────────── Fenster ───────────── */

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;
let unread = 0;
/** Gespeichert maximiert: erst beim ersten Anzeigen maximieren (maximize() würde ein verstecktes Fenster zeigen) */
let pendingMaximize = false;

const webPreferences = () => ({
  preload: PRELOAD,
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: true,
  // backgroundThrottling bleibt an: Ohne Drosselung meldet Electron die Seite immer als sichtbar
  // (Page Visibility API) – Kuvert würde dann bei verstecktem Fenster weder neue Mails im Titel
  // zählen (roter Punkt im Infobereich) noch Desktop-Benachrichtigungen zeigen. Die Live-Verbindung
  // (Server-Sent Events) läuft auch gedrosselt weiter.
  additionalArguments: [`--kuvert-desktop-version=${app.getVersion()}`],
});

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (pendingMaximize) {
    pendingMaximize = false;
    win.maximize();
  }
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

let boundsTimer = null;
function rememberBounds() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    saveConfig({ bounds: { ...(maximized ? (config.bounds ?? {}) : win.getNormalBounds()), maximized } });
  }, 500);
}

function loadApp(mailto) {
  const s = server();
  if (!s) return showSetup();
  const url = new URL(mailto ? '/mail' : '/', s);
  if (mailto) url.searchParams.set('mailto', mailto);
  void win.loadURL(url.href);
}

function showSetup(error) {
  void win.loadFile(SETUP_PAGE, { query: { server: server() ?? '', error: error ?? '' } });
  showWindow();
}

function createWindow({ hidden }) {
  const b = config.bounds ?? {};
  win = new BrowserWindow({
    width: b.width ?? 1280,
    height: b.height ?? 820,
    x: b.x,
    y: b.y,
    minWidth: 480,
    minHeight: 400,
    show: false,
    title: 'Kuvert',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: '#f4f5f7',
    webPreferences: webPreferences(),
  });
  pendingMaximize = !!b.maximized;

  win.once('ready-to-show', () => {
    if (!hidden || !server()) showWindow();
  });
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  win.on('close', (e) => {
    if (!quitting && tray && config.closeToTray !== false) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });

  // Kuvert zählt neue Mails bei verborgenem Fenster im Titel: „(3) Kuvert"
  win.webContents.on('page-title-updated', (_e, title) => {
    const m = /^\((\d+)\)/.exec(title);
    setUnread(m ? Number(m[1]) : 0);
  });

  win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    // -3 = abgebrochen (z. B. Download oder neue Navigation) – kein Fehler
    if (!isMainFrame || code === -3 || !isOwn(url)) return;
    showSetup(`Kuvert unter ${server()} ist nicht erreichbar (${description}).`);
  });

  if (launchMailto) {
    const raw = launchMailto;
    launchMailto = null;
    loadApp(raw);
  } else loadApp();
}

/* ───────────── Tray ───────────── */

/** macOS-Menüleiste: 18 pt hoch; sonst 32 px (Windows/Linux skalieren selbst). @2x liegt jeweils daneben. */
const trayImage = (withDot) =>
  nativeImage.createFromPath(path.join(ASSETS, `tray${process.platform === 'darwin' ? '-mac' : ''}${withDot ? '-unread' : ''}.png`));

function setUnread(n) {
  if (n === unread) return;
  unread = n;
  try {
    app.setBadgeCount(n);
  } catch {
    /* nicht überall unterstützt */
  }
  if (!tray) return;
  tray.setImage(trayImage(n > 0));
  tray.setToolTip(n > 0 ? `Kuvert – ${n} neue ${n === 1 ? 'Nachricht' : 'Nachrichten'}` : 'Kuvert');
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const isDefault = isDefaultMailClient();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: unread > 0 ? `Kuvert öffnen (${unread} neu)` : 'Kuvert öffnen', click: showWindow },
      { label: 'Neue E-Mail', enabled: !!server(), click: () => openMailto('mailto:') },
      { type: 'separator' },
      {
        label: 'Beim Anmelden starten',
        type: 'checkbox',
        checked: autostartEnabled(),
        click: (item) => {
          setAutostart(item.checked);
          updateTrayMenu();
        },
      },
      {
        label: 'Beim Schließen im Infobereich bleiben',
        type: 'checkbox',
        checked: config.closeToTray !== false,
        click: (item) => saveConfig({ closeToTray: item.checked }),
      },
      {
        label: isDefault ? 'Ist E-Mail-Programm des Systems' : 'Als E-Mail-Programm festlegen',
        enabled: !isDefault && app.isPackaged,
        click: setDefaultMailClient,
      },
      {
        label: 'Server-Adresse ändern …',
        click: () => {
          if (win) showSetup();
        },
      },
      { type: 'separator' },
      { label: 'Beenden', click: quit },
    ]),
  );
}

function createTray() {
  tray = new Tray(trayImage(false));
  tray.setToolTip('Kuvert');
  // Windows: Klick zeigt/versteckt das Fenster, Rechtsklick das Menü. macOS zeigt bei Klick das Menü;
  // unter Linux (AppIndicator) kommt kein Klick an – dort gibt es „Kuvert öffnen" im Menü.
  if (process.platform === 'win32') tray.on('click', toggleWindow);
  updateTrayMenu();
}

function quit() {
  quitting = true;
  app.quit();
}

/* ───────────── Menü (Tastenkürzel) ───────────── */

function createAppMenu() {
  const sep = { type: 'separator' };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Kuvert',
        submenu: [
          { label: 'Neue E-Mail', enabled: true, click: () => openMailto('mailto:') },
          { label: 'Server-Adresse ändern …', click: () => win && showSetup() },
          sep,
          { label: 'Fenster schließen', accelerator: 'CmdOrCtrl+W', click: (_i, w) => w?.close() },
          { label: 'Beenden', accelerator: 'CmdOrCtrl+Q', click: quit },
        ],
      },
      {
        label: 'Bearbeiten',
        submenu: [
          { role: 'undo', label: 'Rückgängig' },
          { role: 'redo', label: 'Wiederholen' },
          sep,
          { role: 'cut', label: 'Ausschneiden' },
          { role: 'copy', label: 'Kopieren' },
          { role: 'paste', label: 'Einfügen' },
          { role: 'pasteAndMatchStyle', label: 'Als Text einfügen' },
          { role: 'selectAll', label: 'Alles auswählen' },
        ],
      },
      {
        label: 'Ansicht',
        submenu: [
          { role: 'reload', label: 'Neu laden' },
          { role: 'forceReload', label: 'Neu laden (ohne Cache)' },
          { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' },
          sep,
          { role: 'resetZoom', label: 'Originalgröße' },
          { role: 'zoomIn', label: 'Vergrößern' },
          { role: 'zoomOut', label: 'Verkleinern' },
          sep,
          { role: 'togglefullscreen', label: 'Vollbild' },
        ],
      },
    ]),
  );
}

/* ───────────── Links, Popups, Kontextmenü ───────────── */

function contextMenu(contents, p) {
  const items = [];
  const sep = { type: 'separator' };
  if (p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 6)) items.push({ label: s, click: () => contents.replaceMisspelling(s) });
    if (!p.dictionarySuggestions.length) items.push({ label: 'Keine Vorschläge', enabled: false });
    items.push({ label: 'Zum Wörterbuch hinzufügen', click: () => contents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, sep);
  }
  if (p.linkURL && !/^javascript:/i.test(p.linkURL)) {
    if (/^https?:/i.test(p.linkURL) && !isOwn(p.linkURL)) items.push({ label: 'Link im Browser öffnen', click: () => openExternal(p.linkURL) });
    const mail = /^mailto:([^?]*)/i.exec(p.linkURL);
    items.push(
      mail
        ? { label: 'E-Mail-Adresse kopieren', click: () => clipboard.writeText(decodeURIComponent(mail[1])) }
        : { label: 'Link-Adresse kopieren', click: () => clipboard.writeText(p.linkURL) },
      sep,
    );
  }
  if (p.isEditable) {
    items.push(
      { role: 'undo', label: 'Rückgängig', enabled: p.editFlags.canUndo },
      { role: 'redo', label: 'Wiederholen', enabled: p.editFlags.canRedo },
      sep,
      { role: 'cut', label: 'Ausschneiden', enabled: p.editFlags.canCut },
      { role: 'copy', label: 'Kopieren', enabled: p.editFlags.canCopy },
      { role: 'paste', label: 'Einfügen', enabled: p.editFlags.canPaste },
      { role: 'pasteAndMatchStyle', label: 'Als Text einfügen', enabled: p.editFlags.canPaste },
      { role: 'selectAll', label: 'Alles auswählen', enabled: p.editFlags.canSelectAll },
    );
  } else if (p.selectionText && p.selectionText.trim()) {
    items.push({ role: 'copy', label: 'Kopieren' });
  }
  if (p.mediaType === 'image' && p.srcURL) items.push(sep, { label: 'Bild kopieren', click: () => contents.copyImageAt(p.x, p.y) });

  // Trenner am Anfang/Ende und doppelte entfernen
  const clean = items.filter((it, i, all) => it !== sep || (i > 0 && i < all.length - 1 && all[i + 1] !== sep));
  if (!clean.length) return;
  Menu.buildFromTemplate(clean).popup({ window: BrowserWindow.fromWebContents(contents) ?? undefined });
}

app.on('web-contents-created', (_e, contents) => {
  // window.open / target=_blank: Kuvert-eigene Seiten (Verfassen, Nachricht, Drucken) als App-Fenster,
  // alles andere im Standardbrowser des Systems
  contents.setWindowOpenHandler(({ url }) => {
    if (url === '' || url === 'about:blank' || isOwn(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true, backgroundColor: '#f4f5f7', webPreferences: webPreferences() },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  // Navigation im Fenster: Links von Kuvert nach draußen gehen in den Browser. Ist das Fenster schon
  // draußen (Anmeldung bei Microsoft/Google für ein Konto), darf es sich dort frei bewegen.
  contents.on('will-navigate', (e) => {
    const url = e.url;
    if (isOwn(url)) return;
    if (url.startsWith('file:')) {
      e.preventDefault();
      return;
    }
    const current = contents.getURL();
    if (isOwn(current) || isSetupPage(current)) {
      e.preventDefault();
      openExternal(url);
    }
  });

  contents.on('context-menu', (_ev, params) => contextMenu(contents, params));
});

/* ───────────── Schnittstelle zur Seite (preload.js) ───────────── */

const fromOwn = (e) => isOwn(e.senderFrame?.url ?? '');
const fromSetup = (e) => isSetupPage(e.senderFrame?.url ?? '');

ipcMain.on('kuvert:show', (e) => {
  if (!fromOwn(e)) return;
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w === win) showWindow();
  else if (w) {
    w.show();
    w.focus();
  }
});

ipcMain.handle('kuvert:mail-default:get', (e) => fromOwn(e) && isDefaultMailClient());
ipcMain.handle('kuvert:mail-default:set', (e) => fromOwn(e) && app.isPackaged && setDefaultMailClient());

ipcMain.handle('setup:save', (e, input) => {
  if (!fromSetup(e)) return { ok: false, error: 'Nicht erlaubt' };
  const s = normalizeServer(input);
  if (!s) return { ok: false, error: 'Bitte eine gültige Adresse angeben, z. B. https://mail.example.de' };
  serverOverride = null;
  saveConfig({ server: s });
  updateTrayMenu();
  loadApp();
  return { ok: true };
});

/* ───────────── Start ───────────── */

// Google & Co. lehnen Anmeldungen in eingebetteten Browsern teils ab – Electron-Kennung weglassen
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|kuvert-desktop|Kuvert)\/\S+/gi, '');

if (!app.requestSingleInstanceLock()) {
  // Kuvert läuft schon: Die erste Instanz übernimmt (second-instance) – inklusive mailto:-Link
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const raw = mailtoArg(argv);
    if (raw) openMailto(raw);
    else showWindow();
  });

  // macOS liefert mailto:-Links über open-url
  app.on('open-url', (e, url) => {
    e.preventDefault();
    if (/^mailto:/i.test(url)) openMailto(url);
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('activate', () => showWindow());

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Windows: ohne AppUserModelId zeigt das System keine Benachrichtigungen an
  if (process.platform === 'win32') app.setAppUserModelId('de.kuvert.desktop');

  void app.whenReady().then(() => {
    config = loadConfig();
    serverOverride = serverFromArgs(process.argv);
    launchMailto = launchMailto ?? mailtoArg(process.argv);

    try {
      session.defaultSession.setSpellCheckerLanguages(['de-DE', 'en-US']);
    } catch {
      /* macOS: Rechtschreibprüfung des Systems */
    }
    // Berechtigungen nur für die eigene Kuvert-Instanz
    const allowed = new Set(['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'media']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
      cb(allowed.has(permission) && isOwn(details.requestingUrl ?? ''));
    });

    createAppMenu();
    createTray();
    // Autostart: Linux/Windows übergeben --hidden, macOS meldet den Start bei der Anmeldung selbst
    const atLogin = process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
    createWindow({ hidden: atLogin && !launchMailto });
  });
}
