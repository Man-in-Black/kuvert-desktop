# Kuvert Desktop

Desktop-App für [Kuvert](https://github.com/Man-in-Black/kuvert) – eine schlanke Hülle (Electron) um die
Kuvert-Weboberfläche für **Linux, Windows und macOS**.

- **Eigenes Fenster** mit Kuvert-Symbol, Fenstergröße wird gemerkt
- **Symbol im Infobereich** (Tray): roter Punkt und Zähler bei Neuem (Mails, Chats, Termine), Menü mit „Neue E-Mail",
  Autostart, Server-Adresse; beim Schließen läuft Kuvert im Hintergrund weiter
- **Links im Standardbrowser:** Links auf andere Seiten gehen über das Betriebssystem an den Standardbrowser.
  Chromium-Browser (Vivaldi, Chrome, Edge, Brave …) öffnen sie im **zuletzt aktiven Profil** – anders als
  eine installierte PWA, die Links immer in ihrem eigenen Profil öffnet. Firefox nimmt sein Standardprofil.
- **mailto:-Links** aus anderen Programmen öffnen eine neue Nachricht in Kuvert
- **Benachrichtigungen des Systems** für neue Mails, Chats und Termine, solange die App läuft – ein Klick öffnet die passende Stelle in Kuvert
- Rechtschreibprüfung (Deutsch/Englisch) und Kontextmenü mit Kopieren/Einfügen
- **Anrufe im Team-Chat** mit Mikrofon, Kamera und **Bildschirmfreigabe** (Auswahl von Bildschirm oder Fenster;
  macOS ab 15 und Linux mit Wayland zeigen die Auswahl des Systems)

Die App lädt die Oberfläche direkt von deinem Kuvert-Server. **Neue Kuvert-Funktionen brauchen kein
App-Update** – sie sind nach dem nächsten Neuladen da. Aktualisieren muss man die App nur für neue
Electron-Versionen (Sicherheitsupdates) oder Änderungen an der Hülle selbst.

## Installation

Pakete gibt es unter [Releases](https://github.com/Man-in-Black/kuvert-desktop/releases/latest).
Beim ersten Start fragt die App nach der Adresse deines Kuvert-Servers (z. B. `https://mail.example.de`).

| System | Datei | Hinweis |
| --- | --- | --- |
| Debian/Ubuntu | `Kuvert-….deb` (x64 / arm64) | `sudo apt install ./Kuvert-….deb` |
| Linux allgemein | `Kuvert-….AppImage` (x64 / arm64) | ausführbar machen und starten |
| Windows | `Kuvert-Setup-…-x64.exe` / `-arm64.exe` | nicht signiert: SmartScreen → *Weitere Informationen → Trotzdem ausführen* |
| macOS | `Kuvert-…-arm64.dmg` (Apple Silicon) / `-x64.dmg` (Intel) | nicht notarisiert, siehe unten |

**macOS:** Die App ist nur ad-hoc signiert. Nach dem Kopieren nach *Programme* einmalig im Terminal
freigeben und dann normal starten:

```bash
xattr -dr com.apple.quarantine /Applications/Kuvert.app
```

Für die **Bildschirmfreigabe** fragt macOS beim ersten Mal nach der Berechtigung *Bildschirm- und
Systemaudioaufnahme*. Nach dem Erlauben Kuvert einmal beenden und neu starten.

**Symbol im Infobereich unter GNOME:** GNOME zeigt Tray-Symbole nur mit der Erweiterung
„AppIndicator and KStatusNotifierItem Support" (bei Ubuntu vorinstalliert). Ohne sie bringt ein erneuter
Start von Kuvert das Fenster zurück; „Beim Schließen im Infobereich bleiben" lässt sich im Menü abschalten.

**Als E-Mail-Programm festlegen:** im Tray-Menü oder in Kuvert unter *Einstellungen → Allgemein*. Unter
Windows öffnet das die Systemeinstellungen; dort Kuvert für „E-Mail"/`MAILTO` wählen.

**Server-Adresse fest vorgeben** (z. B. für Verteilung im Unternehmen): `kuvert --server=https://mail.example.de`

## Bekannte Einschränkungen

- **Web Push** gibt es in der App nicht (Electron kann sich bei den Push-Diensten der Browser nicht
  anmelden). Benachrichtigungen kommen, solange die App läuft – auch minimiert im Infobereich.
- **Google-Konten** verbinden: Google lehnt Anmeldungen in eingebetteten Browsern teils ab. Dann das
  Konto einmal im normalen Browser in Kuvert verbinden; danach funktioniert es auch in der App.
- Pakete sind nicht mit einem Hersteller-Zertifikat signiert.

## Entwicklung

```bash
npm install
npm start -- --server=https://mail.example.de
```

Pakete bauen: `npm run dist:linux`, `npm run dist:win`, `npm run dist:mac` (macOS-Pakete nur auf einem Mac).
Die GitHub-Actions bauen alle drei Systeme bei jedem Push; ein Tag `vX.Y.Z` erzeugt zusätzlich das Release
„Kuvert Desktop X.Y.Z" mit allen Paketen.

| Datei | Inhalt |
| --- | --- |
| `main.js` | Fenster, Tray, Link-Weiterleitung, mailto:, Autostart, Kontextmenü |
| `preload.js` | Schnittstelle `window.kuvertDesktop` für die Kuvert-Oberfläche |
| `setup.html` | Eingabe der Server-Adresse (erster Start, nicht erreichbar, „Server-Adresse ändern") |
| `assets/installer.nsh` | Windows-Installer: Anmeldung als E-Mail-Programm |

Die Oberfläche erkennt die App an `window.kuvertDesktop` (Gegenstück in Kuvert: `web/src/lib/desktop.ts`)
und schaltet dann Service Worker/Web Push ab, leitet mailto:-Links und Benachrichtigungsklicks an die App
weiter. Neue Funktionen der Schnittstelle immer optional halten – ältere App-Versionen laden stets die
aktuelle Oberfläche.
