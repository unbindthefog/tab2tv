# VideoToTV – Anforderungsspezifikation einer Brave-Erweiterung für Videowiedergabe auf dem TV

Oct 5, 2026 · @Jan

## Ziel und Nutzungsszenario

VideoToTV ist eine Browsererweiterung für Brave, die ein im Browser laufendes Video automatisch im Vollbild auf einem zweiten Bildschirm ausgibt. Die Webseite selbst bleibt dabei vollständig und normal bedienbar auf dem Hauptbildschirm.

Typisches Setup: MacBook mit macOS, ein Fernseher ist per AirPlay als erweiterter Bildschirm verbunden. Der Nutzer startet zum Beispiel ein YouTube-Video. Das Bild erscheint sofort im Vollbild auf dem TV, während er auf dem MacBook weiter in den Kommentaren liest, in der Seitenleiste stöbert oder den Player bedient.

Das Prinzip entspricht Bild-in-Bild (Picture-in-Picture): Nur das Video wird herausgelöst, die Seite bleibt, wo sie ist. Der Unterschied ist, dass das Video nicht in einem kleinen schwebenden Fenster landet, sondern dauerhaft bildschirmfüllend auf dem TV.

## Nutzungserfahrung

Die Erweiterung soll sich anfühlen, als wäre der TV einfach der Ort, an dem Videos laufen. Kein Einrichten pro Video, kein Fensterschieben, kein Umschalten.

**Ein typischer Ablauf**

1. TV ist per AirPlay als erweiterter Bildschirm verbunden. Der Nutzer öffnet YouTube in Brave und klickt ein Video an.
2. Das Video erscheint nach einem kurzen Moment im Vollbild auf dem TV, ohne schwarze Ränder außer denen des Seitenverhältnisses und ohne Bedienelemente oder Mauszeiger.
3. Auf dem MacBook sieht die YouTube-Seite aus wie gewohnt. Im Player steht je nach Einstellung ein ruhiger Platzhalter (z. B. „Wird auf TV wiedergegeben“), oder das Video läuft dort parallel weiter (optionale Paralleldarstellung). Die Player-Bedienelemente funktionieren weiter: Pause, Spulen, Lautstärke, Qualität, Untertitel, Geschwindigkeit wirken direkt auf das Bild am TV.
4. Der Nutzer scrollt durch die Kommentare, öffnet andere Tabs, arbeitet in anderen Programmen. Das Video läuft ungestört weiter.
5. Klickt er in der Seitenleiste auf das nächste Video, wechselt der TV nahtlos auf das neue Video.
6. Schließt er den Tab, verschwindet das Bild vom TV. Trennt er die AirPlay-Verbindung, kehrt das Video pausiert in die Seite zurück. In keinem Fall bleiben Fenster oder Reste zurück.

**Leitlinien**

- Unaufdringlich: Die Erweiterung greift nur ein, wenn es eindeutig gewünscht ist. Vorschauvideos, Werbebanner oder Hintergrundvideos lösen nichts aus.
- Vorhersehbar: Der Nutzer weiß jederzeit, ob ein Video gerade auf dem TV läuft, und kann es mit einem Klick zurückholen.
- Folgenlos: Nach dem Beenden ist die Seite exakt so wie vorher.
- Ohne zweiten Bildschirm verhält sich Brave völlig normal.

## Funktionale Anforderungen

**Seite bleibt bedienbar (Kernanforderung)**

- Der Tab bleibt im Hauptfenster auf dem Hauptbildschirm. Die Seite lässt sich während der Ausgabe uneingeschränkt nutzen: scrollen, klicken, navigieren, Kommentare lesen.
- Die Bedienelemente des Website-Players steuern weiterhin die Wiedergabe auf dem TV (Pause, Spulen, Lautstärke, Untertitel, Qualität, Geschwindigkeit).
- Der Ton kommt aus derselben Quelle wie das Bild. Bild und Ton bleiben lippensynchron, egal ob der Ton über AirPlay am TV oder lokal ausgegeben wird.

**Auslösung**

- Automatik: Ein relevantes Video wird beim Start auf den TV ausgegeben, sofern der Zielbildschirm verbunden ist.
- Manuell: über das Erweiterungssymbol, auch wenn die Automatik aus ist.
- Automatik global und pro Website ein- und ausschaltbar.
- Keine Auslösung bei stummgeschalteten Autoplay-Videos, kleinen Vorschauvideos, sehr kurzen Clips oder Werbung, soweit erkennbar. Schwellwerte einstellbar.
- Bei mehreren Videos auf einer Seite wird das Hauptvideo gewählt, im Zweifel das, mit dem der Nutzer interagiert hat.

**Darstellung auf dem TV**

- Bildschirmfüllend, Seitenverhältnis erhalten, schwarzer Hintergrund.
- Keine Browser-Bedienelemente, keine Seitenelemente, kein Mauszeiger.
- Untertitel des Players sollen auf dem TV sichtbar sein, wo technisch möglich.
- Wechselt die Seite zu einem neuen Video (Klick in der Seitenleiste, Autoplay der nächsten Folge, Playlist), folgt der TV ohne erneuten Eingriff.

**Darstellung auf dem Hauptbildschirm**

- Standardmäßig ersetzt ein Platzhalter mit Hinweis „Wird auf TV wiedergegeben“ und einem Button zum Zurückholen das Videobild im Player. Bei aktiver Paralleldarstellung läuft das Video stattdessen im Player weiter, und ein dezenter Hinweis mit Zurückholen-Button bleibt erreichbar.
- Das Seitenlayout darf dadurch nicht verrutschen.
- Das Erweiterungssymbol zeigt den Status (aktiv, inaktiv, kein Zielbildschirm).

**Optional: Paralleldarstellung**

- Einstellbar: Das Video läuft zusätzlich weiter sichtbar im Original-Player, statt dort durch einen Platzhalter ersetzt zu werden. Beide Darstellungen zeigen dasselbe Bild zur selben Zeit.
- Der Ton kommt nur aus einer Quelle, damit es kein Echo gibt.
- Ist die Paralleldarstellung bei einem Inhalt nicht möglich (z. B. DRM), fällt die Erweiterung auf den Platzhalter zurück und zeigt das an.
- Ob die Option umsetzbar ist und mit welchem Ansatz, soll bei der Umsetzung erkundet werden. Sie hat geringere Priorität als die Kernanforderung.

**Beenden und Rückholen**

- Zurückholen per Button am Player (im Platzhalter bzw. im Hinweis bei Paralleldarstellung) oder Erweiterungssymbol. Das Video läuft dann ohne Unterbrechung im Player der Seite weiter.
- Bei Videoende: Verhalten einstellbar (auf dem TV stehen lassen, zurückholen, TV schwarz).
- Wird der Zielbildschirm getrennt: Video sofort zurück in die Seite, pausiert.
- Wird der Tab geschlossen oder verlässt er die Website: Ausgabe auf dem TV endet sauber.

**Einstellungen**

- Auswahl des Zielbildschirms. Die Wahl soll eine erneute AirPlay-Verbindung überdauern.
- Automatik, Website-Liste, Schwellwerte, Verhalten bei Videoende.

## Rahmenbedingungen

- **Browser:** Brave (Chromium-basiert) in aktueller Version unter macOS. Installation zunächst lokal als entpackte Erweiterung.
- **Zielbildschirm:** Fernseher per AirPlay als erweiterter Bildschirm („Als separaten Bildschirm verwenden“). Bei Bildschirmsynchronisierung (Mirroring) gibt es keinen zweiten Bildschirm, die Erweiterung bleibt dann inaktiv. Ein per HDMI angeschlossener Monitor soll genauso funktionieren.
- **AirPlay-Eigenheiten:** Der TV-Bildschirm kann bei jeder Verbindung anders identifiziert werden, die Verbindung kann jederzeit abbrechen, und die Übertragung hat spürbare Latenz. Die Erweiterung muss damit robust umgehen.
- **macOS:** Vollbild auf einem zweiten Bildschirm hängt von der Systemeinstellung „Monitore verwenden verschiedene Spaces“ ab. Benötigte Systemeinstellungen sollen dokumentiert oder von der Erweiterung erkannt werden.
- **Inhalte:** Es sollen möglichst viele Websites funktionieren, mindestens YouTube. Auch eingebettete Player auf fremden Seiten und DRM-geschützte Inhalte (z. B. Mediatheken) sind wünschenswert. Wo das nicht geht, soll die Erweiterung das klar anzeigen statt still zu scheitern.
- **Datenschutz:** Keine Netzwerkzugriffe, keine Telemetrie, keine externen Dienste.

## Lösungsideen (unverbindlich)

Die Wahl des technischen Ansatzes ist Sache der Umsetzung. Die folgenden Ideen sind Ausgangspunkte. Sie sollten früh mit einem kleinen Prototyp gegeneinander geprüft werden, bevor die Erweiterung ausgebaut wird.

**Idee A: Das Video-Element in ein eigenes Fenster auf dem TV verlagern.** Ähnlich wie Bild-in-Bild: Das laufende Video-Element der Seite wandert in ein separates Fenster, das auf dem TV im Vollbild liegt. Da es dasselbe Element bleibt, steuern die Player-Bedienelemente der Seite es weiterhin. Denkbar sind ein Document-Picture-in-Picture-Fenster, sofern es sich auf Vollbildgröße bringen lässt, oder ein gewöhnliches Fenster derselben Herkunft (Origin). Zu klären: Unterbrechung der Wiedergabe beim Verschieben, Verhalten bei DRM, Popup-Blocker, Untertitel-Overlays des Players.

**Idee B: Zweite, synchronisierte Wiedergabe.** Auf dem TV läuft eine eigene Instanz desselben Videos (z. B. über den eingebetteten Player der Plattform), die mit dem Original synchron gehalten wird. Das Original wird stumm und unsichtbar geschaltet. Robust gegenüber Seitenumbauten, aber plattformspezifisch, doppelter Datenverkehr und Synchronisationsaufwand.

**Idee C: Bild des Videos spiegeln.** Der Videoinhalt wird als Stream abgegriffen (z. B. `captureStream()`) und in einem Fenster auf dem TV angezeigt. Generisch, aber bei DRM-Inhalten blockiert und mit zusätzlicher Latenz. Da das Original weiterläuft, ist das der naheliegende Weg für die optionale Paralleldarstellung, ebenso Idee B. Idee A schließt sie aus, weil das Video-Element nur an einem Ort sein kann.

**Verworfen: den ganzen Tab auf den TV verschieben.** Technisch einfach, widerspricht aber der Kernanforderung, dass die Seite auf dem Hauptbildschirm bedienbar bleibt.

Eine Kombination ist denkbar, etwa Idee A als Standard und Idee B als Fallback für einzelne Plattformen.

## Abgrenzung und Nicht-Ziele

- Kein AirPlay-Videostreaming: Die Erweiterung baut keine AirPlay-Verbindung auf, sie nutzt den bereits erweiterten Bildschirm. Das Bild wird vom Mac gerendert und von macOS per AirPlay übertragen.
- Keine Unterstützung für Bildschirmsynchronisierung (Mirroring).
- Keine Veröffentlichung im Chrome Web Store in der ersten Version.
- Keine Fernsteuerung über andere Geräte.
- Keine Unterstützung für Firefox oder Safari.

## Testszenarien und Akzeptanzkriterien

| Szenario | Erwartetes Verhalten |
| --- | --- |
| YouTube-Video starten | Video im Vollbild auf dem TV, Seite auf dem MacBook voll bedienbar, Platzhalter am Player |
| YouTube-Video mit aktiver Paralleldarstellung starten | Video läuft synchron im Player und im Vollbild auf dem TV, Ton nur aus einer Quelle |
| Während der Wiedergabe Kommentare scrollen, anderen Tab öffnen | Wiedergabe auf dem TV läuft ungestört weiter |
| Player-Bedienelemente auf dem MacBook nutzen (Pause, Spulen, Untertitel) | Wirkung sofort am TV sichtbar |
| Nächstes Video in der Seitenleiste anklicken | TV wechselt ohne erneuten Eingriff |
| Eingebetteter Player auf fremder Seite (z. B. Vimeo) | Funktioniert wie YouTube oder zeigt klar an, dass es nicht geht |
| DRM-Inhalt (Mediathek, Streamingdienst) | Funktioniert oder zeigt klar an, dass es nicht geht |
| Stummes Autoplay-Video, z. B. auf einer Nachrichtenseite | Keine Ausgabe auf dem TV |
| Video über das Erweiterungssymbol zurückholen | Video läuft ohne Unterbrechung im Player der Seite weiter |
| AirPlay-Verbindung während der Wiedergabe trennen | Video pausiert zurück in der Seite, keine Fensterreste |
| Kein zweiter Bildschirm verbunden | Keinerlei Eingriff |

**Akzeptanzkriterien**

- Das Bild erscheint spätestens etwa 1,5 s nach dem Start auf dem TV (ohne macOS-Animation).
- Die Seite auf dem Hauptbildschirm ist während der Ausgabe ohne Einschränkung bedienbar.
- Nach dem Beenden ist die Seite optisch und funktional unverändert.
- Keine Fehlauslösung beim Aufruf von 10 typischen Nachrichten- und Shopping-Seiten.

## Hinweise an Claude Code

- Dieses Dokument beschreibt, was die Erweiterung leisten soll, nicht wie. Architektur, APIs und Struktur sind frei wählbar.
- Zuerst die Lösungsideen mit minimalen Prototypen auf YouTube prüfen, das Ergebnis kurz zusammenfassen und den gewählten Ansatz mit dem Nutzer abstimmen, bevor weitergebaut wird. Die Kernanforderung (Seite bleibt bedienbar, Player steuert TV-Bild) ist das Hauptkriterium.
- Verhalten von Browser-APIs gegen die aktuelle Dokumentation prüfen, nicht aus dem Gedächtnis annehmen.
- Bedienoberfläche und README auf Deutsch, Code und Kommentare auf Englisch.
- README mit Installationsanleitung für Brave und den nötigen macOS-Einstellungen.
