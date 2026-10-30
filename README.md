# tab2tv

Brave-Erweiterung, die das Video eines Browser-Tabs im Vollbild auf einem zweiten Bildschirm ausgibt (z. B. TV per AirPlay). Die Seite bleibt auf dem Hauptbildschirm bedienbar, ihr Player steuert das Bild auf dem TV.

## Installation

`brave://extensions` → **Entwicklermodus** an → **Entpackte Erweiterung laden** → Ordner `extension/`. Nach Codeänderungen auf der Erweiterungskarte ↻ klicken.

## Einstellungen

- **macOS:** TV per AirPlay als **separaten Bildschirm** verbinden, nicht synchronisieren. „Monitore verwenden verschiedene Spaces“ eingeschaltet lassen.
- **Brave:** Ansicht → „Symbolleiste im Vollbildmodus immer anzeigen“ aus (⇧⌘F). Einstellungen → Darstellung → „Abgerundete Ecken in Hauptelementen anzeigen“ aus.

## Bedienung

Menü am Erweiterungssymbol:

- **SEND:** schickt das Video dieses Tabs auf den TV, erneut drücken holt es zurück. Ohne Video öffnet SEND das TV-Fenster mit dem Platzhalter.
- **CLEAR:** beendet alle Ausgaben, erneut drücken schließt das TV-Fenster.
- **AUTO:** Automatik, standardmäßig aus. Wenn sie an ist, geht auf freigegebenen Websites (Standard: youtube.com) ein gestartetes Video von selbst auf den TV, und der TV folgt dem aktiven Tab.
- **OPT:** Einstellungen, etwa Zielbildschirm, Websites der Automatik, Paralleldarstellung und Wartezeiten.

Wird der TV getrennt, kehrt das Video pausiert in die Seite zurück.

## Grenzen

Kopiergeschützte Videos (DRM) lassen sich nicht ausgeben, Videos von fremden Servern ohne CORS noch nicht.

## Entwicklung

`extension/` ist die Erweiterung (Manifest V3, kein Build-Schritt). In `tools/` liegen eine isolierte Brave-Testinstanz (`test-brave.sh`), CDP-Helfer und Tests: `test-unit.mjs` läuft ohne TV, `test-multitab.mjs` und `test-automode.mjs` brauchen den TV. Die Ergebnisse der technischen Erkundung stehen in `docs/erkundung.md`.
