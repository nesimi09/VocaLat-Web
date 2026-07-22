import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { WordsEngine } from "../vendor/whitakers/whitakers-words.js";
import { analyzeLatinMorphologyWithEngine } from "../morphology.js";
import {
  resolveMorphology,
  parseLatinSyntax,
  interpretLatinGrammar,
  selectContextualMeanings
} from "../latin-analysis.js";

const readText = path => readFileSync(new URL(path, import.meta.url), "utf8");
const engine = WordsEngine.create({
  dictline: `${gunzipSync(readFileSync(new URL("../vendor/whitakers/data/DICTLINE.GEN.gz", import.meta.url))).toString("utf8")}\n${readText("../vendor/whitakers/data/DICTLINE.SUP")}`,
  inflects: readText("../vendor/whitakers/data/INFLECTS.LAT"),
  addons: readText("../vendor/whitakers/data/ADDONS.LAT"),
  uniques: readText("../vendor/whitakers/data/UNIQUES.LAT")
});

test("sentence roles and lexical frequency resolve a noun/PPP homograph", () => {
  const latin = "Puella rosam amat.";
  const morphology = analyzeLatinMorphologyWithEngine(latin, engine);
  const entries = new Map([
    ["puella", { lemma: "puella", latein: "puella", meanings: ["Mädchen"], deutsch: "Mädchen", pos: "n", source: "fallback" }],
    ["rosa", { lemma: "rosa", latein: "rosa", meanings: ["Rose"], deutsch: "Rose", pos: "n", source: "fallback" }],
    ["rodo", { lemma: "rodo", latein: "rodo", meanings: ["nagen"], deutsch: "nagen", pos: "v", source: "fallback" }],
    ["amo", { lemma: "amo", latein: "amo", meanings: ["mögen", "lieben"], deutsch: "mögen, lieben", pos: "v", source: "fallback" }]
  ]);
  const matches = ["puella", "rosam", "amat"].map(token => {
    const candidates = morphology.get(token).map(analysis => ({ entry: entries.get(analysis.forms[0]), morphology: analysis.morphology })).filter(candidate => candidate.entry);
    return {
      token,
      normalized: token,
      status: "ambiguous",
      entries: [...new Set(candidates.map(candidate => candidate.entry))],
      morphology: candidates.map(candidate => candidate.morphology),
      morphologyCandidates: candidates
    };
  });
  const object = matches.find(match => match.normalized === "rosam");
  const resolved = resolveMorphology(matches, { source: latin });
  const rose = resolved.find(word => word.normalized === "rosam");

  assert.ok(object.morphologyCandidates.some(candidate => candidate.morphology.part === "n"));
  assert.ok(object.morphologyCandidates.some(candidate => candidate.morphology.part === "ppa"));
  assert.equal(rose.lemma, "rosa");
  assert.equal(rose.morphology.part, "n");
  assert.equal(rose.morphology.case, "accusative");
  const semantics = selectContextualMeanings(interpretLatinGrammar(parseLatinSyntax(resolved)));
  assert.equal(semantics.words.find(word => word.normalized === "amat").sense, "lieben");
});

test("a book infinitive stays preferred while the canonical finite lemma drives syntax", () => {
  const book = { lemma: "amare", latein: "amare", forms: ["amare", "amo"], meanings: ["lieben"], deutsch: "lieben", pos: "v", source: "book" };
  const fallbackEntry = { lemma: "amo", latein: "amo", forms: ["amo", "amare"], meanings: ["mögen"], deutsch: "mögen", pos: "v", source: "fallback" };
  const matches = [{
    token: "amat",
    normalized: "amat",
    status: "ambiguous",
    entries: [book, fallbackEntry],
    morphology: [{ part: "v", person: 3, number: "singular", tense: "present", voice: "active", mood: "indicative", dictionaryLemma: "amo", dictionaryFrequencyRank: 6 }],
    morphologyCandidates: [book, fallbackEntry].map(entry => ({
      entry,
      morphology: { part: "v", person: 3, number: "singular", tense: "present", voice: "active", mood: "indicative", dictionaryLemma: "amo", dictionaryFrequencyRank: 6 }
    }))
  }];

  const resolved = resolveMorphology(matches, { source: "amat" });
  const semantics = selectContextualMeanings(interpretLatinGrammar(parseLatinSyntax(resolved)));
  assert.equal(resolved[0].lemma, "amo");
  assert.equal(semantics.words[0].entry.source, "book");
  assert.equal(semantics.words[0].sense, "lieben");
});
