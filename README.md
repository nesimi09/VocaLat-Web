# VocaLat Web

Responsive Web-Version der VocaLat-iOS-App mit allen Vokabeln, Grammatikabschnitten und einer lokalen Übersetzungshilfe.

## Funktionen

- 611 nutzbare Vokabeln aus den Lektionen 1–31 mit Suche, Filtern und temporären Favoriten (die leere Lektion 7 wird übersprungen)
- Geführter Anfängerkurs mit 10 Modulen, 8er-Wortpaketen, Grammatik, gemischten Tests und Fehlerwiederholungen
- Frei kombinierbare Tests aus einer oder mehreren Lektionen, als Karteikarte, Multiple Choice oder Texteingabe
- Didaktisch sortierte Grammatik mit zusammenhängenden Formenfolgen, responsiven Tabellen und Vor-/Zurück-Navigation
- Sitzungsgebundener Lernfortschritt über `sessionStorage`; keine dauerhaften Web-Lerndaten und aktuell kein Login
- Bild-Upload mit vollständig lokal im Browser laufender Tesseract.js-Texterkennung
- Allgemeine Latein-Deutsch-Pipeline aus Tokenisierung, Formenlehre, Satzanalyse, grammatischer Interpretation, Bedeutungsauswahl, deutscher Satzbildung und Nachbearbeitung
- Grammatikübungen lassen sich auf die aktuelle Buchlektion begrenzen, damit spätere Regeln nicht vorweggenommen werden
- Responsive Navigation für Smartphone, Tablet und Desktop
- Hell-/Dunkelmodus und installierbare PWA mit Offline-Cache

## Übersetzung

Der App-Rahmen und das Zusatzwörterbuch werden bei der PWA-Installation offline gespeichert. Die größeren OCR- und Formendateien lädt die App erst bei der ersten Übersetzung von derselben Website und legt sie anschließend im separaten Runtime-Cache ab. Auf einer statischen GitHub Page laufen Tesseract.js, Formenprüfung, Buchwörterbuch und Übersetzer vollständig im Browser; Bilder und Texte werden dafür nicht an einen Übersetzungsdienst gesendet.

Nach der Bildauswahl startet die Verarbeitung automatisch. Auf gemischten Arbeitsblättern wird der lateinische Haupttext von Logos, deutschen Einleitungen, Überschriften, Wortzahlen, Randspalten und Fußnoten getrennt; Vokabelhilfen aus dem Bild werden trotzdem als Kontext übernommen. Makron- und Akzentvarianten werden normalisiert. Fehlende oder verwechselte Buchstaben werden nur dann korrigiert, wenn die vorgeschlagene Form morphologisch plausibel ist.

Der Übersetzer speichert keine fertigen Übersetzungen bekannter Sätze. Jedes Eingabewort behält zunächst seine möglichen Formen und Bedeutungen. Danach bestimmt der Parser Satzgrenzen, Satzglieder, Kongruenzen und Konstruktionen wie AcI, NcI, Ablativus absolutus, Partizipien, Gerundiv sowie wichtige Neben- und Relativsätze. Erst auf dieser Grundlage wird eine Bedeutung gewählt und ein deutscher Satz erzeugt. Buchvokabeln erhalten bei einer grammatisch passenden Analyse Vorrang; für fehlende Lemmata steht das lokal mitgelieferte FreeDict-Wörterbuch mit 5.484 Einträgen bereit.

Die Module, Bewertungsdaten und Erweiterungsregeln sind in der [Übersetzungsarchitektur](docs/translation-architecture.md) beschrieben.

Die Übersetzungstests verwenden einen getrennten Holdout-Korpus mit künstlich zusammengestellten Sätzen. Er enthält keine vollständigen deutschen Musterübersetzungen. Geprüft werden stattdessen Satzglieder, erkannte Konstruktionen, notwendige Bedeutungsbestandteile, Abdeckung und die Unabhängigkeit von der lateinischen Wortstellung. Die OCR-Regressionstests prüfen davon getrennt die Extraktion aus unterschiedlich aufgebauten Arbeitsblättern.

## Geführter Kurs und Kurs-Pass

Der Kurs ordnet die vorhandenen Buchlektionen in zehn aufeinander aufbauende Module ein. Neue Vokabeln werden in Paketen von höchstens acht Wörtern eingeführt. Jede Runde verbindet aktiven Abruf, Formen- und Grammatikfragen sowie kurze Satzanwendung. Falsche Antworten erscheinen nach zwei anderen Aufgaben erneut. Ein Paket gilt ab 80 Prozent auf dem ersten Versuch und nach Korrektur aller Fehler als bestanden. Der Aufbau folgt den Empfehlungen zu aktivem Abruf und verteiltem Wiederholen aus dem [IES Practice Guide „Organizing Instruction and Study“](https://ies.ed.gov/ncee/wwc/PracticeGuide/1).

Der Kurs-Pass bietet zwei Zugangswege: Besitzer-Codes und ein PayPal-Sandbox-Monatsabo über 4,99 EUR. Zufällig erzeugte Freischaltcodes besitzen mindestens 128 Bit Entropie; im öffentlichen Repository liegen nur getrennte SHA-256-Prüfwerte. Klartextcodes werden vom Generator ausschließlich außerhalb des Repositories gespeichert. Zugang und Kursfortschritt gelten nur für die aktuelle Browser-Sitzung.

Die öffentliche Sandbox-Konfiguration liegt in `data/payment.json`. Sie verwendet ausschließlich die öffentliche Sandbox-Client-ID und Sandbox-Plan-ID; `expiresAt` kann bei Bedarf einen Abschaltzeitpunkt festlegen. PayPal-E-Mail, Passwort, Client Secret, Webhook-Daten und Live-Zugangsdaten gehören niemals in diese Datei oder das Repository. Eine Sandbox-Bestätigung entsperrt nur die aktuelle Sitzung und ist ausdrücklich kein sicherer Kaufnachweis.

Die privaten Codes liegen standardmäßig unter `~/Library/Application Support/VocaLat/private/access-codes.csv`. Neue Codes und eine neue öffentliche Prüfliste lassen sich mit `npm run codes:generate -- --revision 2 --force` erzeugen; dadurch verlieren alle bisherigen Codes ihre Gültigkeit. Klartextcodes dürfen nie in Git übernommen werden.

Da GitHub Pages ausschließlich öffentliche statische Dateien ausliefert, kann dieses clientseitige Gate technisch umgangen werden. Es ist kein sicherer Abonnement-, Identitäts- oder Bezahlschutz und darf nicht als Live-Shop veröffentlicht werden. Vor einem echten kostenpflichtigen Angebot sind ein Backend, PayPal-Webhook-Prüfung, serverseitige Berechtigungen, Rechtstexte und ein zulässiger kommerzieller Hostingdienst erforderlich.

Tesseract.js 7.0.0, Tesseract.js Core 7.0.0 und das lateinische Tesseract-Sprachmodell sind lokal unter `vendor/tesseract` hinterlegt. Die zugehörigen Lizenztexte liegen im selben Verzeichnis.

Die Formenprüfung verwendet den TypeScript-Port von Whitaker’s Words 0.1.1 (MIT; ursprüngliche WORDS-Daten frei verwendbar). Das Latein-Deutsch-Zusatzwörterbuch basiert auf FreeDict `lat-deu` 1.0.3 (GPL-3.0-or-later); Quelle, Autoren- und Lizenzdateien liegen unter `vendor/freedict`.

## Lokale Vorschau starten

Der lokale Webserver startet die gleiche Browser-App wie GitHub Pages. Dafür ist kein KI-Modell erforderlich:

```bash
npm start
```

Danach `http://127.0.0.1:8080` öffnen. Für eine andere Portnummer kann `PORT` gesetzt werden.

## Prüfen

```bash
npm test
npm run test:corpus
npm run check
```
