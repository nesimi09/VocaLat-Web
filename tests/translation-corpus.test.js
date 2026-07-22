import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { WordsEngine } from "../vendor/whitakers/whitakers-words.js";
import { analyzeLatinMorphologyWithEngine } from "../morphology.js";
import { analyzeBookText } from "../learning-engine.js";
import { translateLatinSyntax } from "../latin-syntax-translator.js";

const readText = path => readFileSync(new URL(path, import.meta.url), "utf8");
const readJson = path => JSON.parse(readText(path));
const holdout = readJson("./fixtures/translation-holdout.json");
const vocabulary = readJson("../data/vocabulary.json").filter(entry => entry.latein?.trim() && entry.deutsch?.trim());
const grammar = readJson("../data/grammar.json").abschnitte || [];
const fallback = readJson("../data/fallback-lexicon.json").entries || [];
const engine = WordsEngine.create({
  dictline: `${gunzipSync(readFileSync(new URL("../vendor/whitakers/data/DICTLINE.GEN.gz", import.meta.url))).toString("utf8")}\n${readText("../vendor/whitakers/data/DICTLINE.SUP")}`,
  inflects: readText("../vendor/whitakers/data/INFLECTS.LAT"),
  addons: readText("../vendor/whitakers/data/ADDONS.LAT"),
  uniques: readText("../vendor/whitakers/data/UNIQUES.LAT")
});

function analyze(latin) {
  const morphology = analyzeLatinMorphologyWithEngine(latin, engine);
  const result = analyzeBookText(latin, vocabulary, grammar, null, fallback, morphology);
  const syntax = translateLatinSyntax(result.matches, { source: latin });
  return { result, syntax };
}

test("the holdout corpus describes structures and concepts, not memorized reference sentences", () => {
  assert.ok(holdout.cases.length >= 12);
  assert.equal(new Set(holdout.cases.map(sample => sample.id)).size, holdout.cases.length);
  for (const sample of holdout.cases) {
    assert.equal(typeof sample.latin, "string", sample.id);
    assert.ok(sample.latin.length > 3, sample.id);
    assert.equal(Object.hasOwn(sample, "german"), false, `${sample.id}: no full German reference is allowed`);
    assert.equal(Object.hasOwn(sample, "translation"), false, `${sample.id}: no full translation is allowed`);
    assert.ok((sample.tags?.length || 0) + (sample.roles?.length || 0) + (sample.concepts?.length || 0) > 0, sample.id);
  }
});

test("unseen sentences are analyzed by the common morphology, parser and generator pipeline", () => {
  for (const sample of holdout.cases) {
    const { result, syntax } = analyze(sample.latin);
    assert.ok(syntax.pipeline, `${sample.id}: structured pipeline evidence is missing`);
    assert.ok(result.coverage >= sample.minimumCoverage, `${sample.id}: coverage ${result.coverage}%`);
    assert.equal(result.unresolvedWords, 0, `${sample.id}: unresolved words`);
    assertSentenceShape(result.translation, sample.id);

    for (const tag of sample.tags || []) {
      assert.equal(hasTag(syntax.pipeline, tag), true, `${sample.id}: expected ${tag}`);
    }
    for (const expected of sample.roles || []) {
      assert.equal(hasRole(syntax.pipeline, expected.role, expected.token), true, `${sample.id}: ${expected.token} must be ${expected.role}`);
    }
    for (const pattern of sample.concepts || []) {
      assert.match(result.translation, new RegExp(pattern, "iu"), `${sample.id}: ${result.translation}`);
    }
    for (const pattern of sample.forbiddenPatterns || []) {
      assert.doesNotMatch(result.translation, new RegExp(pattern, "iu"), `${sample.id}: ${result.translation}`);
    }
  }
});

test("word order changes do not change the grammatical roles", () => {
  const canonical = analyze("Agricola equum videt.");
  const frontedObject = analyze("Equum agricola videt.");

  for (const sample of [canonical, frontedObject]) {
    assert.equal(hasRole(sample.syntax.pipeline, "subject", "agricola"), true);
    assert.equal(hasRole(sample.syntax.pipeline, "direct-object", "equum"), true);
    assert.match(sample.result.translation, /Bauer/iu);
    assert.match(sample.result.translation, /Pferd/iu);
  }
});

test("a negation changes the generated meaning instead of being treated as OCR noise", () => {
  const positive = analyze("Agricola equum videt.").result.translation;
  const negative = analyze("Agricola equum non videt.").result.translation;

  assert.notEqual(negative, positive);
  assert.match(negative, /nicht/iu);
});

function assertSentenceShape(value, id) {
  assert.ok(value.trim(), `${id}: empty translation`);
  assert.doesNotMatch(value, /\s·\s|\[[^\]]+\]/u, `${id}: word-list fallback leaked into output`);
  assert.match(value, /^[\p{Lu}ÄÖÜ]/u, `${id}: sentence must start with a capital letter`);
  assert.match(value, /[.!?]$/u, `${id}: sentence punctuation is missing`);
}

function hasTag(root, expected) {
  const wanted = normalizeTag(expected);
  return walk(root).some(node => [node?.type, node?.kind, node?.construction, node?.constructionType, node?.clauseType, node?.relation, node?.role]
    .filter(value => typeof value === "string")
    .some(value => {
      const tag = normalizeTag(value);
      return tag === wanted || tag.includes(wanted) || wanted.includes(tag);
    }));
}

function hasRole(root, expectedRole, expectedToken) {
  const role = normalizeTag(expectedRole);
  const token = normalizeLatin(expectedToken);
  return walk(root).some(node => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;
    const nodeRole = normalizeTag(node.role || node.relation || node.type);
    return (nodeRole === role || nodeRole.includes(role) || role.includes(nodeRole)) && containsToken(node, token);
  });
}

function containsToken(root, expected) {
  return walk(root).some(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return [value.token, value.surface, value.raw, value.form, value.word, value.lemma]
      .some(candidate => normalizeLatin(candidate) === expected);
  });
}

function normalizeLatin(value = "") {
  return String(value)
    .normalize("NFD")
    .toLocaleLowerCase("la")
    .replace(/\p{M}/gu, "")
    .replaceAll("j", "i")
    .replace(/[^a-z]/g, "");
}

function normalizeTag(value = "") {
  return String(value).toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "");
}

function walk(root) {
  const values = [];
  const seen = new Set();
  const visit = value => {
    if (value == null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    values.push(value);
    if (Array.isArray(value)) value.forEach(visit);
    else Object.values(value).forEach(visit);
  };
  visit(root);
  return values;
}
