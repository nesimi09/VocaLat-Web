import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { WordsEngine } from "../vendor/whitakers/whitakers-words.js";
import { analyzeLatinMorphologyWithEngine } from "../morphology.js";

const readText = path => readFileSync(new URL(path, import.meta.url), "utf8");
const engine = WordsEngine.create({
  dictline: `${gunzipSync(readFileSync(new URL("../vendor/whitakers/data/DICTLINE.GEN.gz", import.meta.url))).toString("utf8")}\n${readText("../vendor/whitakers/data/DICTLINE.SUP")}`,
  inflects: readText("../vendor/whitakers/data/INFLECTS.LAT"),
  addons: readText("../vendor/whitakers/data/ADDONS.LAT"),
  uniques: readText("../vendor/whitakers/data/UNIQUES.LAT")
});

function analyze(text) {
  return analyzeLatinMorphologyWithEngine(text, engine);
}

test("pronouns retain every case reading and their lexical kind", () => {
  const morphology = analyze("quod eius");
  const quod = morphology.get("quod");
  const eius = morphology.get("eius");

  assert.ok(quod.some(candidate => candidate.morphology.part === "pron"
    && candidate.morphology.case === "nominative"
    && candidate.morphology.number === "singular"
    && candidate.morphology.gender === "n"
    && candidate.morphology.pronounKind === "relative"));
  assert.ok(quod.some(candidate => candidate.morphology.part === "pron"
    && candidate.morphology.case === "accusative"
    && candidate.morphology.pronounKind === "interrogative"));
  assert.ok(eius.some(candidate => candidate.morphology.part === "pron"
    && candidate.morphology.case === "genitive"
    && candidate.morphology.number === "singular"));
});

test("comparison and numeral details survive Whitaker analysis", () => {
  const morphology = analyze("fortior fortiter tres");

  assert.ok(morphology.get("fortior").some(candidate => candidate.morphology.comparison === "comparative"));
  assert.ok(morphology.get("fortiter").some(candidate => candidate.morphology.comparison === "positive"));
  assert.ok(morphology.get("tres").some(candidate => candidate.morphology.part === "num"
    && candidate.morphology.numeralKind === "cardinal"
    && candidate.morphology.number === "plural"));
});

test("finite and non-finite verbs retain lexical voice metadata", () => {
  const morphology = analyze("loquitur audeo amare");
  const loquitur = morphology.get("loquitur").find(candidate => candidate.morphology.part === "v");
  const audeo = morphology.get("audeo").find(candidate => candidate.morphology.part === "v");
  const amare = morphology.get("amare").find(candidate => candidate.morphology.nonFinite === "infinitive");

  assert.equal(loquitur.morphology.verbKind, "deponent");
  assert.equal(loquitur.morphology.deponent, true);
  assert.equal(loquitur.morphology.semanticVoice, "active");
  assert.equal(audeo.morphology.verbKind, "semideponent");
  assert.equal(audeo.morphology.semideponent, true);
  assert.equal(amare.morphology.infinitiveType, "present-active");
});

test("participles, gerundive candidates, and supines are distinguished", () => {
  const morphology = analyze("legens amatum amandus amandum");
  const ppa = morphology.get("legens").find(candidate => candidate.morphology.traditionalName === "PPA");
  const ppp = morphology.get("amatum").find(candidate => candidate.morphology.traditionalName === "PPP");
  const supine = morphology.get("amatum").find(candidate => candidate.morphology.nonFinite === "supine");
  const gerundive = morphology.get("amandus").find(candidate => candidate.morphology.gerundiveCandidate);
  const gerund = morphology.get("amandum").find(candidate => candidate.morphology.gerundCandidate);

  assert.equal(ppa.morphology.participleType, "present-active");
  assert.equal(ppp.morphology.participleType, "perfect-passive");
  assert.equal(supine.morphology.case, "accusative");
  assert.equal(supine.morphology.supineUse, "purpose");
  assert.equal(gerundive.morphology.participleType, "future-passive");
  assert.equal(gerund.morphology.gender, "n");
  assert.equal(gerund.morphology.number, "singular");
});

test("preposition government and candidate evidence remain available", () => {
  const morphology = analyze("cum quisque");
  const cum = morphology.get("cum").find(candidate => candidate.morphology.part === "prep");
  const enclitic = morphology.get("quisque").find(candidate => candidate.morphology.enclitic === "que");

  assert.equal(cum.morphology.governsCase, "ablative");
  assert.equal(cum.provenance.origin, "dictionary");
  assert.ok(Number.isInteger(cum.provenance.entryIndex));
  assert.match(cum.frequency.lexeme, /^[A-Z]$/);
  assert.ok(cum.frequency.rank > 0);
  assert.equal(enclitic.provenance.origin, "addon");
  assert.equal(enclitic.provenance.addonType, "tackon");
});
