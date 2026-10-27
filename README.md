# tab2tv

Brave-Erweiterung, die ein im Browser laufendes Video im Vollbild auf einem zweiten Bildschirm (z. B. TV per AirPlay) ausgibt. Die Webseite bleibt auf dem Hauptbildschirm normal bedienbar, der Player der Seite steuert das Bild auf dem TV.

## Installation in Brave

1. `brave://extensions` öffnen.
2. Oben rechts **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** → den Ordner `extension/` dieses Projekts wählen.
4. Optional: Erweiterungssymbol an die Symbolleiste anheften (Puzzle-Symbol → Pin).

Nach Änderungen am Code: auf der Erweiterungskarte auf ↻ klicken. Offene Tabs müssen nicht neu geladen werden, die Erweiterung spielt ihre Skripte selbst nach.

## Nötige Einstellungen

**macOS**
- TV per AirPlay als **separaten Bildschirm** verbinden (Kontrollzentrum → Bildschirmsynchronisierung → TV wählen → „Als separaten Bildschirm verwenden“). Bei Synchronisierung (Mirroring) bleibt die Erweiterung inaktiv.
- Systemeinstellungen → Schreibtisch & Dock → **„Monitore verwenden verschiedene Spaces“ = an** (Standard). Sonst kann das Vollbild auf dem TV den Hauptbildschirm beeinträchtigen.

**Brave**
- Menü **Ansicht → „Symbolleiste im Vollbildmodus immer anzeigen“ ausschalten** (⇧⌘F). Sonst bleibt auf dem TV oben eine schmale Adressleiste sichtbar. Die Erweiterung erkennt das und zeigt einen Hinweis.

**Optional (macOS)**
- Systemeinstellungen → Bedienungshilfen → Anzeige → **„Bewegung reduzieren“**: Der Wechsel zwischen TV-Fenstern (Tabwechsel) wird dann überblendet statt geschoben und wirkt schneller.

## Bedienung

- **Automatik** (standardmäßig aus, AUTO im Menü): Auf den Websites in der Automatik-Liste (Standard: nur `youtube.com`) erscheint ein per Klick gestartetes Video nach ca. 1 s im Vollbild auf dem TV. Maßgeblich ist die Website, auf der du bist – ein YouTube-Player eingebettet auf einer anderen Seite startet nur automatisch, wenn diese Seite in der Liste steht. Standardmäßig läuft das Video zusätzlich im Player der Seite weiter (Paralleldarstellung, Ton nur einmal); alternativ ersetzt ein dunkler Platzhalter „Wird auf TV wiedergegeben“ das Bild.
- **Menü am Erweiterungssymbol** (schlichtes Tastenfeld, hell/dunkel nach System, Statuszeile unter jeder Taste):
  - **SEND:** Video dieses Tabs auf den TV; leuchtet „ON“, solange der Tab auf dem TV läuft – erneut drücken holt es zurück.
  - **AUTO:** Automatik „ON“ (grün) / „OFF“ (rot, Symbol rot mit „AUS“). Aus: Der TV behält sein Video, folgt keinem Tabwechsel und startet nichts automatisch – so kannst du ein Video weiterschauen und in anderen Tabs stöbern. Wieder an: holt sofort das Video des aktuellen Tabs auf den TV.
  - **CLEAR:** schließt alle TV-Fenster (Anzeige: Anzahl offener TV-Fenster); die Videos kehren in ihre Seiten zurück.
  - **OPT:** Einstellungen.
- Klappt das Öffnen des TV-Fensters ausnahmsweise nicht, erscheint unten rechts auf der Seite ein Hinweis mit Button „Auf TV abspielen“.
- **Mehrere Tabs:** Der TV zeigt das Video des Tabs, in dem zuletzt Play gedrückt bzw. zu dem gewechselt wurde. Das vorherige TV-Fenster bleibt 30 s im Hintergrund (Zurückwechseln geht sofort) und schließt sich dann; das Video kehrt in seine Seite zurück. Es gibt höchstens zwei TV-Fenster. Die Wartezeit ist in den Optionen einstellbar.
- **Zurückholen:** SEND im Menü. Das Video läuft ohne Unterbrechung in der Seite weiter.
- **Einstellungen:** im Menü „OPT“ (oder Rechtsklick auf das Symbol → Optionen): Zielbildschirm, Automatik (Website-Liste oder alle Websites), Paralleldarstellung, Hintergrund-Fenster, Verhalten bei Videoende. Unter „Erweitert“: Schwellwerte der Automatik (Mindestdauer/-breite), Bildschirmnamen, Diagnose.
- **Zielbildschirm:** Standard ist der erste zusätzliche Bildschirm. Ein ausdrücklich gewählter Bildschirm wird nach einer neuen AirPlay-Verbindung wiedererkannt (über Kennung, Name oder Auflösung). Ist er nicht verbunden, gibt die Erweiterung nichts aus. „Bildschirmnamen anzeigen“ (unter „Erweitert“) fragt einmalig die Berechtigung zur Fensterverwaltung an, damit Namen wie „Wohnzimmer“ erscheinen.
- **TV getrennt:** Wird der Zielbildschirm getrennt (oder auf Synchronisierung umgestellt), kehrt das Video sofort pausiert in die Seite zurück.

## Bekannte Grenzen

- Kopiergeschützte Videos (DRM, z. B. Streamingdienste) können nicht ausgegeben werden; die Erweiterung zeigt das an.
- Eingebettete Player (iframes, z. B. YouTube-Embeds auf fremden Seiten) werden unterstützt, sofern das Video im iframe per `captureStream()` abgreifbar ist. Videos von fremden Servern ohne CORS gehen noch nicht.

## Entwicklung

- `extension/` – die Erweiterung (Manifest V3, kein Build-Schritt).
- `tools/test-brave.sh` – startet eine isolierte Brave-Instanz mit geladener Erweiterung und DevTools-Port 9333.
- `tools/cdp.mjs` – minimaler CDP-Client zum Fernsteuern/Prüfen der Testinstanz.
- `tools/test-multitab.mjs` – Regressionstest für mehrere Tabs/TV-Fenster (Testinstanz mit offener Optionsseite).
- `tools/test-automode.mjs` – Regressionstest für den Automatik-Schalter im Menü.
- `tools/testpages/embeds.html` – Testseite mit eingebetteten Playern (`python3 -m http.server 8765 --directory tools/testpages`).
- `tools/screenshot.mjs` – Screenshot einer Seite der Testinstanz.
- `tools/reload-ext.mjs` – lädt die Erweiterung in der Testinstanz neu. Nach Codeänderungen nötig: Brave verwendet sonst über Neustarts hinweg das zwischengespeicherte Service-Worker-Skript.
- `docs/erkundung.md` – Ergebnisse der technischen Erkundung.
