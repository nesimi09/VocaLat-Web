# VocaLat Web

Responsive Web-Version der VocaLat-iOS-App mit allen Vokabeln, Grammatikabschnitten und einer lokalen Übersetzungshilfe.

## Funktionen

- 611 nutzbare Vokabeln aus 31 Lektionen mit Suche, Filtern und temporären Favoriten
- Karteikarte, Multiple Choice und Texteingabe mit derselben Feedbacklogik wie in iOS
- Kategorisierte Grammatik mit responsiven Tabellen
- Sitzungsgebundener Lernfortschritt über `sessionStorage`; keine dauerhaften Web-Lerndaten und aktuell kein Login
- Bild-Upload und vollständig lokal ausgeführte Latein-OCR mit Tesseract.js
- Automatische Formenprüfung und OCR-Korrektur; Buchvokabeln haben Vorrang, fehlende Bedeutungen kommen aus einem mitgelieferten Latein-Deutsch-Wörterbuch
- Responsive Navigation für Smartphone, Tablet und Desktop
- Hell-/Dunkelmodus und installierbare PWA mit Offline-Cache

## Lokale Übersetzungshilfe

Der kleine App-Rahmen und das Zusatzwörterbuch werden bei der PWA-Installation offline gespeichert. Die größeren OCR- und Formendateien lädt die App erst bei der ersten Übersetzung von derselben Website und legt sie anschließend im separaten Runtime-Cache ab. Bild und Text werden nicht an eine externe OCR-, Übersetzungs- oder KI-API gesendet. Besucher der GitHub Page müssen nichts installieren oder manuell herunterladen.

Nach der Bildauswahl startet die Verarbeitung automatisch. Auf gemischten Arbeitsblättern wird der lateinische Haupttext von Logos, deutschen Einleitungen, Überschriften, Wortzahlen und Fußnoten getrennt; Vokabelhilfen aus dem Bild werden trotzdem als Kontext übernommen. Makron-/Akzentvarianten werden normalisiert, ein fehlender oder verwechselter Buchstabe kann über bekannte Wortformen korrigiert werden, und Flexionsformen werden auf ihre Lemmata zurückgeführt. Die sichtbare Übersetzung bevorzugt immer das Schulbuch. Für fehlende Lemmata steht ein lokal mitgeliefertes FreeDict-Wörterbuch mit 5.484 Einträgen bereit. Fehlende Grammatikhilfen werden lokal aus den erkannten Formen ergänzt; die eingeklappte Detailansicht zeigt Korrekturen, Formen und Regeln.

Die lokale Referenzbasis enthält selbst formulierte und geprüfte deutsche Übersetzungen von 61 Abschnitten gemeinfreier Schultexte aus Hyginus, Caesar, Cicero, Phaedrus, Cornelius Nepos, Seneca, Sallust, Ovid und Livius. Der Abgleich funktioniert auch bei fehlenden Satzzeichen und einzelnen ausgelassenen oder verwechselten OCR-Buchstaben. Eine Negation oder ein ganzes fehlendes Wort wird aus Sicherheitsgründen nicht stillschweigend ergänzt. Unbekannte komplexe Sätze werden analysiert, aber nicht mehr als scheinbar sichere Wortsalat-Übersetzung ausgegeben; nur eng begrenzte, getestete einfache Satzmuster erhalten einen ungeprüften Vorschlag.

Zusätzlich zum Satzkorpus liegen Regressionstests mit den echten OCR-Ausgaben der Arbeitsblätter „Nessus“, „Triptolemus“ und „Lupus et agnus“ vor. Sie decken Seiten ohne Leerzeilen, gemischte deutsch-lateinische Blöcke, mehrere Vokabelhilfen pro Fußnotenzeile, große Absatzabstände und fehlerhafte Zeilennummern ab.

Tesseract.js 7.0.0, Tesseract.js Core 7.0.0 und das lateinische Tesseract-Sprachmodell sind lokal unter `vendor/tesseract` hinterlegt. Die zugehörigen Lizenztexte liegen im selben Verzeichnis.

Die Formenprüfung verwendet den TypeScript-Port von Whitaker’s Words 0.1.1 (MIT; ursprüngliche WORDS-Daten frei verwendbar). Das Latein-Deutsch-Zusatzwörterbuch basiert auf FreeDict `lat-deu` 1.0.3 (GPL-3.0-or-later); Quelle, Autoren- und Lizenzdateien liegen unter `vendor/freedict`.

## Lokal starten

Da die Inhalte als JSON geladen werden, muss die Seite über einen kleinen lokalen Server geöffnet werden:

```bash
python3 -m http.server 8080
```

Danach `http://localhost:8080` öffnen.

## Prüfen

```bash
npm test
npm run test:corpus
npm run check
```
