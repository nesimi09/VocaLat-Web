import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { WordsEngine } from "../vendor/whitakers/whitakers-words.js";
import { analyzeLatinMorphologyWithEngine } from "../morphology.js";
import { analyzeBookText } from "../learning-engine.js";
import { translateLatinSyntax } from "../latin-syntax-translator.js";

const readText = path => readFileSync(new URL(path, import.meta.url), "utf8");
const readJson = path => JSON.parse(readText(path));
const holdout = readJson("../tests/fixtures/translation-holdout.json");
const vocabulary = readJson("../data/vocabulary.json").filter(entry => entry.latein?.trim() && entry.deutsch?.trim());
const grammar = readJson("../data/grammar.json").abschnitte || [];
const fallback = readJson("../data/fallback-lexicon.json").entries || [];
const engine = WordsEngine.create({
  dictline: `${gunzipSync(readFileSync(new URL("../vendor/whitakers/data/DICTLINE.GEN.gz", import.meta.url))).toString("utf8")}\n${readText("../vendor/whitakers/data/DICTLINE.SUP")}`,
  inflects: readText("../vendor/whitakers/data/INFLECTS.LAT"),
  addons: readText("../vendor/whitakers/data/ADDONS.LAT"),
  uniques: readText("../vendor/whitakers/data/UNIQUES.LAT")
});

const failures = [];
const metrics = [];

for (const sample of holdout.cases) {
  try {
    const morphology = analyzeLatinMorphologyWithEngine(sample.latin, engine);
    const result = analyzeBookText(sample.latin, vocabulary, grammar, null, fallback, morphology);
    const syntax = translateLatinSyntax(result.matches, { source: sample.latin });
    const checks = [];

    checks.push([Boolean(syntax.pipeline), "pipeline evidence missing"]);
    checks.push([result.coverage >= sample.minimumCoverage, `coverage ${result.coverage}% < ${sample.minimumCoverage}%`]);
    checks.push([result.unresolvedWords === 0, `${result.unresolvedWords} unresolved word(s)`]);
    checks.push([Boolean(result.translation.trim()), "empty translation"]);
    checks.push([!/\s·\s|\[[^\]]+\]/u.test(result.translation), "word-list fallback leaked into output"]);
    for (const tag of sample.tags || []) checks.push([hasTag(syntax.pipeline, tag), `missing construction ${tag}`]);
    for (const role of sample.roles || []) checks.push([hasRole(syntax.pipeline, role.role, role.token), `${role.token} is not ${role.role}`]);
    for (const pattern of sample.concepts || []) checks.push([new RegExp(pattern, "iu").test(result.translation), `missing concept /${pattern}/`]);
    for (const pattern of sample.forbiddenPatterns || []) checks.push([!new RegExp(pattern, "iu").test(result.translation), `forbidden pattern /${pattern}/`]);

    const failed = checks.filter(([passed]) => !passed).map(([, message]) => message);
    failures.push(...failed.map(message => `${sample.id}: ${message}`));
    metrics.push({
      id: sample.id,
      coverage: result.coverage,
      unresolved: result.unresolvedWords,
      checks: checks.length,
      passed: checks.length - failed.length
    });
  } catch (error) {
    failures.push(`${sample.id}: pipeline error: ${error.message}`);
    metrics.push({ id: sample.id, coverage: 0, unresolved: null, checks: 1, passed: 0 });
  }
}

const totalChecks = metrics.reduce((total, metric) => total + metric.checks, 0);
const passedChecks = metrics.reduce((total, metric) => total + metric.passed, 0);
const summary = {
  corpus: "general-structural-holdout",
  cases: metrics.length,
  constructions: [...new Set(holdout.cases.flatMap(sample => sample.tags || []))].sort(),
  averageCoverage: Math.round(metrics.reduce((total, metric) => total + metric.coverage, 0) / Math.max(metrics.length, 1)),
  checks: totalChecks,
  passedChecks,
  passRate: totalChecks ? Math.round(passedChecks / totalChecks * 1000) / 10 : 0,
  failedCases: failures.length ? [...new Set(failures.map(failure => failure.split(":", 1)[0]))].length : 0
};

console.log(JSON.stringify(summary, null, 2));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
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
    return (nodeRole === role || nodeRole.includes(role) || role.includes(nodeRole)) && walk(node).some(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      return [value.token, value.surface, value.raw, value.form, value.word, value.lemma]
        .some(candidate => normalizeLatin(candidate) === token);
    });
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
