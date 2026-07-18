# VocaLat Web

Responsive Web-Version der VocaLat-iOS-App mit allen Vokabeln, Grammatikabschnitten und einer lokalen Übersetzungshilfe.

## Funktionen

- 611 nutzbare Vokabeln aus den Lektionen 1–31 mit Suche, Filtern und temporären Favoriten (die leere Lektion 7 wird übersprungen)
- Geführter Anfängerkurs mit 10 Modulen, 8er-Wortpaketen, Grammatik, gemischten Tests und Fehlerwiederholungen
- Frei kombinierbare Tests aus einer oder mehreren Lektionen, als Karteikarte, Multiple Choice oder Texteingabe
- Didaktisch sortierte Grammatik mit zusammenhängenden Formenfolgen, responsiven Tabellen und Vor-/Zurück-Navigation
- Sitzungsgebundener Lernfortschritt über `sessionStorage`; keine dauerhaften Web-Lerndaten und aktuell kein Login
- Bild-Upload mit Tesseract.js-Fallback sowie optionaler lokaler Bildprüfung durch Qwen 3.5 Vision
- Natürliche Latein-Deutsch-Übersetzung mit TranslateGemma und lokaler Gemma-Schlussprüfung; Buchvokabeln haben Vorrang
- Grammatikübungen lassen sich auf die aktuelle Buchlektion begrenzen, damit spätere Regeln nicht vorweggenommen werden
- Responsive Navigation für Smartphone, Tablet und Desktop
- Hell-/Dunkelmodus und installierbare PWA mit Offline-Cache

## Übersetzung

Der kleine App-Rahmen und das Zusatzwörterbuch werden bei der PWA-Installation offline gespeichert. Die größeren OCR- und Formendateien lädt die App erst bei der ersten Übersetzung von derselben Website und legt sie anschließend im separaten Runtime-Cache ab. Auf einer rein statischen GitHub Page laufen Tesseract.js, Formenprüfung, Buchwörterbuch und der regelbasierte Übersetzer vollständig im Browser.

Wird die App mit `npm start` betrieben, nutzt sie zusätzlich lokal installierte Ollama-Modelle: Qwen 3.5 Vision liest den lateinischen Haupttext direkt aus dem Bild und gleicht ihn mit der Browser-OCR ab; TranslateGemma formuliert kurze zusammenhängende Satzgruppen; Gemma 3 prüft Satzabdeckung, deutsche Grammatik und die passenden Bedeutungen aus dem Schulbuch. Fehlt ein Wort im Buch, wird das lokale FreeDict-Wörterbuch als nachrangiger Hinweis verwendet. Es wird keine externe OCR- oder Übersetzungs-API aufgerufen. Beim Zugriff über einen Tunnel wird das Bild selbstverständlich an diesen selbst betriebenen VocaLat-Server übertragen.

Nach der Bildauswahl startet die Verarbeitung automatisch. Auf gemischten Arbeitsblättern wird der lateinische Haupttext von Logos, deutschen Einleitungen, Überschriften, Wortzahlen, Randspalten und Fußnoten getrennt; Vokabelhilfen aus dem Bild werden trotzdem als Kontext übernommen. Makron-/Akzentvarianten werden normalisiert, fehlende oder verwechselte Buchstaben werden nur bei morphologisch und syntaktisch plausiblen Formen korrigiert, und Flexionsformen werden auf ihre Lemmata zurückgeführt. Für fehlende Lemmata steht ein lokal mitgeliefertes FreeDict-Wörterbuch mit 5.484 Einträgen bereit. Die eingeklappte Detailansicht zeigt erkannten Text, Formen, Quellen und Grammatikregeln.

Die lokale Referenzbasis enthält selbst formulierte und geprüfte deutsche Übersetzungen von 69 Abschnitten mit insgesamt 965 lateinischen Wörtern aus Hyginus, Caesar, Cicero, Phaedrus, Cornelius Nepos, Seneca, Sallust, Ovid, Livius und dem zusätzlich geprüften 53-Wörter-Arbeitsblatt „Familia avum exspectat“. Der Abgleich funktioniert auch bei fehlenden Satzzeichen und einzelnen ausgelassenen oder verwechselten OCR-Buchstaben. Eine Negation oder ein ganzes fehlendes Wort wird aus Sicherheitsgründen nicht stillschweigend ergänzt. Unbekannte komplexe Sätze werden analysiert, aber nicht mehr als scheinbar sichere Wortsalat-Übersetzung ausgegeben; nur eng begrenzte, getestete einfache Satzmuster erhalten einen ungeprüften Vorschlag.

Zusätzlich zum Satzkorpus liegen Regressionstests mit den echten OCR-Ausgaben der Arbeitsblätter „Nessus“, „Triptolemus“ und „Lupus et agnus“ vor. Sie decken Seiten ohne Leerzeilen, gemischte deutsch-lateinische Blöcke, mehrere Vokabelhilfen pro Fußnotenzeile, große Absatzabstände und fehlerhafte Zeilennummern ab.

## Geführter Kurs und Kurs-Pass

Der Kurs ordnet die vorhandenen Buchlektionen in zehn aufeinander aufbauende Module ein. Neue Vokabeln werden in Paketen von höchstens acht Wörtern eingeführt. Jede Runde verbindet aktiven Abruf, Formen- und Grammatikfragen sowie kurze Satzanwendung. Falsche Antworten erscheinen nach zwei anderen Aufgaben erneut. Ein Paket gilt ab 80 Prozent auf dem ersten Versuch und nach Korrektur aller Fehler als bestanden. Der Aufbau folgt den Empfehlungen zu aktivem Abruf und verteiltem Wiederholen aus dem [IES Practice Guide „Organizing Instruction and Study“](https://ies.ed.gov/ncee/wwc/PracticeGuide/1).

Der Kurs-Pass bietet zwei Zugangswege: Besitzer-Codes und ein PayPal-Sandbox-Monatsabo über 4,99 EUR. Zufällig erzeugte Freischaltcodes besitzen mindestens 128 Bit Entropie; im öffentlichen Repository liegen nur getrennte SHA-256-Prüfwerte. Klartextcodes werden vom Generator ausschließlich außerhalb des Repositories gespeichert. Zugang und Kursfortschritt gelten nur für die aktuelle Browser-Sitzung.

Die öffentliche Sandbox-Konfiguration liegt in `data/payment.json`. Sie verwendet ausschließlich die öffentliche Sandbox-Client-ID und Sandbox-Plan-ID; `expiresAt` kann bei Bedarf einen Abschaltzeitpunkt festlegen. PayPal-E-Mail, Passwort, Client Secret, Webhook-Daten und Live-Zugangsdaten gehören niemals in diese Datei oder das Repository. Eine Sandbox-Bestätigung entsperrt nur die aktuelle Sitzung und ist ausdrücklich kein sicherer Kaufnachweis.

Die privaten Codes liegen standardmäßig unter `~/Library/Application Support/VocaLat/private/access-codes.csv`. Neue Codes und eine neue öffentliche Prüfliste lassen sich mit `npm run codes:generate -- --revision 2 --force` erzeugen; dadurch verlieren alle bisherigen Codes ihre Gültigkeit. Klartextcodes dürfen nie in Git übernommen werden.

Da GitHub Pages ausschließlich öffentliche statische Dateien ausliefert, kann dieses clientseitige Gate technisch umgangen werden. Es ist kein sicherer Abonnement-, Identitäts- oder Bezahlschutz und darf nicht als Live-Shop veröffentlicht werden. Vor einem echten kostenpflichtigen Angebot sind ein Backend, PayPal-Webhook-Prüfung, serverseitige Berechtigungen, Rechtstexte und ein zulässiger kommerzieller Hostingdienst erforderlich.

Tesseract.js 7.0.0, Tesseract.js Core 7.0.0 und das lateinische Tesseract-Sprachmodell sind lokal unter `vendor/tesseract` hinterlegt. Die zugehörigen Lizenztexte liegen im selben Verzeichnis.

Die Formenprüfung verwendet den TypeScript-Port von Whitaker’s Words 0.1.1 (MIT; ursprüngliche WORDS-Daten frei verwendbar). Das Latein-Deutsch-Zusatzwörterbuch basiert auf FreeDict `lat-deu` 1.0.3 (GPL-3.0-or-later); Quelle, Autoren- und Lizenzdateien liegen unter `vendor/freedict`.

## Mit lokalem Übersetzungsmodell starten

Voraussetzung ist ein laufendes [Ollama](https://ollama.com/). Die Modelle werden einmalig lokal geladen:

```bash
ollama pull qwen3.5:9b
ollama pull translategemma:12b
ollama pull gemma3:12b
```

Danach startet der Node-Server App und Übersetzungsendpunkt gemeinsam:

```bash
npm start
```

Danach `http://127.0.0.1:8080` öffnen. Andere Modelle oder Ports lassen sich über `OLLAMA_MODEL`, `OLLAMA_TRANSLATION_MODEL`, `OLLAMA_REVIEW_MODEL`, `OLLAMA_URL`, `HOST` und `PORT` festlegen. Fehlt Gemma 3, wird Qwen für die Schlussprüfung verwendet; fehlt TranslateGemma, übernimmt das allgemeine lokale Modell die Übersetzung. Ohne Serverendpunkt bleibt die statische Browserübersetzung verfügbar.

## Prüfen

```bash
npm test
npm run test:corpus
npm run check
# bei laufendem npm-start-Server zusätzlich:
npm run test:model
```
