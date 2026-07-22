import test from "node:test";
import assert from "node:assert/strict";
import { translateLatinSyntax } from "../latin-syntax-translator.js";

const entry = (lemma, german, pos) => ({
  lemma,
  latein: lemma,
  deutsch: german,
  meanings: [german],
  pos,
  source: lemma === "Caesar" ? "proper" : "fallback"
});

function word(token, lemma, german, pos, morphology) {
  const lexicalEntry = entry(lemma, german, pos);
  const analysis = { dictionaryLemma: lemma, ...morphology };
  return {
    token,
    normalized: normalizeLatin(token),
    status: "fallback",
    entries: [lexicalEntry],
    morphology: [analysis],
    morphologyCandidates: [{ entry: lexicalEntry, morphology: analysis }],
    length: 1
  };
}

const noun = (token, lemma, german, grammaticalCase, number = "singular", gender = "m") =>
  word(token, lemma, german, "n", { part: "n", case: grammaticalCase, number, gender });

const finite = (token, lemma, german, number = "singular") =>
  word(token, lemma, german, "v", { part: "v", mood: "indicative", tense: "present", voice: "active", person: 3, number });

const participle = (token, lemma, german, grammaticalCase, number, gender, tense, voice, extra = {}) =>
  word(token, lemma, german, "v", { part: "ppa", mood: "participle", case: grammaticalCase, number, gender, tense, voice, ...extra });

const adverb = (token, german) => word(token, token, german, "adv", { part: "adv" });

function construction(result, type) {
  return result.pipeline.grammar.constructions.find(item => item.type === type);
}

test("a simultaneous ablative absolute owns its object and uses subordinate word order", () => {
  const result = translateLatinSyntax([
    noun("Caesare", "Caesar", "Caesar", "ablative"),
    noun("hostes", "hostis", "der Feind", "accusative", "plural"),
    participle("vincente", "vinco", "besiegen", "ablative", "singular", "m", "present", "active"),
    noun("milites", "miles", "der Soldat", "nominative", "plural"),
    finite("gaudent", "gaudeo", "sich freuen", "plural")
  ]);

  const ablativeAbsolute = construction(result, "ablative-absolute");
  assert.deepEqual(ablativeAbsolute.argumentIndexes, [1]);
  assert.equal(ablativeAbsolute.temporalRelation, "simultaneous");
  assert.match(result.text, /^Während Caesar die Feinde besiegt,/u, result.text);
  assert.equal((result.text.match(/Feinde/gu) || []).length, 1, result.text);
});

test("reflexive and separable predicates are placed at the end of an ablative-absolute clause", () => {
  const result = translateLatinSyntax([
    noun("Hostibus", "hostis", "der Feind", "ablative", "plural"),
    participle("appropinquantibus", "appropinquo", "sich nähern", "ablative", "plural", "m", "present", "active"),
    noun("milites", "miles", "der Soldat", "nominative", "plural"),
    finite("fugiunt", "fugio", "fliehen", "plural")
  ]);

  assert.match(result.text, /^Während die Feinde sich nähern,/u, result.text);
  assert.doesNotMatch(result.text, /nähern sich,/u, result.text);
});

test("discourse evidence selects concessive and causal ablative-absolute readings", () => {
  const concessive = translateLatinSyntax([
    noun("Urbe", "urbs", "die Stadt", "ablative", "singular", "f"),
    participle("capta", "capio", "erobern", "ablative", "singular", "f", "perfect", "passive"),
    adverb("tamen", "dennoch"),
    noun("milites", "miles", "der Soldat", "nominative", "plural"),
    finite("manent", "maneo", "bleiben", "plural")
  ]);
  const causal = translateLatinSyntax([
    noun("Urbe", "urbs", "die Stadt", "ablative", "singular", "f"),
    participle("capta", "capio", "erobern", "ablative", "singular", "f", "perfect", "passive"),
    adverb("itaque", "deshalb"),
    noun("milites", "miles", "der Soldat", "nominative", "plural"),
    finite("fugiunt", "fugio", "fliehen", "plural")
  ]);

  assert.equal(construction(concessive, "ablative-absolute").relation, "concessive");
  assert.match(concessive.text, /^Obwohl die Stadt erobert worden war,/u, concessive.text);
  assert.equal(construction(causal, "ablative-absolute").relation, "causal");
  assert.match(causal.text, /^Weil die Stadt erobert worden war,/u, causal.text);
});

test("a future active participle is recognized and expanded prospectively", () => {
  const result = translateLatinSyntax([
    noun("Caesar", "Caesar", "Caesar", "nominative"),
    participle("profecturus", "proficiscor", "aufbrechen", "nominative", "singular", "m", "future", "active", { deponent: true }),
    noun("milites", "miles", "der Soldat", "accusative", "plural"),
    finite("convocat", "convoco", "einladen")
  ]);

  assert.ok(construction(result, "future-participle"));
  assert.match(result.text, /^Caesar, der aufbrechen wird,/u, result.text);
  assert.equal((result.text.match(/Soldaten/gu) || []).length, 1, result.text);
});

test("simple participles are attributive, while complements trigger a relative clause", () => {
  const simple = translateLatinSyntax([
    noun("Puella", "puella", "das Mädchen", "nominative", "singular", "f"),
    participle("cantans", "canto", "singen", "nominative", "singular", "f", "present", "active"),
    finite("venit", "venio", "kommen")
  ]);
  const expanded = translateLatinSyntax([
    noun("Puella", "puella", "das Mädchen", "nominative", "singular", "f"),
    noun("carmen", "carmen", "das Lied", "accusative", "singular", "n"),
    participle("cantans", "canto", "singen", "nominative", "singular", "f", "present", "active"),
    finite("venit", "venio", "kommen")
  ]);

  assert.equal(simple.text, "Das singende Mädchen kommt.");
  assert.match(expanded.text, /^Das Mädchen, das das Lied singt,/u, expanded.text);
  assert.equal((expanded.text.match(/Lied/gu) || []).length, 1, expanded.text);
});

test("a perfect deponent participle keeps active meaning outside the esse periphrasis", () => {
  const result = translateLatinSyntax([
    noun("Senator", "senator", "der Senator", "nominative"),
    participle("profectus", "proficiscor", "aufbrechen", "nominative", "singular", "m", "perfect", "passive", {
      deponent: true,
      lexicalVoice: "deponent",
      verbClass: "deponent"
    }),
    finite("venit", "venio", "kommen")
  ]);

  assert.equal(construction(result, "participial-phrase")?.participleIndex, 1);
  assert.match(result.text, /^Der aufgebrochene Senator kommt/u, result.text);
  assert.doesNotMatch(result.text, /wurde|worden/u, result.text);
});

function normalizeLatin(value) {
  return String(value)
    .normalize("NFD")
    .toLocaleLowerCase("la")
    .replace(/\p{M}/gu, "")
    .replaceAll("j", "i")
    .replace(/[^a-z]/g, "");
}
