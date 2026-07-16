import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBookText } from "../learning-engine.js";
import { selectPreferredLexeme, translateLatinPassage, translateLatinSyntax } from "../latin-syntax-translator.js";

const entry = (lemma, deutsch, pos, source = "fallback") => ({ lemma, latein: lemma, deutsch, meanings: [deutsch], pos, source });
const word = (token, lexicalEntry, morphology = {}, status = lexicalEntry?.source === "book" ? "book-form" : "fallback", alternatives = []) => ({
  token,
  normalized: token.toLocaleLowerCase("la"),
  status,
  entries: lexicalEntry ? [lexicalEntry, ...alternatives] : [],
  morphology: morphology ? [morphology] : [],
  length: 1
});

const noun = (token, lexicalEntry, grammaticalCase, number = "singular") => word(token, lexicalEntry, { part: lexicalEntry.pos, case: grammaticalCase, number });
const verb = (token, lexicalEntry, person = 3, number = "singular", tense = "present", mood = "indicative") => word(token, lexicalEntry, { part: "v", person, number, tense, mood, voice: "active" });

test("book vocabulary wins over a bundled fallback sense", () => {
  const book = entry("amo", "lieben", "v", "book");
  const fallback = entry("amo", "gern haben", "v", "fallback");
  assert.equal(selectPreferredLexeme([fallback, book], { part: "v" }), book);

  const result = translateLatinSyntax([
    noun("Puella", entry("puella", "das Mädchen", "n", "book"), "nominative"),
    noun("rosam", entry("rosa", "die Rose", "n", "book"), "accusative"),
    word("amat", fallback, { part: "v", person: 3, number: "singular", tense: "present", mood: "indicative", voice: "active" }, "ambiguous", [book])
  ]);
  assert.equal(result.text, "Das Mädchen liebt die Rose.");
  assert.equal(result.lexicalSources.at(-1).source, "book");
  assert.equal(result.reliable, true);
});

test("a local fallback word is translated when the book has no entry", () => {
  const result = translateLatinSyntax([
    noun("Puella", entry("puella", "das Mädchen", "n", "book"), "nominative"),
    noun("stellas", entry("stella", "der Stern", "n", "fallback"), "accusative", "plural"),
    verb("spectat", entry("specto", "betrachten", "v", "fallback"))
  ]);
  assert.equal(result.text, "Das Mädchen betrachtet die Sterne.");
  assert.equal(result.reliable, true);
  assert.match(result.lexicalSources.map(item => item.source).join(" "), /fallback/);
});

test("morphological roles reorder Latin SOV into a German clause", () => {
  const result = translateLatinSyntax([
    noun("Servae", entry("serva", "die Sklavin", "n", "book"), "nominative", "plural"),
    word("in", entry("in", "in", "prep", "book"), { part: "prep" }, "exact"),
    noun("culina", entry("culina", "die Küche", "n", "book"), "ablative"),
    verb("sunt", entry("sum", "sein", "v", "book"), 3, "plural")
  ]);
  assert.equal(result.text, "Die Sklavinnen sind in der Küche.");
});

test("negation and coordinated predicates become natural German", () => {
  const children = entry("liberi", "das Kind", "n", "book");
  const result = translateLatinSyntax([
    noun("Liberi", children, "nominative", "plural"),
    word("non", entry("non", "nicht", "adv", "book"), { part: "adv" }, "exact"),
    verb("laborant", entry("laboro", "arbeiten", "v", "book"), 3, "plural"),
    word("sed", entry("sed", "aber", "conj", "book"), { part: "conj" }, "exact"),
    verb("ludunt", entry("ludo", "spielen", "v", "book"), 3, "plural")
  ]);
  assert.equal(result.text, "Die Kinder arbeiten nicht, sondern spielen.");
});

test("prepositions use German government and contractions", () => {
  const result = translateLatinSyntax([
    noun("Puella", entry("puella", "das Mädchen", "n", "book"), "nominative"),
    word("ad", entry("ad", "zu", "prep", "book"), { part: "prep" }, "exact"),
    noun("avum", entry("avus", "der Großvater", "n", "book"), "accusative"),
    verb("currit", entry("curro", "laufen", "v", "book"))
  ]);
  assert.equal(result.text, "Das Mädchen läuft zum Großvater.");
});

test("an ablative absolute is turned into a German subordinate clause", () => {
  const result = translateLatinSyntax([
    noun("Sirenibus", entry("sirena", "die Sirene", "n", "fallback"), "ablative", "plural"),
    word("pulchre", entry("pulchre", "schön", "adv", "fallback"), { part: "adv" }),
    word("cantantibus", entry("canto", "singen", "v", "fallback"), { part: "ppa", case: "ablative", number: "plural", tense: "present", voice: "active" })
  ]);
  assert.equal(result.text, "Während die Sirenen schön singen.");
});

test("unresolved words stay visible instead of receiving invented meanings", () => {
  const result = translateLatinSyntax([
    noun("Puella", entry("puella", "das Mädchen", "n", "book"), "nominative"),
    word("xylophonem", null, {}, "unknown"),
    verb("videt", entry("video", "sehen", "v", "book"))
  ]);
  assert.equal(result.text, "Das Mädchen sieht [xylophonem].");
  assert.equal(result.reliable, false);
  assert.deepEqual(result.unresolved, ["xylophonem"]);
});

test("passage translation preserves sentence boundaries and reliability", () => {
  const girl = entry("puella", "das Mädchen", "n", "book");
  const lines = [
    [noun("Puella", girl, "nominative"), verb("ridet", entry("rideo", "lachen", "v", "book"))],
    [noun("Puella", girl, "nominative"), verb("venit", entry("venio", "kommen", "v", "fallback"))]
  ];
  const result = translateLatinPassage(lines);
  assert.equal(result.text, "Das Mädchen lacht.\nDas Mädchen kommt.");
  assert.equal(result.reliable, true);
  assert.equal(result.sentences.length, 2);
});

test("the translator consumes real learning-engine matches with ambiguous citation forms", () => {
  const book = [
    { lektion: 1, latein: "puella", grammatik: "puellae f.", deutsch: "das Mädchen" },
    { lektion: 1, latein: "spectare", grammatik: "specto", deutsch: "betrachten" }
  ];
  const fallback = [{ lemma: "stella", forms: ["stella", "stellae"], pos: "n", meanings: ["der Stern"] }];
  const analysis = analyzeBookText("Puella stellas spectat.", book, [], null, fallback);
  const result = translateLatinSyntax(analysis.matches);

  assert.equal(result.text, "Das Mädchen betrachtet die Sterne.");
  assert.equal(result.reliable, true);
});

test("a fronted temporal clause uses German verb-first order in the main clause", () => {
  const result = translateLatinSyntax([
    word("Cum", entry("cum", "als", "conj", "book"), { part: "conj" }, "exact"),
    noun("puella", entry("puella", "das Mädchen", "n", "book"), "nominative"),
    noun("rosam", entry("rosa", "die Rose", "n", "book"), "accusative"),
    verb("videret", entry("video", "sehen", "v", "book"), 3, "singular", "imperfect", "subjunctive"),
    noun("puer", entry("puer", "der Junge", "n", "book"), "nominative"),
    verb("venit", entry("venio", "kommen", "v", "book"), 3, "singular", "imperfect")
  ]);
  assert.equal(result.text, "Als das Mädchen die Rose sah, kam der Junge.");
});

test("PPP plus esse becomes a German perfect passive", () => {
  const result = translateLatinSyntax([
    noun("Nessus", entry("Nessus", "Nessus", "proper", "proper-context"), "nominative"),
    word("rogatus", entry("rogo", "bitten", "v", "book"), { part: "ppa", case: "nominative", number: "singular", tense: "perfect", voice: "passive" }, "book-form"),
    verb("est", entry("sum", "sein", "v", "book"))
  ]);
  assert.equal(result.text, "Nessus wurde gebeten.");
});

test("lexical coverage without a determined verb form is not reliable", () => {
  const result = translateLatinSyntax([
    noun("Puella", entry("puella", "das Mädchen", "n", "book"), "nominative"),
    word("amat", entry("amo", "lieben", "v", "book"), { part: "v", citation: true }, "exact")
  ]);

  assert.equal(result.unresolved.length, 0);
  assert.equal(result.reliable, false);
  assert.match(result.diagnostics.join(" "), /syntax-incomplete|uncertain-morphology/);
});
