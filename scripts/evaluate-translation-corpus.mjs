import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { WordsEngine } from "../vendor/whitakers/whitakers-words.js";
import { analyzeLatinMorphologyWithEngine } from "../morphology.js";
import { analyzeBookText, tokenizeLatinText } from "../learning-engine.js";

const readText = path => readFileSync(new URL(path, import.meta.url), "utf8");
const readJson = path => JSON.parse(readText(path));

const vocabulary = readJson("../data/vocabulary.json").filter(entry => entry.latein?.trim() && entry.deutsch?.trim());
const grammar = readJson("../data/grammar.json").abschnitte || [];
const fallback = readJson("../data/fallback-lexicon.json").entries || [];
const memory = readJson("../data/translation-memory.json").entries || [];
const engine = WordsEngine.create({
  dictline: `${gunzipSync(readFileSync(new URL("../vendor/whitakers/data/DICTLINE.GEN.gz", import.meta.url))).toString("utf8")}\n${readText("../vendor/whitakers/data/DICTLINE.SUP")}`,
  inflects: readText("../vendor/whitakers/data/INFLECTS.LAT"),
  addons: readText("../vendor/whitakers/data/ADDONS.LAT"),
  uniques: readText("../vendor/whitakers/data/UNIQUES.LAT")
});

const failures = [];
const metrics = [];
const unresolvedForms = new Map();
const unresolvedLemmas = new Map();
for (const entry of memory) {
  const morphology = analyzeLatinMorphologyWithEngine(entry.latin, engine);
  const baseline = analyzeBookText(entry.latin, vocabulary, grammar, null, fallback, morphology);
  const exact = analyzeBookText(entry.latin, vocabulary, grammar, null, fallback, morphology, memory);
  const noisyText = injectSingleOcrError(entry.latin);
  const noisy = analyzeBookText(noisyText, vocabulary, grammar, null, fallback, analyzeLatinMorphologyWithEngine(noisyText, engine), memory);
  const punctuationlessText = entry.latin.replace(/[.,;:!?]+/g, " ").replace(/\s+/g, " ").trim();
  const punctuationless = analyzeBookText(punctuationlessText, vocabulary, grammar, null, fallback, analyzeLatinMorphologyWithEngine(punctuationlessText, engine), memory);

  if (!exact.translationVerified || exact.translation !== entry.german) failures.push(`${entry.id || entry.latin.slice(0, 32)}: exact match failed`);
  if (!noisy.translationVerified || noisy.translation !== entry.german) failures.push(`${entry.id || entry.latin.slice(0, 32)}: OCR tolerance failed`);
  if (!punctuationless.translationVerified || punctuationless.translation !== entry.german) failures.push(`${entry.id || entry.latin.slice(0, 32)}: punctuation tolerance failed`);
  metrics.push({
    id: entry.id || "nessus",
    author: entry.author || "Hyginus",
    tokens: tokenizeLatinText(entry.latin).length,
    coverage: baseline.coverage,
    unresolved: baseline.unresolvedWords
  });
  baseline.matches
    .filter(match => ["candidate", "unknown"].includes(match.status))
    .forEach(match => {
      unresolvedForms.set(match.normalized, (unresolvedForms.get(match.normalized) || 0) + 1);
      const lemmas = (morphology.get(match.normalized) || []).flatMap(analysis => analysis.forms.slice(0, 1));
      unresolvedLemmas.set(match.normalized, [...new Set(lemmas)]);
    });
}

const summary = {
  entries: memory.length,
  authors: new Set(metrics.map(metric => metric.author)).size,
  tokens: metrics.reduce((total, metric) => total + metric.tokens, 0),
  averageVocabularyCoverage: Math.round(metrics.reduce((total, metric) => total + metric.coverage, 0) / Math.max(metrics.length, 1)),
  minimumVocabularyCoverage: Math.min(...metrics.map(metric => metric.coverage)),
  unresolvedTokens: metrics.reduce((total, metric) => total + metric.unresolved, 0),
  exactVerified: memory.length - failures.filter(failure => failure.endsWith("exact match failed")).length,
  ocrErrorVerified: memory.length - failures.filter(failure => failure.endsWith("OCR tolerance failed")).length,
  punctuationlessVerified: memory.length - failures.filter(failure => failure.endsWith("punctuation tolerance failed")).length,
  unresolvedForms: [...unresolvedForms.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([form, count]) => ({ form, count, lemmas: unresolvedLemmas.get(form) }))
};

if (summary.entries < 60) failures.push(`corpus too small: ${summary.entries}`);
if (summary.authors < 9) failures.push(`author coverage too small: ${summary.authors}`);
if (summary.unresolvedTokens > 0 || summary.minimumVocabularyCoverage < 100) failures.push(`vocabulary coverage incomplete: ${summary.unresolvedTokens} unresolved token(s)`);

console.log(JSON.stringify(summary, null, 2));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}

function injectSingleOcrError(text) {
  const token = tokenizeLatinText(text).map(item => item.raw).find(item => item.length >= 6);
  if (!token) return text;
  const index = Math.floor(token.length / 2);
  const damaged = `${token.slice(0, index)}${token.slice(index + 1)}`;
  return text.replace(token, damaged);
}
