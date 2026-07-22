import test from "node:test";
import assert from "node:assert/strict";
import { translateLatinSyntax } from "../latin-syntax-translator.js";

const lexeme = (lemma, german, pos = "v") => ({
  lemma,
  latein: lemma,
  deutsch: german,
  meanings: [german],
  pos,
  source: "fallback"
});

function word(token, lemma, german, pos, morphology) {
  const entry = lexeme(lemma, german, pos);
  const analysis = { dictionaryLemma: lemma, ...morphology };
  return {
    token,
    normalized: normalizeLatin(token),
    status: "fallback",
    entries: [entry],
    morphology: [analysis],
    morphologyCandidates: [{ entry, morphology: analysis }],
    length: 1
  };
}

const noun = (token, lemma, german, grammaticalCase, number = "singular", gender = "m") =>
  word(token, lemma, german, "n", { part: "n", case: grammaticalCase, number, gender });

const adjective = (token, lemma, german, grammaticalCase, number = "singular", gender = "m") =>
  word(token, lemma, german, "adj", { part: "adj", case: grammaticalCase, number, gender });

const finite = (token, lemma, german, options = {}) =>
  word(token, lemma, german, "v", {
    part: "v",
    mood: "indicative",
    tense: "present",
    voice: "active",
    person: 3,
    number: "singular",
    ...options
  });

const participle = (token, lemma, german, grammaticalCase, number, gender, tense, voice, options = {}) =>
  word(token, lemma, german, "v", {
    part: "ppa",
    mood: "participle",
    case: grammaticalCase,
    number,
    gender,
    tense,
    voice,
    ...options
  });

const gerund = (token, lemma, german, grammaticalCase) =>
  word(token, lemma, german, "v", {
    part: "gerund",
    nonFinite: "gerund",
    nonFiniteType: "gerund",
    gerundCandidate: true,
    case: grammaticalCase,
    number: "singular",
    gender: "n"
  });

const supine = (token, lemma, german, grammaticalCase, supineUse) =>
  word(token, lemma, german, "v", {
    part: "supine",
    nonFinite: "supine",
    case: grammaticalCase,
    number: "singular",
    gender: "n",
    supineUse
  });

const preposition = (token, german) => word(token, token, german, "prep", { part: "prep" });

function constructionTypes(result) {
  return new Set(result.pipeline.grammar.constructions.map(construction => construction.type));
}

function assertTranslation(result, pattern) {
  assert.match(result.text, pattern, result.text);
  assert.doesNotMatch(result.text, /\[[^\]]+\]|\s·\s/u, result.text);
}

test("oblique gerunds are nominalized according to their case", () => {
  const result = translateLatinSyntax([
    noun("Ars", "ars", "die Kunst", "nominative", "singular", "f"),
    gerund("dicendi", "dico", "sagen", "genitive"),
    adjective("difficilis", "difficilis", "schwierig", "nominative", "singular", "f"),
    finite("est", "sum", "sein")
  ]);

  assert.equal(constructionTypes(result).has("gerund"), true);
  assertTranslation(result, /Kunst.+(?:des Sagens|zu sagen).+schwierig|Kunst.+schwierig.+(?:des Sagens|zu sagen)/iu);
});

test("causa plus a genitive gerund is interpreted as purpose", () => {
  const result = translateLatinSyntax([
    gerund("Legendi", "lego", "lesen", "genitive"),
    noun("causa", "causa", "der Grund", "ablative", "singular", "f"),
    finite("venit", "venio", "kommen", { tense: "perfect" })
  ]);

  assert.equal(constructionTypes(result).has("gerund-purpose"), true);
  assertTranslation(result, /(?:kam|ist gekommen).+um.+zu lesen/iu);
});

test("an agreeing gerundive remains attached to its noun", () => {
  const result = translateLatinSyntax([
    noun("Liber", "liber", "das Buch", "nominative", "singular", "m"),
    participle("legendus", "lego", "lesen", "nominative", "singular", "m", "future", "passive", { gerundiveCandidate: true }),
    finite("iacet", "iaceo", "liegen")
  ]);

  assert.equal(constructionTypes(result).has("gerundive-attributive"), true);
  assertTranslation(result, /(?:zu lesende|das zu lesende).+Buch.+liegt/iu);
});

test("the passive periphrastic expresses obligation and its dative agent", () => {
  const result = translateLatinSyntax([
    noun("Via", "via", "der Weg", "nominative", "singular", "f"),
    noun("militibus", "miles", "der Soldat", "dative", "plural", "m"),
    participle("munienda", "munio", "befestigen", "nominative", "singular", "f", "future", "passive", { gerundiveCandidate: true }),
    finite("est", "sum", "sein")
  ]);

  assert.equal(constructionTypes(result).has("gerundive-obligation"), true);
  assertTranslation(result, /(?:Soldaten.+müssen.+Weg.+befestigen|Weg.+muss.+(?:von den Soldaten|durch die Soldaten).+befestigt werden)/iu);
});

test("an accusative supine after a motion verb expresses purpose", () => {
  const result = translateLatinSyntax([
    noun("Legati", "legatus", "der Gesandte", "nominative", "plural", "m"),
    noun("pacem", "pax", "der Frieden", "accusative", "singular", "f"),
    supine("petitum", "peto", "erbitten", "accusative", "purpose"),
    finite("venerunt", "venio", "kommen", { tense: "perfect", number: "plural" })
  ]);

  assert.equal(constructionTypes(result).has("supine-purpose"), true);
  assertTranslation(result, /Gesandten.+(?:kamen|sind gekommen).+um.+Frieden.+zu erbitten/iu);
});

test("an ablative supine is generated as a specification", () => {
  const result = translateLatinSyntax([
    noun("Hoc", "hic", "dies", "nominative", "singular", "n"),
    adjective("facile", "facilis", "leicht", "nominative", "singular", "n"),
    supine("dictu", "dico", "sagen", "ablative", "specification"),
    finite("est", "sum", "sein")
  ]);

  assert.equal(constructionTypes(result).has("supine-specification"), true);
  assertTranslation(result, /Dies.+(?:ist.+leicht.+zu sagen|ist.+zu sagen.+leicht)/iu);
});

test("present and perfect passive participles keep their agreeing antecedents", () => {
  const present = translateLatinSyntax([
    noun("Puella", "puella", "das Mädchen", "nominative", "singular", "f"),
    participle("cantans", "canto", "singen", "nominative", "singular", "f", "present", "active"),
    finite("venit", "venio", "kommen")
  ]);
  assert.equal(constructionTypes(present).has("present-participle"), true);
  assertTranslation(present, /Mädchen.+(?:das singt|singend).+kommt/iu);

  const perfectPassive = translateLatinSyntax([
    noun("Porta", "porta", "das Tor", "nominative", "singular", "f"),
    preposition("a", "von"),
    noun("militibus", "miles", "der Soldat", "ablative", "plural", "m"),
    participle("clausa", "claudo", "schließen", "nominative", "singular", "f", "perfect", "passive"),
    finite("patet", "pateo", "offen stehen")
  ]);
  assert.equal(constructionTypes(perfectPassive).has("perfect-passive-participle"), true);
  assertTranslation(perfectPassive, /Tor.+(?:das.+(?:von den Soldaten|durch die Soldaten).+geschlossen wurde|von den Soldaten geschlossen).+steht offen/iu);
});

test("perfect deponents retain active meaning with esse", () => {
  const result = translateLatinSyntax([
    noun("Senator", "senator", "der Senator", "nominative", "singular", "m"),
    participle("profectus", "proficiscor", "aufbrechen", "nominative", "singular", "m", "perfect", "passive", {
      deponent: true,
      lexicalVoice: "deponent",
      verbClass: "deponent"
    }),
    finite("est", "sum", "sein")
  ]);

  assert.equal(constructionTypes(result).has("perfect-passive"), true);
  assertTranslation(result, /Senator.+(?:ist aufgebrochen|brach auf)/iu);
  assert.doesNotMatch(result.text, /wurde|worden/iu);
});

function normalizeLatin(value) {
  return String(value)
    .normalize("NFD")
    .toLocaleLowerCase("la")
    .replace(/\p{M}/gu, "")
    .replaceAll("j", "i")
    .replace(/[^a-z]/g, "");
}
