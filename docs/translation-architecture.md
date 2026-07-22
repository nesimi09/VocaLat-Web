# Übersetzungsarchitektur

VocaLat übersetzt mit einer deterministischen, lokal im Browser ausführbaren Pipeline. Es gibt keine Liste fertiger Satzübersetzungen und keine Regeln, die einen bestimmten Beispieltext erkennen. Buchvokabeln werden bei gleicher grammatischer Eignung bevorzugt; fehlen sie, kann das allgemeine lokale Lexikon einspringen.

## Die sieben Stufen

1. **Tokenisierung** (`tokenizeTranslationInput`) trennt Wörter, Satzzeichen und Enklitika wie `-que`, ohne die Quellpositionen zu verlieren.
2. **Morphologische Analyse** (`resolveMorphology`) sammelt alle bekannten Lesarten und bewertet Kombinationen satzweit mit einer Beam-Suche. Kasus, Numerus, Genus, Person, Tempus, Modus, Diathese, Komparation und infinite Formen bleiben dabei erhalten.
3. **Satzanalyse** (`parseLatinSyntax`, `buildLatinSyntaxTree`) bestimmt Teilsätze, Prädikate, Satzglieder, Attribute, Appositionen und ihre Abhängigkeiten. Die flachen Arbeitsdaten werden zusätzlich als echter Satz- und Abhängigkeitsbaum ausgegeben.
4. **Grammatische Interpretation** (`interpretLatinGrammar`) erkennt unter anderem AcI/NcI, Ablativus absolutus, Partizipialkonstruktionen, Gerundium, Gerundiv, Supinum sowie `ut`-, `cum`-, `si`- und Relativsätze.
5. **Bedeutungsauswahl** (`selectContextualMeanings`) bewertet Wörterbuchbedeutungen erst nach der Syntaxanalyse. Verbvalenz, Satzrolle, Konstruktion und Buchquelle beeinflussen die Auswahl.
6. **Deutsche Satzgenerierung** (`generateGermanSentence`) baut einen eigenständigen deutschen Satzplan auf. Er behandelt Verbzweit- und Verbletztstellung, Verbklammer, Kasus, Artikel, Adjektivflexion, Passiv, Tempus und Objektfolge unabhängig von der lateinischen Wortreihenfolge.
7. **Nachbearbeitung** (`postprocessGerman`) bereinigt Abstände und Satzzeichen, ohne die syntaktische Entscheidung umzuschreiben.

## Wahrscheinlichkeiten und Mehrdeutigkeit

Die Morphologie bricht nicht bei der ersten passenden Form ab. Kandidaten werden gemeinsam bewertet; Kongruenz, Verbvalenz, Präpositionsrektion, Teilsatzstruktur und Distanz liefern positive oder negative Evidenz. `latin-syntax-tree.js` normalisiert diese Werte zu Wahrscheinlichkeiten und gibt die verworfenen Lesarten für Diagnose und Tests aus. Sichtbar erzeugt der Übersetzer trotzdem genau eine, nämlich die am besten bewertete Interpretation.

Eine Unsicherheit wird nicht durch eine erfundene Bedeutung verdeckt. Fehlt eine lexikalische Grundlage oder eine notwendige Satzstruktur, sinkt die Konfidenz und die Übersetzung wird intern als nicht zuverlässig markiert.

## Zentrale Sprachdaten

- `latin-language-data.js` enthält Verbvalenzen, Verbklassen, Präpositionsrektion, unregelmäßige Formen und erweiterbare Idiome.
- `data/vocabulary.json` ist die bevorzugte Buchquelle.
- `data/fallback-lexicon.json` schließt Wortschatzlücken, ohne Buchbedeutungen zu verdrängen.
- `german-generator.js` enthält produktive deutsche Flexions- und Satzstellungsregeln.

Idiome werden deklarativ durch Lemmafolgen und Rollenabbildungen beschrieben. Eine neue Verbindung wird dadurch an einer Stelle ergänzt und nicht als Satz-Sonderfall im Parser oder Generator verteilt.

## Erweiterung und Prüfung

Neue Sprachregeln benötigen mindestens:

1. einen allgemeinen grammatischen Auslöser statt eines vollständigen Satzvergleichs,
2. Positivtests mit unterschiedlicher Wortstellung und Lexik,
3. einen Negativtest gegen eine ähnlich aussehende, aber andere Konstruktion,
4. einen Durchlauf der vollständigen Tests und des unabhängigen Holdout-Korpus.

`npm run check` prüft Syntax, Unit- und Integrationstests sowie den Übersetzungskorpus. Der Service Worker lädt alle Pipeline-Module vor, sodass dieselbe Logik auch auf GitHub Pages vollständig im Browser läuft.
