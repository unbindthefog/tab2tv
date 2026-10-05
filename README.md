# TabToTV (Prototyp)

Brave-Erweiterung, die ein im Browser laufendes Video im Vollbild auf einem zweiten Bildschirm (z. B. TV per AirPlay) ausgibt. Die Webseite bleibt auf dem Hauptbildschirm normal bedienbar, der Player der Seite steuert das Bild auf dem TV.

## Installation in Brave

1. `brave://extensions` öffnen.
2. Oben rechts **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** → den Ordner `extension/` dieses Projekts wählen.
4. Optional: Erweiterungssymbol an die Symbolleiste anheften (Puzzle-Symbol → Pin).

Nach Änderungen am Code: auf der Erweiterungskarte auf ↻ klicken und offene Tabs neu laden.

## Nötige Einstellungen

**macOS**
- TV per AirPlay als **separaten Bildschirm** verbinden (Kontrollzentrum → Bildschirmsynchronisierung → TV wählen → „Als separaten Bildschirm verwenden“). Bei Synchronisierung (Mirroring) bleibt die Erweiterung inaktiv.
- Systemeinstellungen → Schreibtisch & Dock → **„Monitore verwenden verschiedene Spaces“ = an** (Standard). Sonst kann das Vollbild auf dem TV den Hauptbildschirm beeinträchtigen.

**Brave**
- Menü **Ansicht → „Symbolleiste im Vollbildmodus immer anzeigen“ ausschalten** (⇧⌘F). Sonst bleibt auf dem TV oben eine schmale Adressleiste sichtbar. Die Erweiterung erkennt das und zeigt einen Hinweis.

**Optional (macOS)**
- Systemeinstellungen → Bedienungshilfen → Anzeige → **„Bewegung reduzieren“**: Der Wechsel zwischen TV-Fenstern (Tabwechsel) wird dann überblendet statt geschoben und wirkt schneller.

## Bedienung

- **Automatik:** Startest du ein Video per Klick (z. B. auf YouTube), erscheint es nach ca. 1 s im Vollbild auf dem TV. Auf der Seite steht ein Platzhalter mit „Zurückholen“-Button.
- **Manuell:** Erweiterungssymbol klicken oder **⌥⇧T**. Fehlt dem Browser die nötige Nutzeraktion, erscheint unten rechts ein Hinweis mit Button „Auf TV abspielen“.
- **Mehrere Tabs:** Der TV zeigt das Video des Tabs, in dem zuletzt Play gedrückt bzw. zu dem gewechselt wurde. Das vorherige TV-Fenster bleibt 30 s im Hintergrund (Zurückwechseln geht sofort) und schließt sich dann; das Video kehrt in seine Seite zurück. Es gibt höchstens zwei TV-Fenster. Die Wartezeit ist in den Optionen einstellbar.
- **Zurückholen:** Button im Platzhalter, Erweiterungssymbol oder ⌥⇧T. Das Video läuft ohne Unterbrechung in der Seite weiter.
- **Einstellungen:** Rechtsklick auf das Symbol → Optionen (Zielbildschirm, Automatik, Websites, Schwellwerte, Paralleldarstellung, Verhalten bei Videoende).
- **Zielbildschirm:** Standard ist der erste zusätzliche Bildschirm. Ein ausdrücklich gewählter Bildschirm wird nach einer neuen AirPlay-Verbindung wiedererkannt (über Kennung, Name oder Auflösung). Ist er nicht verbunden, gibt die Erweiterung nichts aus. „Bildschirmnamen anzeigen“ fragt einmalig die Berechtigung zur Fensterverwaltung an, damit Namen wie „Wohnzimmer“ erscheinen.
- **TV getrennt:** Wird der Zielbildschirm getrennt (oder auf Synchronisierung umgestellt), kehrt das Video sofort pausiert in die Seite zurück.

## Bekannte Grenzen (Prototyp)

- Kopiergeschützte Videos (DRM, z. B. Streamingdienste) können nicht ausgegeben werden; die Erweiterung zeigt das an.
- Eingebettete Player (iframes, z. B. YouTube-Embeds auf fremden Seiten) werden unterstützt, sofern das Video im iframe per `captureStream()` abgreifbar ist. Videos von fremden Servern ohne CORS gehen noch nicht.

## Entwicklung

- `extension/` – die Erweiterung (Manifest V3, kein Build-Schritt).
- `tools/test-brave.sh` – startet eine isolierte Brave-Instanz mit geladener Erweiterung und DevTools-Port 9333.
- `tools/cdp.mjs` – minimaler CDP-Client zum Fernsteuern/Prüfen der Testinstanz.
- `tools/test-multitab.mjs` – Regressionstest für mehrere Tabs/TV-Fenster (Testinstanz mit offener Optionsseite).
- `tools/testpages/embeds.html` – Testseite mit eingebetteten Playern (`python3 -m http.server 8765 --directory tools/testpages`).
- `tools/reload-ext.mjs` – lädt die Erweiterung in der Testinstanz neu. Nach Codeänderungen nötig: Brave verwendet sonst über Neustarts hinweg das zwischengespeicherte Service-Worker-Skript.
- `docs/erkundung.md` – Ergebnisse der technischen Erkundung.
