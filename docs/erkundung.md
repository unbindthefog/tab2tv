# Erkundung – Stand 2026-10-05

Testumgebung: MacBook (M5, macOS 26.3.1), Brave 1.96.60 / Chromium 154, TV „Wohnzimmer“ per AirPlay als separater Bildschirm (UI 1920×1080, 4K), „Monitore verwenden verschiedene Spaces“ = an (Standard).
Methode: isolierte Brave-Instanz (eigenes Profil, `--load-extension`, `--remote-debugging-port`), Steuerung per CDP. Plus drei Recherche-Agenten (Doku/Chromium-Quellcode).

## Empirische Ergebnisse (selbst gemessen)

| # | Test | Ergebnis |
|---|------|----------|
| 1 | YouTube-`<video>` in normales `window.open('about:blank')`-Popup verschieben | ❌ Element wird zurückgesetzt (`readyState` 0, `currentTime` 0, MSE abgehängt). Erholt sich auch beim Zurückschieben nicht. |
| 2 | Dasselbe in **Document-PiP**-Fenster | ✅ Läuft ohne Unterbrechung weiter (Chromium: `ShouldReusePlayer()` nur für DocPiP ↔ Opener). |
| 3 | DocPiP-Größe per `requestWindow({1920×1080})` | Auf 812×456 begrenzt (Chromium: max. 25 % der Displayfläche bei Seitenanfrage). |
| 4 | `chrome.windows.update` auf DocPiP-Fenster | DocPiP ist für `chrome.windows` sichtbar (Typ „normal“). **Verschieben geht nur ohne `width/height`** (sonst wird das ganze Update verworfen). |
| 5 | `chrome.windows.update({state:'fullscreen'})` auf dem TV | ✅ Fenster 1920×1080 auf dem TV, Video läuft weiter, < 1 s. Innenhöhe 1046 px → evtl. 34 px PiP-Titelleiste (**Sichtprüfung offen**). |
| 6 | Fokus zurück ans Hauptfenster | ✅ PiP bleibt im Vollbild auf dem TV. |
| 7 | YouTube-Bedienung (Pause/Play/Spulen/Tempo) | ✅ Wirkt direkt auf das TV-Bild. Player-Fläche auf der Seite behält Größe (kein Layout-Sprung). |
| 8 | Nächstes Video per Klick (SPA) | ✅ Gleiches `<video>`-Element, PiP bleibt offen, TV folgt automatisch. |
| 9 | Qualität | ⚠️ YouTube wählt nach Seiten-Playergröße → 480p auf dem TV. `setPlaybackQualityRange('hd2160')` → 3840×2160 ✅. Braucht YouTube-Adapter. |
| 10 | `captureStream()` auf YouTube (MSE) | ✅ Audio+Video live, ~30 fps Spiegelbild → Paralleldarstellung machbar (Spiegel in der Seite, Original im TV). |
| 11 | `requestWindow()` ohne Nutzergeste | ❌ `NotAllowedError` – **Hauptrisiko für die Automatik.** |
| 12 | Trusted Types auf YouTube | Gilt auch im Popup/PiP: kein `innerHTML`/`document.write`, nur DOM-APIs. |
| 13 | `chrome.system.display` | Liefert Displays inkl. TV (id `135`), aber **`name` ist leer** unter macOS. |
| 14 | `screen.*` in der Seite | Brave fälscht Werte (1280×800) → Bildschirmerkennung nur über die Erweiterung. |

## Recherche (Doku/Quellcode, gekürzt)

- DocPiP: `moveTo` ist No-op, `requestFullscreen` innerhalb verboten, nur ein PiP pro Tab, schließt automatisch bei Navigation des Openers (→ „Tab schließen = TV leer“ gratis). Nur im Top-Level-Frame.
- DocPiP → `chrome.windows`-Typ „normal“ ist laut Chromium-TODO (crbug 438514981) „almost certainly wrong“ → **Abhängigkeitsrisiko**, falls Chromium das ändert.
- `window.open(..., 'fullscreen')` nicht ausgeliefert; `Node.moveBefore()` nicht dokumentübergreifend.
- `captureStream()` wirft bei EME/DRM synchron eine Exception (erkennbar), bei Cross-Origin-Medien `SecurityError`.
- Widevine ist in Brave standardmäßig aus (Opt-in-Prompt). DRM in DocPiP: unbekannt.
- YouTube-Untertitel sind DOM-Overlays, keine TextTracks → DOM-Spiegelung per MutationObserver ins PiP.
- `chrome.commands`: global nur Ctrl+Shift+[0-9]; ob ein Command Nutzeraktivierung für die Seite liefert: unbestätigt.
- Vorbild: [pip-twin](https://github.com/timoncool/pip-twin) (Popup + `captureStream`, re-parenting).

## Richtungswechsel nach Sichtprüfung: Document PiP → Popup + captureStream

Sichtprüfung am TV: Das „Vollbild“-DocPiP ist **kein echtes macOS-Vollbild**. Das PiP-Panel wird nur auf Displaygröße gezogen; macOS-Menüleiste und PiP-Titelleiste (Herkunft, von Chromium absichtlich nicht abschaltbar) bleiben sichtbar. Prinzipbedingt, nicht reparierbar.

Stattdessen (Idee C als Hauptweg):
- Seite öffnet `window.open('', name, 'popup')` (gleiche Herkunft, skriptbar), Erweiterung verschiebt es per `chrome.windows.update` auf den TV und setzt `state:'fullscreen'` → **echter macOS-Vollbild-Space**, Menüleiste weg.
- Bild per `original.captureStream()` → `popupVideo.srcObject`. Original bleibt in der Seite → Player-Steuerung, SPA-Wechsel, Zurückholen trivial; Paralleldarstellung gratis.
- Rest-Leiste oben war Braves Einstellung „Symbolleiste im Vollbildmodus immer anzeigen“ (`browser.show_fullscreen_toolbar`). Aus → Innenfläche 1920×1080, randlos (vom Nutzer bestätigt). Erkennbar über `popup.innerHeight < display.bounds.height`.
- Lippensynchronität (Ton vom Original, Bild über Capture/AirPlay): vom Nutzer als passend bestätigt.
- DocPiP bleibt nur Kandidat für DRM-Inhalte (mit sichtbarer Leiste); dort ggf. `pagehide` abfangen und Element zurückholen (Schließen mit Video darin setzt das Element zurück).

## Prototyp (`extension/`) – Ergebnisse in der Testinstanz

| Test | Ergebnis |
|------|----------|
| Automatik bei Klick auf Play (YouTube) | ✅ Platzierung ~150–250 ms + Vollbild-Animation; Platzhalter passgenau, kein Layout-Sprung, Button klickbar |
| Qualität | ✅ via MAIN-World-Adapter `setPlaybackQualityRange` (bis 2160p) |
| YouTube-Untertitel | ✅ DOM-Spiegelung per MutationObserver + kopierte Caption-CSS, synchron, auf TV-Größe skaliert |
| Nächstes Video (SPA) | ✅ Neu-Capture bei `loadeddata`, TV folgt mit ~30 fps |
| Tab im Hintergrund (20 s) | ✅ TV weiter 30 fps, keine Drosselung |
| Zurückholen-Button | ✅ nahtlos, Popup weg, Seite wie vorher |
| Seite verlassen / Tab schließen | ✅ `pagehide` + `tabs.onRemoved` schließen das Popup |
| Paralleldarstellung | ✅ Video bleibt im Player, TV stummes Spiegelbild, Ton nur aus einer Quelle |
| Auslösen ohne Nutzeraktivierung (Symbol/Shortcut simuliert) | ⚠️ Brave öffnet dann `window.open(...,'popup')` als **normalen Tab** (`chrome://newtab`). Jetzt: Prüfung `navigator.userActivation.isActive`, sonst Hinweis mit Button |
| Mehrere Tabs (A auf TV, B auf TV, zurück zu A) | ⚠️→✅ Jedes Vollbild-Popup hat einen eigenen macOS-Space; der TV blieb auf B stehen. Fix: bei `tabs.onActivated` und bei Play in einem Tab mit Sitzung dessen Popup kurz fokussieren (macOS wechselt den TV-Space), dann Fokus zurück. Prüfbar über `document.visibilityState` der Popups. |
| Testinstanz nach Codeänderung | ⚠️ Brave nutzt über Neustarts das alte Service-Worker-Skript → `tools/reload-ext.mjs` (CDP `Extensions.loadUnpacked`) |
| Zielbildschirm-Auswahl | ✅ Abgleich ID → Name → Auflösung (extern); geänderte ID wird nachgeführt; nicht verbundener Zielbildschirm → inaktiv, kein Ausweichen. `getScreenDetails()`-Namen nur nach Berechtigungsdialog (CDP-Grant greift für Erweiterungsseiten nicht) |
| Zielbildschirm getrennt (simuliert) | ✅ Sitzungen merken ihre `displayId`; fehlt sie bei `onDisplayChanged` → Video pausiert zurück, Popup zu (macOS-Animation ~2–3 s). Real getestet (2026-10-05): Video pausiert zurück, keine Fensterreste ✅ |
| Display-ID nach AirPlay-Neuverbindung | ⚠️ ändert sich (135 → 136) – bestätigt. Wiedererkennung über Auflösung greift, ID wird nachgeführt ✅ |
| Brave-Neustart mit Sitzungswiederherstellung | ⚠️ Alte TV-Popups kommen als leere Fenster zurück (Kontrolle ohne Erweiterung bestätigt). Fix: Popup-URL `about:blank#tab2tv`, Popup-Tabs mit dieser URL **ohne Opener** werden bei Start/Worker-Start/Tab-Erzeugung geschlossen (Berechtigung `tabs`). Logik geprüft; Auslöser in der Testinstanz nicht prüfbar (`--load-extension` lädt erst nach der Wiederherstellung) → Test im echten Brave |
| Testumgebung | `--use-mock-keychain` gegen Schlüsselbund-Abfragen nach Brave-Updates; Brave-Updates im laufenden Betrieb können den Start der Testinstanz an einem modalen Dialog blockieren |

## Offene Punkte

1. **Echter Tastendruck ⌥⇧T / Klick aufs Symbol:** Liefert das der Seite Aktivierung? (Nur mit echter Eingabe testbar.) Falls nein: Hinweis-Button bleibt der Weg.
3. Langzeit > 5 min mit Tab im Hintergrund.
4. DRM (Widevine in Brave erst aktivieren) → erwartete Meldung; evtl. DocPiP-Fallback.
5. Eingebettete Player in Cross-Origin-iframes (Content-Script im iframe, Popup aus iframe-Herkunft?).
6. Fehlauslösung auf 10 Nachrichten-/Shopping-Seiten.
7. Aufräumen restaurierter Popups nach Brave-Neustart im echten Brave bestätigen.
