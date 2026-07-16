import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { WordsEngine } from "../vendor/whitakers/whitakers-words.js";
import { analyzeLatinMorphologyWithEngine } from "../morphology.js";
import { analyzeBookText } from "../learning-engine.js";

const readText = path => readFileSync(new URL(path, import.meta.url), "utf8");
const vocabulary = JSON.parse(readText("../data/vocabulary.json"));
const grammar = JSON.parse(readText("../data/grammar.json")).abschnitte;
const fallback = JSON.parse(readText("../data/fallback-lexicon.json")).entries;
const engine = WordsEngine.create({
  dictline: `${gunzipSync(readFileSync(new URL("../vendor/whitakers/data/DICTLINE.GEN.gz", import.meta.url))).toString("utf8")}\n${readText("../vendor/whitakers/data/DICTLINE.SUP")}`,
  inflects: readText("../vendor/whitakers/data/INFLECTS.LAT"),
  addons: readText("../vendor/whitakers/data/ADDONS.LAT"),
  uniques: readText("../vendor/whitakers/data/UNIQUES.LAT")
});

function translate(latin) {
  const morphology = analyzeLatinMorphologyWithEngine(latin, engine);
  return analyzeBookText(latin, vocabulary, grammar, null, fallback, morphology, []);
}

test("unknown school sentences are translated through morphology and syntax, not translation memory", () => {
  const samples = new Map([
    ["Puella rosam amat.", "Das Mädchen liebt die Rose."],
    ["Servi in villa laborant.", "Die Sklaven arbeiten im Landhaus."],
    ["Caesar milites ad urbem duxit.", "Caesar hat die Soldaten zur Stadt geführt."],
    ["Liberi non laborant, sed ludunt.", "Die Kinder arbeiten nicht, sondern spielen."],
    ["Cum hostes appropinquarent, Romani urbem defendebant.", "Als die Feinde sich näherten, verteidigten die Römer die Stadt."]
  ]);

  for (const [latin, german] of samples) {
    const result = translate(latin);
    assert.equal(result.translation, german, latin);
    assert.equal(result.coverage, 100, latin);
    assert.equal(result.unresolvedWords, 0, latin);
    assert.equal(result.translationVerified, false, "the regression must not be satisfied by stored sentence memory");
  }
});

test("a longer unseen construction remains a sentence instead of a word-by-word list", () => {
  const result = translate("Nessus centaurus rogatus est ab Deianira, ut se flumen Euhenum transferret.");
  assert.match(result.translation, /^Nessus, der Zentaur, wurde von Deianira gebeten,/);
  assert.match(result.translation, /über den Fluss Euhenus/);
  assert.doesNotMatch(result.translation, / · /);
  assert.equal(result.unresolvedWords, 0);
});

test("canonical prose patterns use German syntax instead of lexical word order", () => {
  const samples = new Map([
    ["Gallia est omnis divisa in partes tres.", "Ganz Gallien wurde in drei Teile geteilt."],
    ["Veni, vidi, vici.", "Ich kam, sah und siegte."],
    ["Mater filio librum dedit.", "Die Mutter gab dem Sohn das Buch."]
  ]);

  for (const [latin, german] of samples) {
    const result = translate(latin);
    assert.equal(result.translation, german, latin);
    assert.equal(result.coverage, 100, latin);
    assert.equal(result.translationReliable, true, latin);
  }
});

test("complete lexical coverage does not certify unsupported constructions", () => {
  const unsupported = [
    "Puer librum legens in via ambulat.",
    "Caesar dixit se hostes vicisse.",
    "Ne hoc facias!"
  ];

  for (const latin of unsupported) {
    const result = translate(latin);
    assert.equal(result.coverage, 100, latin);
    assert.equal(result.unresolvedWords, 0, latin);
    assert.equal(result.translationReliable, false, latin);
  }
});
