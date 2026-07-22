import test from "node:test";
import assert from "node:assert/strict";
import { translateLatinSyntax } from "../latin-syntax-translator.js";

const entry = (lemma, german, pos = "n", source = "fallback") => ({
  lemma,
  latein: lemma,
  deutsch: german,
  meanings: [german],
  pos,
  source
});

const word = (token, lexicalEntry, morphology) => ({
  token,
  normalized: token.toLocaleLowerCase("la"),
  status: lexicalEntry.source === "proper-context" ? "proper" : "fallback",
  entries: [lexicalEntry],
  morphology: [{ dictionaryLemma: lexicalEntry.lemma, ...morphology }],
  length: 1
});

const noun = (token, lemma, german, grammaticalCase, number = "singular", gender = "m", source = "fallback") =>
  word(token, entry(lemma, german, source === "proper-context" ? "proper" : "n", source), {
    part: source === "proper-context" ? "proper" : "n",
    case: grammaticalCase,
    number,
    gender
  });

const finite = (token, lemma, german, number = "plural", tense = "present") => word(token, entry(lemma, german, "v"), {
  part: "v",
  mood: "indicative",
  tense,
  voice: "active",
  person: 3,
  number
});

test("a nominal ablative absolute supplies the omitted form of esse", () => {
  const result = translateLatinSyntax([
    noun("Caesare", "Caesar", "Caesar", "ablative", "singular", "m", "proper-context"),
    noun("duce", "dux", "der Anführer", "ablative"),
    noun("milites", "miles", "der Soldat", "nominative", "plural"),
    finite("pugnabant", "pugno", "kämpfen", "plural", "imperfect")
  ]);

  const construction = result.analysis.constructions.find(item => item.type === "ablative-absolute");
  assert.equal(construction?.nominal, true);
  assert.equal(construction?.predicateNominalIndex, 1);
  assert.equal(result.text, "Als Caesar Anführer war, kämpften die Soldaten.");
});

test("preposition government prevents a nominal ablative false positive", () => {
  const result = translateLatinSyntax([
    word("cum", entry("cum", "mit", "prep"), { part: "prep" }),
    noun("Caesare", "Caesar", "Caesar", "ablative", "singular", "m", "proper-context"),
    noun("milites", "miles", "der Soldat", "nominative", "plural"),
    finite("pugnant", "pugno", "kämpfen")
  ]);

  assert.equal(result.analysis.constructions.some(item => item.type === "ablative-absolute"), false);
  assert.match(result.text, /mit Caesar/iu);
});
