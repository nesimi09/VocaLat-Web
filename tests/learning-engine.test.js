import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeBookText, answerMatches, answerOptionState, shuffledUniqueMeanings } from "../learning-engine.js";
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

test("book analysis resolves phrases and fails closed for unknown words", () => {
  const result = analyzeBookText("familia non debere ignotus", vocabulary, [], 2);
  assert.equal(result.tokenCount, 4);
  assert.equal(result.coveredWords, 3);
  assert.equal(result.draft, "die Hausgemeinschaft · nicht dürfen · [ignotus]");
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
  assert.equal(result.translation, "Während die Sirenen schön singen.\nWährend die Begleiter den Weg fortsetzen wollen.\nWährend die Gefahren immer wieder drohen.");
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

test("page glossary and proper names resolve before generic fallbacks", () => {
  const fallback = [
    { lemma: "philtrum", forms: ["philtrum"], pos: "n", meanings: ["Filter"] },
    { lemma: "philtrum", forms: ["philtrum"], pos: "n", meanings: ["Liebestrank"], source: "glossary" }
  ];
  const result = analyzeBookText("Nessus philtrum Deianirae Nessum", [], [], null, fallback);
  assert.equal(result.matches[0].status, "proper");
  assert.equal(result.matches[1].status, "contextual");
  assert.equal(result.matches[1].entries[0].deutsch, "Liebestrank");
  assert.equal(result.matches[2].entries[0].lemma, "Deianira");
  assert.equal(result.matches[3].entries[0].lemma, "Nessus");
});

test("verified complex passages replace word salad and tolerate a small OCR error", () => {
  const memory = JSON.parse(readFileSync(new URL("../data/translation-memory.json", import.meta.url), "utf8")).entries;
  const text = "Nessus centaurus rogats est ab Deianira, ut se flumen Euhenum transferret: quam sublatam in flumine ipso violare voluit. Hoc Hercules cum intervenisset et Deianira cum fidem eius imploravisset, Nessum sagittis confixit. Ille moriens, cum sciret sagittas hydrae veneno tinctas quantam vim veneni habere, sanguinem suum exceptum Deianirae dedit et id philtrum esse dixit; si vellet, ne se coniunx sperneret, eo iuberet se vestem eius attrahere. Id Deianira credens conditum diligenter servavit.";
  const result = analyzeBookText(text, [], [], null, [], new Map(), memory);
  assert.equal(result.translationVerified, true);
  assert.equal(result.verifiedLines, 5);
  assert.match(result.translation, /^Der Zentaur Nessus wurde von Deianira gebeten/);
  assert.match(result.translation, /durchbohrte er Nessus mit Pfeilen/);
  assert.match(result.translation, /Deianira glaubte dies und bewahrte es, nachdem sie es versteckt hatte, sorgfältig auf\.$/);
  assert.doesNotMatch(result.translation, /\[[^\]]+\]|Frage es gibt|die Sitte/);
});

test("OCR cleanup joins line-break hyphenation without changing paragraphs", () => {
  assert.equal(cleanOcrText("Ami-\n cus   venit.\n\n\nSalve!"), "Amicus venit.\n\nSalve!");
});
