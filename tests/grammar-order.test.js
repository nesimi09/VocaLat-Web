import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { grammarCategory, orderGrammarSections, sortGrammarSections } from "../grammar-order.js";

const grammar = JSON.parse(readFileSync(new URL("../data/grammar.json", import.meta.url), "utf8")).abschnitte;

function titles(sections) {
  return sections.map(section => section.titel);
}

function position(orderedTitles, title) {
  const index = orderedTitles.indexOf(title);
  assert.notEqual(index, -1, `missing grammar section: ${title}`);
  return index;
}

test("orders every real grammar section exactly once without mutating the source", () => {
  const original = [...grammar];
  const ordered = orderGrammarSections(grammar);

  assert.notStrictEqual(ordered, grammar);
  assert.deepEqual(grammar, original);
  assert.equal(ordered.length, grammar.length);
  assert.equal(new Set(ordered).size, grammar.length);
  assert.deepEqual(new Set(ordered), new Set(grammar));
});

test("is deterministic and exposes a descriptive sorting alias", () => {
  const first = orderGrammarSections(grammar);
  const second = orderGrammarSections(grammar);

  assert.deepEqual(second, first);
  assert.deepEqual(sortGrammarSections(grammar), first);
});

test("builds the didactic declension and pronoun sequence", () => {
  const ordered = titles(orderGrammarSections(grammar));
  const expected = [
    "a-Deklination – serva, servae f.",
    "o-Deklination – avus und bellum",
    "Konsonantische Deklination – clamor, mater und litus",
    "i-Deklination – civis, navis und mare",
    "u-Deklination – exercitus, manus und cornu",
    "e-Deklination – res, rei f.",
    "Demonstrativpronomen iste, ista, istud",
    "Relativpronomen qui, quae, quod"
  ];

  assert.deepEqual(ordered.slice(0, expected.length), expected);
});

test("keeps tense explanations and their esse-posse-ire forms together", () => {
  const ordered = titles(orderGrammarSections(grammar));
  const adjacentPairs = [
    ["Imperfekt Aktiv", "Imperfekt von esse, posse und ire"],
    ["Futur I Aktiv", "Futur I von esse, posse und ire"],
    ["Perfekt, Plusquamperfekt und Futur II Aktiv", "Perfekt von esse, posse und ire"],
    ["Passiv: Präsens, Imperfekt und Futur I", "Passiv: Perfekt, Plusquamperfekt und Futur II"],
    ["Konjunktiv Plusquamperfekt Aktiv", "Konjunktiv Plusquamperfekt Passiv"],
    ["AcI und NcI", "Ablativus absolutus"]
  ];

  for (const [first, second] of adjacentPairs) {
    assert.equal(position(ordered, second), position(ordered, first) + 1, `${first} should be immediately before ${second}`);
  }

  assert.ok(position(ordered, "Präsens von esse, posse und ire") < position(ordered, "Imperfekt Aktiv"));
  assert.ok(position(ordered, "Imperfekt von esse, posse und ire") < position(ordered, "Futur I Aktiv"));
  assert.ok(position(ordered, "Futur I von esse, posse und ire") < position(ordered, "Perfekt, Plusquamperfekt und Futur II Aktiv"));
  assert.ok(position(ordered, "Perfekt von esse, posse und ire") < position(ordered, "Plusquamperfekt von esse, posse und ire"));
  assert.ok(position(ordered, "Plusquamperfekt von esse, posse und ire") < position(ordered, "Futur II von esse, posse und ire"));
  assert.ok(position(ordered, "Futur II von esse, posse und ire") < position(ordered, "velle"));
});

test("orders subjunctives, participles and remaining rules by learning progression", () => {
  const ordered = titles(orderGrammarSections(grammar));
  const subsequence = [
    "Konjunktiv Präsens Aktiv und Passiv",
    "Konjunktiv Imperfekt Aktiv und Passiv",
    "Konjunktiv Perfekt Aktiv und Passiv",
    "Konjunktiv Plusquamperfekt Aktiv",
    "Konjunktiv Plusquamperfekt Passiv",
    "Partizipien Überblick",
    "PPA und seine Übersetzung",
    "PPP Bildung und Verwendung",
    "PFA und Infinitiv Futur Aktiv",
    "Gerundium und Gerundivum",
    "AcI und NcI",
    "Ablativus absolutus",
    "Adverbien der i-Deklination",
    "Steigerung von Adjektiven und Adverbien"
  ];

  const positions = subsequence.map(title => position(ordered, title));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test("future individual irregular-verb sections stay in esse-posse-ire order", () => {
  const sample = [
    { typ: "regel", titel: "Unbekannte Regel A" },
    { typ: "konjugation", titel: "Präsens von ire" },
    { typ: "konjugation", titel: "Präsens von posse" },
    { typ: "konjugation", titel: "Präsens von esse" },
    { typ: "regel", titel: "Unbekannte Regel B" }
  ];

  assert.deepEqual(titles(orderGrammarSections(sample)), [
    "Präsens von esse",
    "Präsens von posse",
    "Präsens von ire",
    "Unbekannte Regel A",
    "Unbekannte Regel B"
  ]);
});

test("keeps unknown and duplicate entries stable and lossless", () => {
  const duplicate = { typ: "neu", titel: "Noch unbekannt" };
  const first = { typ: "neu", titel: "Zukünftiges Thema Z" };
  const second = { typ: "neu", titel: "Zukünftiges Thema A" };
  const input = [first, duplicate, second, duplicate];
  const ordered = orderGrammarSections(input);

  assert.deepEqual(ordered, input);
  assert.strictEqual(ordered[1], duplicate);
  assert.strictEqual(ordered[3], duplicate);
});

test("rejects non-array input instead of silently dropping grammar data", () => {
  assert.throws(() => orderGrammarSections(null), /sections must be an array/);
});

test("assigns overlapping titles to the pedagogically correct category", () => {
  const byTitle = new Map(grammar.map(section => [section.titel, section]));
  assert.equal(grammarCategory(byTitle.get("Präsens von esse, posse und ire")), "konjugationen");
  assert.equal(grammarCategory(byTitle.get("Imperfekt Aktiv")), "tempora");
  assert.equal(grammarCategory(byTitle.get("Adverbien der i-Deklination")), "regeln");
  assert.equal(grammarCategory(byTitle.get("Relativpronomen qui, quae, quod")), "pronomen");
  assert.equal(grammarCategory(byTitle.get("PFA und Infinitiv Futur Aktiv")), "partizipien");
  assert.equal(grammarCategory(byTitle.get("Konjunktiv Imperfekt Aktiv und Passiv")), "konjugationen");
});
