import test from "node:test";
import assert from "node:assert/strict";
import { postprocessGerman, translateLatinSyntax } from "../latin-syntax-translator.js";
import { KNOWN_GERMAN_NOUNS, LATIN_IDIOMS } from "../latin-language-data.js";

const entry = (lemma, deutsch, pos = "n") => ({
  lemma,
  latein: lemma,
  deutsch,
  meanings: [deutsch],
  pos,
  source: "fallback"
});

const word = (token, lexicalEntry, morphology) => ({
  token,
  normalized: token.toLocaleLowerCase("la"),
  status: "fallback",
  entries: [lexicalEntry],
  morphology: Array.isArray(morphology) ? morphology : [morphology],
  length: 1
});

const noun = (token, lemma, deutsch, grammaticalCase, number = "singular", gender = "m") =>
  word(token, entry(lemma, deutsch), { part: "n", case: grammaticalCase, number, gender });

const finite = (token, lemma, deutsch, number = "singular", tense = "present", mood = "indicative") =>
  word(token, entry(lemma, deutsch, "v"), { part: "v", person: 3, number, tense, mood, voice: "active" });

const infinitive = (token, lemma, deutsch) =>
  word(token, entry(lemma, deutsch, "v"), { part: "v", mood: "infinitive", tense: "present", voice: "active" });

const participle = (token, lemma, deutsch, grammaticalCase, number = "plural", tense = "present", extra = {}) =>
  word(token, entry(lemma, deutsch, "v"), { part: "ppa", case: grammaticalCase, number, gender: "m", tense, voice: "active", ...extra });

test("an infinitive governed by an ablative participle stays inside that construction", () => {
  const result = translateLatinSyntax([
    noun("Hostibus", "hostis", "der Feind", "ablative", "plural"),
    noun("urbem", "urbs", "die Stadt", "accusative", "singular", "f"),
    infinitive("oppugnare", "oppugno", "angreifen"),
    participle("cupientibus", "cupio", "wollen, wünschen", "ablative"),
    noun("cives", "civis", "der Bürger", "nominative", "plural"),
    noun("portas", "porta", "das Tor", "accusative", "plural", "f"),
    finite("custodiunt", "custodio", "bewachen", "plural")
  ]);

  assert.equal(result.text, "Während die Feinde die Stadt angreifen wollen, bewachen die Bürger die Tore.");
  assert.equal((result.text.match(/angreifen/gu) || []).length, 1);
});

test("a participial phrase can govern an infinitive without losing its relative pronoun", () => {
  const result = translateLatinSyntax([
    noun("Milites", "miles", "der Soldat", "nominative", "plural"),
    noun("urbem", "urbs", "die Stadt", "accusative", "singular", "f"),
    infinitive("oppugnare", "oppugno", "angreifen"),
    participle("cupientes", "cupio", "wollen, wünschen", "nominative"),
    finite("veniunt", "venio", "kommen", "plural")
  ]);

  assert.equal(result.text, "Die Soldaten, die die Stadt angreifen wollen, kommen.");
});

test("repeated adverbs joined by enclitic -que are realised as one idiomatic adverbial", () => {
  const result = translateLatinSyntax([
    noun("Ventus", "ventus", "der Wind", "nominative"),
    word("iterum", entry("iterum", "wieder", "adv"), { part: "adv" }),
    word("iterumque", entry("iterum", "wieder", "adv"), { part: "adv", enclitic: "que" }),
    finite("flat", "flo", "wehen")
  ]);

  assert.equal(result.text, "Der Wind weht immer wieder.");
});

test("a complete leading cum clause overrules a locally possible prepositional reading", () => {
  const ambiguousGirl = word("puella", entry("puella", "Mädchen"), [
    { part: "n", case: "nominative", number: "singular", gender: "f" },
    { part: "n", case: "ablative", number: "singular", gender: "f" }
  ]);
  const result = translateLatinSyntax([
    word("Cum", entry("cum", "als", "conj"), { part: "conj" }),
    ambiguousGirl,
    finite("venit", "venio", "kommen"),
    finite("amat", "amo", "lieben")
  ]);

  assert.equal(result.text, "Als das Mädchen kommt, liebt er.");
  assert.doesNotMatch(result.text, /mit dem Mädchen/iu);
});

test("German lexical gender and plural govern articles even when Latin gender differs", () => {
  const result = translateLatinSyntax([
    noun("Puella", "puella", "Mädchen", "nominative", "singular", "f"),
    noun("rosas", "rosa", "Rose", "accusative", "plural", "m"),
    finite("amat", "amo", "lieben")
  ]);

  assert.equal(result.text, "Das Mädchen liebt die Rosen.");
});

test("central German noun data records non-productive plurals and weak noun forms", () => {
  assert.deepEqual(KNOWN_GERMAN_NOUNS.Wasser, { article: "das", plural: "Wässer" });
  assert.deepEqual(KNOWN_GERMAN_NOUNS.Holz, { article: "das", plural: "Hölzer" });
  assert.deepEqual(KNOWN_GERMAN_NOUNS.Stadt, { article: "die", plural: "Städte" });
  assert.deepEqual(KNOWN_GERMAN_NOUNS.Herr, { article: "der", plural: "Herren", oblique: "Herrn", genitive: "Herrn" });
});

test("non-productive plurals are realized from central lexical data", () => {
  const waters = translateLatinSyntax([
    noun("Aquae", "aqua", "das Wasser", "nominative", "plural", "f"),
    noun("urbes", "urbs", "die Stadt", "accusative", "plural", "f"),
    finite("delent", "deleo", "zerstören", "plural")
  ]);
  const wood = translateLatinSyntax([
    noun("Viri", "vir", "der Mann", "nominative", "plural"),
    noun("ligna", "lignum", "das Holz", "accusative", "plural", "n"),
    finite("portant", "porto", "tragen", "plural")
  ]);

  assert.equal(waters.text, "Die Wässer zerstören die Städte.");
  assert.equal(wood.text, "Die Männer tragen die Hölzer.");
});

test("weak German nouns use their lexical dative and genitive forms", () => {
  const dative = translateLatinSyntax([
    noun("Amicus", "amicus", "der Freund", "nominative"),
    noun("domino", "dominus", "der Herr", "dative"),
    noun("librum", "liber", "das Buch", "accusative", "singular", "n"),
    finite("dat", "do", "geben")
  ]);
  const genitive = translateLatinSyntax([
    noun("Liber", "liber", "das Buch", "nominative", "singular", "n"),
    noun("domini", "dominus", "der Herr", "genitive"),
    finite("manet", "maneo", "bleiben")
  ]);

  assert.match(dative.text, /dem Herrn/u);
  assert.match(genitive.text, /des Herrn/u);
  assert.doesNotMatch(`${dative.text} ${genitive.text}`, /Herrens/u);
});

test("productive idiom data covers help, concern, and need valency", () => {
  const byId = Object.fromEntries(LATIN_IDIOMS.map(item => [item.id, item]));
  assert.equal(byId["auxilium-ferre"].german, "Hilfe leisten");
  assert.equal(byId["curae-esse"].german, "wichtig sein");
  assert.deepEqual(
    { subjectRole: byId["opus-esse"].subjectRole, directObjectRole: byId["opus-esse"].directObjectRole },
    { subjectRole: "indirectObject", directObjectRole: "ablative" }
  );
});

test("idiom valency keeps recipients and promotes opus arguments productively", () => {
  const help = translateLatinSyntax([
    noun("Dominus", "dominus", "der Herr", "nominative"),
    noun("amico", "amicus", "der Freund", "dative"),
    noun("auxilium", "auxilium", "die Hilfe", "accusative", "singular", "n"),
    finite("fert", "fero", "tragen")
  ]);
  const concern = translateLatinSyntax([
    noun("Res", "res", "die Sache", "nominative", "singular", "f"),
    noun("domino", "dominus", "der Herr", "dative"),
    noun("curae", "cura", "die Sorge", "dative", "singular", "f"),
    finite("est", "sum", "sein")
  ]);
  const need = translateLatinSyntax([
    noun("domino", "dominus", "der Herr", "dative"),
    noun("gladio", "gladius", "das Schwert", "ablative", "singular", "m"),
    noun("opus", "opus", "die Notwendigkeit", "nominative", "singular", "n"),
    finite("est", "sum", "sein")
  ]);

  assert.equal(help.text, "Der Herr leistet dem Freund Hilfe.");
  assert.equal(concern.text, "Die Sache ist dem Herrn wichtig.");
  assert.equal(need.text, "Der Herr braucht ein Schwert.");
});

test("a perfect deponent ablative absolute remains active in German", () => {
  const result = translateLatinSyntax([
    noun("Duce", "dux", "der Anführer", "ablative"),
    participle("profecto", "proficiscor", "weggehen", "ablative", "singular", "perfect", { voice: "passive", deponent: true }),
    noun("milites", "miles", "der Soldat", "nominative", "plural"),
    finite("veniunt", "venio", "kommen", "plural")
  ]);

  assert.equal(result.text, "Nachdem der Anführer weggegangen war, kommen die Soldaten.");
  assert.doesNotMatch(result.text, /worden/iu);
});

test("a perfect NcI uses the bare infinitive required by German sollen", () => {
  const result = translateLatinSyntax([
    noun("Milites", "miles", "der Soldat", "nominative", "plural"),
    noun("urbem", "urbs", "die Stadt", "accusative", "singular", "f"),
    word("cepisse", entry("capio", "erobern", "v"), { part: "v", mood: "infinitive", tense: "perfect", voice: "active" }),
    word("dicuntur", entry("dico", "sagen", "v"), { part: "v", mood: "indicative", tense: "present", voice: "passive", person: 3, number: "plural" })
  ]);

  assert.equal(result.text, "Die Soldaten sollen die Stadt erobert haben.");
  assert.doesNotMatch(result.text, /zu haben/iu);
});

test("postprocessing preserves adjacent relative pronouns and articles", () => {
  assert.equal(postprocessGerman("die Soldaten, die die Stadt sehen"), "Die Soldaten, die die Stadt sehen.");
});
