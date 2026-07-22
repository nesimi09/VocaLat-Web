import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBookText, answerMatches, answerOptionState, selectPracticeVocabulary, shuffledUniqueMeanings } from "../learning-engine.js";
import { cleanOcrText } from "../ocr.js";

const vocabulary = [
  { lektion: 1, latein: "familia", grammatik: "familiae f.", deutsch: "die Hausgemeinschaft" },
  { lektion: 2, latein: "non debere", grammatik: "", deutsch: "nicht dürfen" },
  { lektion: 3, latein: "cum", grammatik: "Präp. + Abl.", deutsch: "mit" },
  { lektion: 5, latein: "cum", grammatik: "Subjunktion", deutsch: "als, weil" }
];

test("typed answers use the same normalization behavior as iOS", () => {
  assert.equal(answerMatches("Laerm", "der Lärm, das Getöse"), true);
  assert.equal(answerMatches("hausgemeinschaft", "die Hausgemeinschaft"), true);
  assert.equal(answerMatches("a", "der Lärm, das Getöse"), false);
  assert.equal(answerMatches("der", "der Lärm, das Getöse"), false);
  assert.equal(answerMatches("get", "der Lärm, das Getöse"), false);
  assert.equal(answerMatches("", "die Hausgemeinschaft"), false);
});

test("multiple-choice meanings are unique and contain the answer once", () => {
  const entry = { latein: "a", deutsch: "eins" };
  const entries = [entry, { deutsch: "zwei" }, { deutsch: "zwei" }, { deutsch: "drei" }, { deutsch: "vier" }, { deutsch: "fünf" }];
  const choices = shuffledUniqueMeanings(entry, entries, () => 0.42);
  assert.equal(choices.length, 4);
  assert.equal(new Set(choices).size, 4);
  assert.equal(choices.filter(choice => choice === entry.deutsch).length, 1);
});

test("answer colors leave neutral choices unchanged", () => {
  assert.equal(answerOptionState("richtig", "richtig", "richtig", true), "correct");
  assert.equal(answerOptionState("falsch", "richtig", "falsch", true), "wrong");
  assert.equal(answerOptionState("neutral", "richtig", "falsch", true), "idle");
  assert.equal(answerOptionState("richtig", "richtig", null, false), "idle");
});

test("practice vocabulary combines exactly the selected lessons", () => {
  assert.deepEqual(selectPracticeVocabulary(vocabulary, "all"), vocabulary);
  assert.deepEqual(selectPracticeVocabulary(vocabulary, [1, "3"]), [vocabulary[0], vocabulary[2]]);
  assert.deepEqual(selectPracticeVocabulary(vocabulary, [3, 99, 3]), [vocabulary[2]]);
  assert.deepEqual(selectPracticeVocabulary(vocabulary, []), []);
  assert.deepEqual(selectPracticeVocabulary(vocabulary, null), []);
  assert.deepEqual(selectPracticeVocabulary(null, "all"), []);
});

test("book analysis keeps tokens independent and fails closed for unknown words", () => {
  const result = analyzeBookText("familia non debere ignotus", vocabulary, [], 2);
  assert.equal(result.tokenCount, 4);
  assert.equal(result.coveredWords, 1);
  assert.equal(result.draft, "die Hausgemeinschaft · [non] · [debere] · [ignotus]");
  assert.deepEqual(result.matches.map(match => match.length), [1, 1, 1, 1]);
  assert.equal(result.matches.at(-1).status, "unknown");
});

test("lesson scope excludes later textbook meanings", () => {
  const early = analyzeBookText("cum", vocabulary, [], 3);
  const all = analyzeBookText("cum", vocabulary, [], 5);
  assert.equal(early.matches[0].status, "exact");
  assert.equal(early.matches[0].entries[0].deutsch, "mit");
  assert.equal(all.matches[0].status, "ambiguous");
  assert.equal(all.draft, "mit");
});

test("known inflected forms resolve to their textbook lemma", () => {
  const result = analyzeBookText("familiae", vocabulary, [], 1);
  assert.equal(result.matches[0].status, "book-form");
  assert.equal(result.draft, "die Hausgemeinschaft");
});

test("the reported OCR example is normalized, parsed and translated", () => {
  const book = [
    { lektion: 5, latein: "pulcher", grammatik: "pulchra, pulchrum", deutsch: "schön" },
    { lektion: 17, latein: "comes", grammatik: "comitis m.", deutsch: "der Begleiter" },
    { lektion: 12, latein: "iter", grammatik: "itineris n.", deutsch: "der Weg, der Marsch" },
    { lektion: 21, latein: "pergere", grammatik: "pergo, perrexi", deutsch: "weitergehen" },
    { lektion: 11, latein: "cupere", grammatik: "cupio, cupivi", deutsch: "wollen, wünschen" },
    { lektion: 11, latein: "periculum", grammatik: "periculi n.", deutsch: "die Gefahr" },
    { lektion: 18, latein: "instare", grammatik: "insto, institi", deutsch: "bevorstehen, drohen" }
  ];
  const fallback = [
    { lemma: "Siren", forms: ["Siren", "Sirenis"], pos: "n", meanings: ["die Sirene"] },
    { lemma: "canto", forms: ["canto", "cantare"], pos: "v", meanings: ["singen"] },
    { lemma: "iterum", forms: ["iterum"], pos: "adv", meanings: ["wieder"] }
  ];
  const grammar = [{ titel: "PPA und seine Übersetzung" }, { titel: "Ablativus absolutus" }];
  const result = analyzeBookText("1. Sirénibus pulchre cantantibus\n2. Comitibus iter pergere cupientibus\n3. Periculis iterum iterumque instantibus", book, grammar, null, fallback);
  assert.equal(result.coverage, 100);
  assert.equal(result.correctedText.split("\n")[0], "Sirenibus pulchre cantantibus");
  const translated = result.translation.split("\n");
  assert.equal(translated.length, 3);
  assert.match(translated[0], /Sirenen.+schön.+singen/iu);
  assert.match(translated[1], /Begleiter.+Weg.+(?:wollen|wünschen)/iu);
  assert.match(translated[2], /Gefahr.+immer wieder.+(?:drohen|bevorstehen)/iu);
  assert.doesNotMatch(result.translation, /\s·\s|\[[^\]]+\]/u);
});

test("one omitted OCR letter is repaired from known Latin forms", () => {
  const fallback = [{ lemma: "canto", forms: ["canto", "cantare"], pos: "v", meanings: ["singen"] }];
  const result = analyzeBookText("cantantibs", [], [], null, fallback);
  assert.equal(result.matches[0].status, "corrected");
  assert.equal(result.matches[0].canonicalForm, "cantantibus");

  const missingFirstLetter = analyzeBookText("antantibus", [], [], null, fallback);
  assert.equal(missingFirstLetter.matches[0].status, "corrected");
  assert.equal(missingFirstLetter.matches[0].canonicalForm, "cantantibus");
});

test("a unique common OCR letter confusion is repaired", () => {
  const fallback = [{ lemma: "canto", forms: ["canto", "cantare"], pos: "v", meanings: ["singen"] }];
  const result = analyzeBookText("cantantibvs", [], [], null, fallback);
  assert.equal(result.matches[0].status, "corrected");
  assert.equal(result.matches[0].canonicalForm, "cantantibus");
});

test("same-length valid-looking words are never silently autocorrected", () => {
  const book = [{ lektion: 1, latein: "venia", grammatik: "veniae f.", deutsch: "die Verzeihung" }];
  const result = analyzeBookText("venit", book, [], null, []);
  assert.notEqual(result.matches[0].status, "corrected");
  assert.equal(result.correctedText, "venit");
});

test("a regular subject-object-verb sentence is reordered and inflected in German", () => {
  const fallback = [
    { lemma: "puella", forms: ["puella", "puellae"], pos: "n", meanings: ["Mädchen"] },
    { lemma: "rosa", forms: ["rosa", "rosae"], pos: "n", meanings: ["Rose"] },
    { lemma: "amo", forms: ["amo", "amare"], pos: "v", meanings: ["mögen", "lieben"] }
  ];
  const result = analyzeBookText("Puella rosam amat.", [], [], null, fallback);
  assert.equal(result.coverage, 100);
  assert.equal(result.translation, "Das Mädchen liebt die Rose.");
  assert.equal(result.grammar.find(rule => rule.title === "Präsens Aktiv")?.generated, true);
});

test("wrapped prose is joined but separate sentences stay separate", () => {
  const fallback = [
    { lemma: "puella", forms: ["puella", "puellae"], pos: "n", meanings: ["Mädchen"] },
    { lemma: "rosa", forms: ["rosa", "rosae"], pos: "n", meanings: ["Rose"] },
    { lemma: "amo", forms: ["amo", "amare"], pos: "v", meanings: ["lieben"] }
  ];
  const result = analyzeBookText("Puella rosam\namat. Puella rosam amat.", [], [], null, fallback);
  assert.equal(result.translation, "Das Mädchen liebt die Rose.\nDas Mädchen liebt die Rose.");
});

test("forms explicitly stored in grammar tables link to the matching rule", () => {
  const grammar = [{ titel: "Präsens von esse, posse und ire", typ: "konjugation", formen: [{ person: "1. Sg.", esse: "sum" }] }];
  const result = analyzeBookText("sum", [], grammar, null);
  assert.equal(result.grammar[0].title, grammar[0].titel);
});

test("missing grammar explanations are generated locally", () => {
  const fallback = [{ lemma: "canto", forms: ["canto", "cantare"], pos: "v", meanings: ["singen"] }];
  const result = analyzeBookText("cantantibus", [], [], null, fallback);
  assert.equal(result.grammar[0].title, "PPA und seine Übersetzung");
  assert.equal(result.grammar[0].generated, true);
  assert.equal(result.grammar[0].index, null);
});

test("morphological lemmas beat unrelated homographs and generated book forms", () => {
  const vocabulary = [{ lektion: 1, latein: "mos", grammatik: "moris m.", deutsch: "die Sitte" }];
  const fallback = [
    { lemma: "rogatus", forms: ["rogatus", "rogati"], pos: "n", meanings: ["Frage"] },
    { lemma: "rogo", forms: ["rogo", "rogare"], pos: "v", meanings: ["bitten"] },
    { lemma: "morior", forms: ["morior", "mori"], pos: "v", meanings: ["sterben"] }
  ];
  const morphology = new Map([
    ["rogatus", [{ forms: ["rogo", "rogare", "rogatus"], morphology: { part: "ppa", tense: "perfect", voice: "passive" } }]],
    ["moriens", [{ forms: ["morior", "mori"], morphology: { part: "ppa", tense: "present", voice: "active" } }]]
  ]);
  const result = analyzeBookText("rogatus moriens", vocabulary, [], null, fallback, morphology);
  assert.equal(result.matches[0].entries[0].lemma, "rogo");
  assert.equal(result.matches[1].entries[0].lemma, "morior");
});

test("sentence case and dictionary proper-name context disambiguate avum, Aulum and servos", () => {
  const book = [{ lektion: 14, latein: "avis", grammatik: "avis f.; Gen. Pl. avium", deutsch: "der Vogel" }];
  const fallback = [
    { lemma: "avus", forms: ["avus", "avi"], pos: "n", meanings: ["Großvater"] },
    { lemma: "ave", forms: ["ave"], pos: "int", meanings: ["sei gegrüßt"] },
    { lemma: "salve", forms: ["salve"], pos: "int", meanings: ["sei gegrüßt"] },
    { lemma: "aula", forms: ["aula", "aulae"], pos: "n", meanings: ["Palast"] },
    { lemma: "servus", forms: ["servus", "serva", "servum"], pos: "adj", meanings: ["dienend"] },
    { lemma: "servus", forms: ["servus", "servi"], pos: "n", meanings: ["Sklave"] }
  ];
  const morphology = new Map([
    ["familia", [{ citation: "familia, familiae N", forms: ["familia"], morphology: { part: "n", case: "nominative", number: "singular" } }]],
    ["avum", [
      { citation: "avus, avi N", forms: ["avus", "avi"], morphology: { part: "n", case: "accusative", number: "singular" } },
      { citation: "avis, avis N", forms: ["avis"], morphology: { part: "n", case: "genitive", number: "plural" } }
    ]],
    ["exspectat", [{ citation: "exspecto V", forms: ["exspecto", "exspectare"], morphology: { part: "v", mood: "indicative", person: 3, number: "singular" } }]],
    ["cornelia", [{ citation: "Cornelia, Corneliae N", forms: ["cornelia"], morphology: { part: "n", case: "nominative", number: "singular" } }]],
    ["aulum", [
      { citation: "aula, aulae N", forms: ["aula", "aulae"], morphology: { part: "n", case: "genitive", number: "plural" } },
      { citation: "Aulus, Auli N", forms: ["aulus", "auli"], morphology: { part: "n", case: "accusative", number: "singular" } }
    ]],
    ["quaerit", [{ citation: "quaero V", forms: ["quaero", "quaerere"], morphology: { part: "v", mood: "indicative", person: 3, number: "singular" } }]],
    ["domina", [{ citation: "domina, dominae N", forms: ["domina"], morphology: { part: "n", case: "nominative", number: "singular" } }]],
    ["servos", [{ citation: "servus, servi N", forms: ["servus", "servi"], morphology: { part: "n", case: "accusative", number: "plural" } }]],
    ["vocat", [{ citation: "voco V", forms: ["voco", "vocare"], morphology: { part: "v", mood: "indicative", person: 3, number: "singular" } }]],
    ["ave", [
      { citation: "avus, avi N", forms: ["avus", "avi"], morphology: { part: "n", case: "vocative", number: "singular" } },
      { citation: "avis, avis N", forms: ["avis"], morphology: { part: "n", case: "ablative", number: "singular" } },
      { citation: "ave INTERJ", forms: ["ave"], morphology: { part: "int" } }
    ]]
  ]);
  const result = analyzeBookText("Familia avum exspectat. Cornelia Aulum quaerit. Domina servos vocat. Salve, ave.", book, [], null, fallback, morphology);
  assert.deepEqual(new Set(result.matches.find(match => match.normalized === "avum").entries.map(entry => entry.lemma)), new Set(["avis", "avus"]));
  assert.equal(result.matches.find(match => match.normalized === "avum").morphology.some(item => item.case === "accusative"), true);
  assert.equal(result.matches.find(match => match.normalized === "aulum").entries.some(entry => entry.lemma === "Aulus"), true);
  assert.equal(result.matches.find(match => match.normalized === "aulum").status, "proper");
  assert.equal(result.matches.find(match => match.normalized === "aulum").morphology.some(item => item.case === "genitive"), true);
  assert.equal(result.matches.find(match => match.normalized === "servos").entries.some(entry => entry.deutsch === "Sklave"), true);
  assert.deepEqual(new Set(result.matches.find(match => match.normalized === "ave").entries.map(entry => entry.lemma)), new Set(["avis", "avus", "ave"]));
});

test("page glossary and proper names resolve before generic fallbacks", () => {
  const fallback = [
    { lemma: "philtrum", forms: ["philtrum"], pos: "n", meanings: ["Filter"] },
    { lemma: "philtrum", forms: ["philtrum"], pos: "n", meanings: ["Liebestrank"], source: "glossary" }
  ];
  const result = analyzeBookText("Nessus philtrum Deianirae Nessum", [], [], null, fallback);
  assert.equal(result.matches[0].status, "proper");
  assert.equal(result.matches[1].status, "ambiguous");
  assert.equal(result.matches[1].entries[0].deutsch, "Liebestrank");
  assert.equal(result.matches[1].entries[0].source, "glossary");
  assert.equal(result.matches[2].entries[0].lemma, "Deianira");
  assert.equal(result.matches[3].entries[0].lemma, "Nessus");
});

test("translation is derived from the supplied lexical evidence at runtime", () => {
  const morphology = new Map([
    ["nauta", [{ forms: ["nauta"], morphology: { part: "n", case: "nominative", number: "singular", gender: "m" } }]],
    ["puellam", [{ forms: ["puella"], morphology: { part: "n", case: "accusative", number: "singular", gender: "f" } }]],
    ["vocat", [{ forms: ["voco"], morphology: { part: "v", mood: "indicative", tense: "present", voice: "active", person: 3, number: "singular" } }]]
  ]);
  const base = [
    { lemma: "nauta", forms: ["nauta", "nautae"], pos: "n", meanings: ["Seemann"] },
    { lemma: "puella", forms: ["puella", "puellae"], pos: "n", meanings: ["Mädchen"] },
    { lemma: "voco", forms: ["voco", "vocare"], pos: "v", meanings: ["rufen"] }
  ];
  const changed = base.map(entry => entry.lemma === "nauta" ? { ...entry, meanings: ["Matrose"] } : entry);
  const first = analyzeBookText("Nauta puellam vocat.", [], [], null, base, morphology);
  const second = analyzeBookText("Nauta puellam vocat.", [], [], null, changed, morphology);

  assert.match(first.translation, /Seemann/);
  assert.match(second.translation, /Matrose/);
  assert.notEqual(first.translation, second.translation);
  assert.equal(Object.hasOwn(first, "translationVerified"), false);
  assert.equal(Object.hasOwn(first, "verifiedLines"), false);
});

test("resolved complex prose is rendered as a sentence without needing translation memory", () => {
  const fallback = [
    { lemma: "puella", forms: ["puella", "puellae"], pos: "n", meanings: ["Mädchen"] },
    { lemma: "amo", forms: ["amo", "amare"], pos: "v", meanings: ["lieben"] },
    { lemma: "venio", forms: ["venio", "venire"], pos: "v", meanings: ["kommen"] },
    { lemma: "cum", forms: ["cum"], pos: "conj", meanings: ["als"] }
  ];
  const morphology = new Map([
    ["puella", [{ forms: ["puella"], morphology: { part: "n", case: "nominative", number: "singular" } }]],
    ["amat", [{ forms: ["amo"], morphology: { part: "v", mood: "indicative", tense: "present", voice: "active", person: 3, number: "singular" } }]],
    ["venit", [{ forms: ["venio"], morphology: { part: "v", mood: "indicative", tense: "present", voice: "active", person: 3, number: "singular" } }]]
  ]);
  const result = analyzeBookText("Cum puella venit, amat.", [], [], null, fallback, morphology);
  assert.equal(result.translationReliable, true);
  assert.match(result.translation, /^Als .*kommt,/);
  assert.doesNotMatch(result.translation, / · |\[[^\]]+\]/);
  assert.equal(Object.hasOwn(result, "translationVerified"), false);
});

test("OCR cleanup joins line-break hyphenation without changing paragraphs", () => {
  assert.equal(cleanOcrText("Ami-\n cus   venit.\n\n\nSalve!"), "Amicus venit.\n\nSalve!");
});
