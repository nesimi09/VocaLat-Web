import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeBookText, tokenizeLatinText } from "../learning-engine.js";
import { extractLatinDocument } from "../document-analysis.js";

const memory = JSON.parse(readFileSync(new URL("../data/translation-memory.json", import.meta.url), "utf8")).entries;

test("every local corpus entry survives common OCR punctuation and letter errors", () => {
  assert.ok(memory.length >= 60);
  for (const entry of memory) {
    const exact = analyzeBookText(entry.latin, [], [], null, [], new Map(), memory);
    assert.equal(exact.translationVerified, true, entry.id || entry.latin);
    assert.equal(exact.translation, entry.german, entry.id || entry.latin);

    const withoutPunctuation = entry.latin.replace(/[.,;:!?]+/g, " ").replace(/\s+/g, " ").trim();
    const punctuationResult = analyzeBookText(withoutPunctuation, [], [], null, [], new Map(), memory);
    assert.equal(punctuationResult.translationVerified, true, entry.id || entry.latin);

    const damaged = removeOneLetter(entry.latin);
    const damagedResult = analyzeBookText(damaged, [], [], null, [], new Map(), memory);
    assert.equal(damagedResult.translationVerified, true, entry.id || entry.latin);
    assert.equal(damagedResult.translation, entry.german, entry.id || entry.latin);
  }
});

test("a passage is recovered even when OCR loses all sentence punctuation", () => {
  const entries = memory.filter(entry => entry.work === "In Catilinam 1,1");
  const passage = entries.map(entry => entry.latin).join(" ").replace(/[.,;:!?]+/g, " ");
  const result = analyzeBookText(passage, [], [], null, [], new Map(), memory);
  assert.equal(result.translationVerified, true);
  assert.equal(result.verifiedLines, entries.length);
  assert.equal(result.translation, entries.map(entry => entry.german).join("\n"));
});

test("a missing negation is never accepted as a verified translation", () => {
  const entry = memory.find(item => /\bnon\b/i.test(item.latin));
  assert.ok(entry);
  const opposite = entry.latin.replace(/\bnon\b/i, "iam");
  const result = analyzeBookText(opposite, [], [], null, [], new Map(), memory);
  assert.equal(result.translationVerified, false);
});

test("a different complete word is never treated as a harmless OCR error", () => {
  const entry = memory.find(item => tokenizeLatinText(item.latin).length >= 10);
  assert.ok(entry);
  const original = tokenizeLatinText(entry.latin).find(token => token.raw.length >= 6).raw;
  const changed = entry.latin.replace(original, "contrarium");
  const result = analyzeBookText(changed, [], [], null, [], new Map(), memory);
  assert.equal(result.translationVerified, false);
});

test("the real Triptolemus OCR output reaches the verified local translation", () => {
  const raw = readFileSync(new URL("./fixtures/triptolemus-ocr.txt", import.meta.url), "utf8");
  const expected = memory.filter(entry => entry.work === "Fabulae 147: Triptolemus");
  const morphology = new Map(expected.flatMap(entry => tokenizeLatinText(entry.latin)).map(token => [token.normalized, [{ forms: [token.normalized], morphology: {} }]]));
  const document = extractLatinDocument(raw, morphology);
  const result = analyzeBookText(document.latinText, [], [], null, document.glossary, morphology, memory);
  assert.equal(tokenizeLatinText(document.latinText).length, 119);
  assert.equal(result.translationVerified, true);
  assert.equal(result.verifiedLines, 10);
  assert.equal(result.translation, expected.map(entry => entry.german).join("\n"));
});

test("a real multi-paragraph Phaedrus worksheet reaches the verified translation", () => {
  const raw = readFileSync(new URL("./fixtures/phaedrus-wolf-lamm-ocr.txt", import.meta.url), "utf8");
  const expected = memory.filter(entry => entry.work === "Fabulae 1,1: Lupus et agnus");
  const morphology = new Map(expected.flatMap(entry => tokenizeLatinText(entry.latin)).map(token => [token.normalized, [{ forms: [token.normalized], morphology: {} }]]));
  const document = extractLatinDocument(raw, morphology);
  const result = analyzeBookText(document.latinText, [], [], null, [], morphology, memory);
  assert.equal(tokenizeLatinText(document.latinText).length, 79);
  assert.equal(result.translationVerified, true);
  assert.equal(result.verifiedLines, 10);
  assert.equal(result.translation, expected.map(entry => entry.german).join("\n"));
});

test("the real 53-word worksheet OCR reaches its complete verified translation", () => {
  const raw = readFileSync(new URL("./fixtures/familia-avum-ocr.txt", import.meta.url), "utf8");
  const expected = memory.filter(entry => entry.work === "Familia avum exspectat (Übersetzungsaufgabe)");
  const morphology = new Map(expected.flatMap(entry => tokenizeLatinText(entry.latin)).map(token => [token.normalized, [{ forms: [token.normalized], morphology: {} }]]));
  const document = extractLatinDocument(raw, morphology);
  const result = analyzeBookText(document.latinText, [], [], null, document.glossary, morphology, memory);
  assert.equal(tokenizeLatinText(document.latinText).length, 53);
  assert.equal(result.translationVerified, true);
  assert.equal(result.verifiedLines, 8);
  assert.equal(result.translation, expected.map(entry => entry.german).join("\n"));
});

function removeOneLetter(text) {
  const token = tokenizeLatinText(text).map(item => item.raw).find(item => item.length >= 6);
  if (!token) return text;
  const index = Math.floor(token.length / 2);
  return text.replace(token, `${token.slice(0, index)}${token.slice(index + 1)}`);
}
