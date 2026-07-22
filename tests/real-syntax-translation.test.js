import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { WordsEngine } from "../vendor/whitakers/whitakers-words.js";
import { analyzeLatinMorphologyWithEngine } from "../morphology.js";
import { analyzeBookText } from "../learning-engine.js";
import { translateLatinSyntax } from "../latin-syntax-translator.js";

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
  const result = analyzeBookText(latin, vocabulary, grammar, null, fallback, morphology);
  const syntax = translateLatinSyntax(result.matches, { source: latin });
  return { result, syntax };
}

test("case information keeps subject and object stable when Latin word order changes", () => {
  const variants = [
    translate("Puella rosam amat."),
    translate("Rosam puella amat.")
  ];

  for (const { result, syntax } of variants) {
    assert.equal(result.coverage, 100);
    assert.equal(result.unresolvedWords, 0);
    assert.equal(hasRole(syntax.pipeline, "subject", "puella"), true);
    assert.equal(hasRole(syntax.pipeline, "direct-object", "rosam"), true);
    assert.match(result.translation, /Mädchen/iu);
    assert.match(result.translation, /Rose/iu);
    assert.match(result.translation, /lieb/iu);
    assert.doesNotMatch(result.translation, /\s·\s|\[[^\]]+\]/u);
  }
});

test("active and passive forms produce different German clause structures", () => {
  const active = translate("Mater epistulam scribit.");
  const passive = translate("Epistula a matre scribitur.");

  for (const sample of [active, passive]) {
    assert.equal(sample.result.coverage, 100);
    assert.match(sample.result.translation, /Mutter/iu);
    assert.match(sample.result.translation, /Brief/iu);
  }
  assert.doesNotMatch(active.result.translation, /wird.+geschrieb/iu);
  assert.match(passive.result.translation, /wird.+geschrieb/iu);
  assert.notEqual(active.result.translation, passive.result.translation);
});

test("major constructions are exposed by the same general parser", () => {
  const samples = [
    ["Caesar dixit milites urbem cepisse.", "aci"],
    ["Milites urbem cepisse dicuntur.", "nci"],
    ["Urbe capta milites discesserunt.", "ablative-absolute"],
    ["Liber discipulo legendus est.", "gerundive-obligation"],
    ["Puer librum legens ambulat.", "present-participle"],
    ["Dux milites misit ut urbem defenderent.", "final"],
    ["Si laboras, disces.", "conditional"],
    ["Puella, quam magister laudat, laborat.", "relative-clause"]
  ];

  for (const [latin, construction] of samples) {
    const { result, syntax } = translate(latin);
    assert.equal(result.unresolvedWords, 0, latin);
    assert.equal(hasTag(syntax.pipeline, construction), true, `${latin}: ${construction}`);
    assert.doesNotMatch(result.translation, /\s·\s|\[[^\]]+\]/u, latin);
  }
});

test("public results do not expose a sentence-memory shortcut", () => {
  const { result, syntax } = translate("Agricola equum videt.");
  for (const output of [result, syntax]) {
    assert.equal(Object.hasOwn(output, "translationVerified"), false);
    assert.equal(Object.hasOwn(output, "verifiedLines"), false);
    assert.equal(Object.hasOwn(output, "memoryMatch"), false);
  }
  assert.ok(syntax.pipeline);
});

test("classical prose combines expressions, ethnonyms, agreement and AcI without sentence shortcuts", () => {
  const cause = translate("Qua de causa Helvetii quoque reliquos Gallos virtute praecedunt.").result.translation;
  assert.match(cause, /^Die Helvetier.+aus diesem Grund.+die Gallier.+an der (?:Tüchtigkeit|Tapferkeit)/iu);

  const passive = translate("Nam omnis civitas Helvetia in quattuor pagos divisa est.").result.translation;
  assert.match(passive, /^Denn die ganze helvetische Bürgerschaft wurde in vier Bezirke geteilt\.$/u);

  const aci = translate("Patere tua consilia non sentis.").result.translation;
  assert.match(aci, /^Du bemerkst nicht, dass deine Pläne offen stehen\.$/u);

  const rivers = translate("Gallos ab Aquitanis Garumna flumen, a Belgis Matrona et Sequana dividit.").result.translation;
  assert.match(rivers, /Garumna.+Fluss.+Matrona.+Sequana.+trennen.+Gallier.+Aquitanier.+Belgier/iu);
  assert.doesNotMatch(rivers, /Hahn/iu);
});

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
    if (!(nodeRole === role || nodeRole.includes(role) || role.includes(nodeRole))) return false;
    return walk(node).some(value => [value?.token, value?.surface, value?.raw, value?.form, value?.word, value?.lemma]
      .some(candidate => normalizeLatin(candidate) === token));
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
