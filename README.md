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
- **Mehrere Tabs:** Jeder Tab mit TV-Ausgabe hat ein eigenes TV-Fenster. Der TV zeigt immer das des aktiven Tabs bzw. des Tabs, in dem zuletzt Play gedrückt wurde.
- **Zurückholen:** Button im Platzhalter, Erweiterungssymbol oder ⌥⇧T. Das Video läuft ohne Unterbrechung in der Seite weiter.
- **Einstellungen:** Rechtsklick auf das Symbol → Optionen (Automatik, Websites, Schwellwerte, Paralleldarstellung, Verhalten bei Videoende).

## Bekannte Grenzen (Prototyp)

- Kopiergeschützte Videos (DRM, z. B. Streamingdienste) können nicht ausgegeben werden; die Erweiterung zeigt das an.
- Eingebettete Player in fremden iframes (z. B. Vimeo auf Nachrichtenseiten) werden noch nicht unterstützt.
- Zielbildschirm ist immer der erste Nicht-Hauptbildschirm.

## Entwicklung

- `extension/` – die Erweiterung (Manifest V3, kein Build-Schritt).
- `tools/test-brave.sh` – startet eine isolierte Brave-Instanz mit geladener Erweiterung und DevTools-Port 9333.
- `tools/cdp.mjs` – minimaler CDP-Client zum Fernsteuern/Prüfen der Testinstanz.
- `tools/reload-ext.mjs` – lädt die Erweiterung in der Testinstanz neu. Nach Codeänderungen nötig: Brave verwendet sonst über Neustarts hinweg das zwischengespeicherte Service-Worker-Skript.
- `docs/erkundung.md` – Ergebnisse der technischen Erkundung.
