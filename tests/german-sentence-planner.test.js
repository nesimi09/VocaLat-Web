import test from "node:test";
import assert from "node:assert/strict";
import { conjugateGerman, generateGermanSentence, postprocessGerman } from "../german-generator.js";
import { translateLatinSyntax } from "../latin-syntax-translator.js";

const entry = (lemma, deutsch, pos = "n") => ({
  lemma,
  latein: lemma,
  deutsch,
  meanings: [deutsch],
  pos,
  source: "fallback"
});

function word(token, lexicalEntry, morphology) {
  return {
    token,
    normalized: token.toLocaleLowerCase("la"),
    status: "fallback",
    entries: [lexicalEntry],
    morphology: [morphology],
    morphologyCandidates: [{ entry: lexicalEntry, morphology }],
    length: 1
  };
}

const noun = (token, lemma, deutsch, grammaticalCase, number = "singular", gender = "m") =>
  word(token, entry(lemma, deutsch), { part: "n", case: grammaticalCase, number, gender });

const proper = token => word(token, { ...entry(token, token, "proper"), source: "proper-context" }, { part: "proper", case: "nominative", number: "singular", gender: "m" });

const adjective = (token, lemma, deutsch, grammaticalCase, number = "singular", gender = "m", extra = {}) =>
  word(token, entry(lemma, deutsch, "adj"), { part: "adj", case: grammaticalCase, number, gender, ...extra });

const pronoun = (token, lemma, deutsch, grammaticalCase, number = "singular", gender = "m", extra = {}) =>
  word(token, entry(lemma, deutsch, "pron"), { part: "pron", case: grammaticalCase, number, gender, ...extra });

const finite = (token, lemma, deutsch, tense = "present", person = 3, number = "singular", extra = {}) =>
  word(token, entry(lemma, deutsch, "v"), { part: "v", tense, mood: "indicative", voice: "active", person, number, ...extra });

const infinitive = (token, lemma, deutsch, tense = "present", voice = "active") =>
  word(token, entry(lemma, deutsch, "v"), { part: "v", tense, mood: "infinitive", voice });

const particle = (token, pos, deutsch = token) => word(token, entry(token.toLocaleLowerCase("la"), deutsch, pos), { part: pos });

const translate = (words, source = "") => translateLatinSyntax(words, { source }).text;

test("German field order is stable across Latin permutations", () => {
  const forms = {
    subject: noun("servus", "servus", "der Sklave", "nominative"),
    indirect: noun("puellae", "puella", "das Mädchen", "dative", "singular", "f"),
    direct: noun("rosam", "rosa", "die Rose", "accusative", "singular", "f"),
    verb: finite("dat", "do", "geben")
  };
  const variants = [
    [forms.subject, forms.indirect, forms.direct, forms.verb],
    [forms.direct, forms.subject, forms.indirect, forms.verb],
    [forms.indirect, forms.verb, forms.subject, forms.direct],
    [forms.verb, forms.direct, forms.indirect, forms.subject]
  ];
  assert.deepEqual(variants.map(words => translate(words)), Array(4).fill("Der Sklave gibt dem Mädchen die Rose."));
});

test("German TeKaMoLo ordering replaces the order of Latin prepositional phrases", () => {
  const subject = noun("puella", "puella", "das Mädchen", "nominative", "singular", "f");
  const companion = noun("amico", "amicus", "der Freund", "ablative");
  const destination = noun("villam", "villa", "das Landhaus", "accusative", "singular", "f");
  const verb = finite("currit", "curro", "laufen");
  const cum = particle("cum", "prep", "mit");
  const ad = particle("ad", "prep", "zu");
  const first = translate([subject, cum, companion, ad, destination, verb]);
  const second = translate([ad, destination, subject, cum, companion, verb]);
  assert.equal(first, "Das Mädchen läuft mit dem Freund zum Landhaus.");
  assert.equal(second, first);
});

test("negation precedes German predicate complements", () => {
  const result = translate([
    noun("puella", "puella", "das Mädchen", "nominative", "singular", "f"),
    adjective("magna", "magnus", "groß", "nominative", "singular", "f"),
    particle("non", "adv", "nicht"),
    finite("est", "sum", "sein")
  ]);
  assert.equal(result, "Das Mädchen ist nicht groß.");
});

test("polar questions use German verb-first order", () => {
  const result = translate([
    noun("puer", "puer", "das Kind", "nominative", "singular", "m"),
    finite("laborat", "laboro", "arbeiten")
  ], "Puer laborat?");
  assert.equal(result, "Arbeitet das Kind?");
});

test("passive and perfect modal infinitives form a German right bracket", () => {
  const passive = translate([
    noun("liber", "liber", "das Buch", "nominative", "singular", "m"),
    infinitive("legi", "lego", "lesen", "present", "passive"),
    finite("potest", "possum", "können")
  ]);
  assert.equal(passive, "Das Buch kann gelesen werden.");

  const perfect = translate([
    noun("puer", "puer", "das Kind", "nominative", "singular", "m"),
    noun("librum", "liber", "das Buch", "accusative", "singular", "m"),
    infinitive("legere", "lego", "lesen"),
    finite("potuit", "possum", "können", "perfect")
  ]);
  assert.equal(perfect, "Das Kind hat das Buch lesen können.");
});

test("future AcI places the finite German verb at the end", () => {
  const result = translate([
    proper("Caesar"),
    finite("dicit", "dico", "sagen"),
    noun("militem", "miles", "der Soldat", "accusative"),
    infinitive("venturum", "venio", "kommen", "future")
  ]);
  assert.equal(result, "Caesar sagt, dass der Soldat kommen wird.");
});

test("German articles and adjective endings follow determiner class and case", () => {
  const semanticWord = (raw, lemma, sense, morphology, index, source = "fallback") => ({
    raw, token: raw, normalized: raw.toLocaleLowerCase("la"), lemma, sense, morphology, index,
    entry: { ...entry(lemma, sense, morphology.part), source }
  });
  const predicateWords = [
    semanticWord("Marcus", "Marcus", "Marcus", { part: "proper", case: "nominative", number: "singular", gender: "m" }, 0, "proper-context"),
    semanticWord("bonus", "bonus", "gut", { part: "adj", case: "nominative", number: "singular", gender: "m" }, 1),
    semanticWord("vir", "vir", "der Mann", { part: "n", case: "nominative", number: "singular", gender: "m" }, 2),
    semanticWord("est", "sum", "sein", { part: "v", tense: "present", mood: "indicative", voice: "active", person: 3, number: "singular" }, 3)
  ];
  const predicate = postprocessGerman(generateGermanSentence({
    words: predicateWords,
    type: "sentence",
    clauses: [{
      id: "c0", type: "main", marker: null, markerIndex: null, headIndex: 3,
      tokenIndexes: [0, 1, 2, 3],
      roles: { subject: [0], directObject: [], indirectObject: [], genitive: [], ablative: [], prepositional: [], predicates: [3], adverbial: [], vocative: [] }
    }],
    dependencies: [{ type: "attribute", headIndex: 2, dependentIndex: 1 }],
    constructions: []
  }));
  assert.equal(predicate, "Marcus ist ein guter Mann.");

  const renderObject = modifiers => {
    const words = [
      semanticWord("Marcus", "Marcus", "Marcus", { part: "proper", case: "nominative", number: "singular", gender: "m" }, 0, "proper-context"),
      ...modifiers.map((modifier, offset) => ({ ...modifier, index: offset + 1 })),
      semanticWord("amicum", "amicus", "der Freund", { part: "n", case: "accusative", number: "singular", gender: "m" }, modifiers.length + 1),
      semanticWord("videt", "video", "sehen", { part: "v", tense: "present", mood: "indicative", voice: "active", person: 3, number: "singular" }, modifiers.length + 2)
    ];
    const objectIndex = modifiers.length + 1;
    const verbIndex = modifiers.length + 2;
    return postprocessGerman(generateGermanSentence({
      words,
      type: "sentence",
      clauses: [{
        id: "c0", type: "main", marker: null, markerIndex: null, headIndex: verbIndex,
        tokenIndexes: words.map(item => item.index),
        roles: { subject: [0], directObject: [objectIndex], indirectObject: [], genitive: [], ablative: [], prepositional: [], predicates: [verbIndex], adverbial: [], vocative: [] }
      }],
      dependencies: modifiers.map((_, offset) => ({ type: "attribute", headIndex: objectIndex, dependentIndex: offset + 1 })),
      constructions: []
    }));
  };
  const possessive = renderObject([
    semanticWord("bonum", "bonus", "gut", { part: "adj", case: "accusative", number: "singular", gender: "m" }, 1),
    semanticWord("suum", "suus", "sein", { part: "adj", case: "accusative", number: "singular", gender: "m" }, 2)
  ]);
  assert.equal(possessive, "Marcus sieht seinen guten Freund.");

  const definite = renderObject([
    semanticWord("bonum", "bonus", "gut", { part: "adj", case: "accusative", number: "singular", gender: "m" }, 1)
  ]);
  assert.equal(definite, "Marcus sieht den guten Freund.");

  const demonstrative = renderObject([
    semanticWord("hunc", "hic", "dieser", { part: "pron", case: "accusative", number: "singular", gender: "m", pronounKind: "demonstrative", adjectivalPronoun: true }, 1),
    semanticWord("bonum", "bonus", "gut", { part: "adj", case: "accusative", number: "singular", gender: "m" }, 2)
  ]);
  assert.equal(demonstrative, "Marcus sieht diesen guten Freund.");
});

test("frequent strong German verbs use their real paradigms", () => {
  assert.equal(conjugateGerman("tragen", { person: 3, number: "singular" }), "trägt");
  assert.equal(conjugateGerman("fahren", { person: 2, number: "singular" }), "fährst");
  assert.equal(conjugateGerman("helfen", { person: 3, number: "singular" }, "imperfect"), "half");
});

test("coordinate clauses preserve each connector and German punctuation", () => {
  const sharedSubject = translate([
    noun("puella", "puella", "das Mädchen", "nominative", "singular", "f"),
    finite("legit", "lego", "lesen"),
    particle("et", "conj", "und"),
    finite("scribit", "scribo", "schreiben")
  ]);
  assert.equal(sharedSubject, "Das Mädchen liest und schreibt.");

  const contrast = translate([
    noun("puella", "puella", "das Mädchen", "nominative", "singular", "f"),
    finite("legit", "lego", "lesen"),
    particle("sed", "conj", "aber"),
    noun("puer", "puer", "das Kind", "nominative"),
    finite("scribit", "scribo", "schreiben")
  ]);
  assert.equal(contrast, "Das Mädchen liest, aber das Kind schreibt.");
});

test("data-driven idioms consume their lexical object without depending on Latin order", () => {
  const caesar = proper("Caesar");
  const war = noun("bellum", "bellum", "der Krieg", "accusative", "singular", "n");
  const wage = finite("gerit", "gero", "führen");
  assert.equal(translate([caesar, war, wage]), "Caesar führt Krieg.");
  assert.equal(translate([war, caesar, wage]), "Caesar führt Krieg.");
});
