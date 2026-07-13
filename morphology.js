import { WordsEngine, dictionaryForm } from "./vendor/whitakers/whitakers-words.js";

let enginePromise = null;

export function prepareMorphology() {
  if (enginePromise) return enginePromise;
  enginePromise = Promise.all([
    loadGzipText("vendor/whitakers/data/DICTLINE.GEN.gz"),
    loadText("vendor/whitakers/data/DICTLINE.SUP"),
    loadText("vendor/whitakers/data/INFLECTS.LAT"),
    loadText("vendor/whitakers/data/ADDONS.LAT"),
    loadText("vendor/whitakers/data/UNIQUES.LAT")
  ]).then(([dictGen, dictSup, inflects, addons, uniques]) => WordsEngine.create({
    dictline: `${dictGen}\n${dictSup}`,
    inflects,
    addons,
    uniques
  })).catch(error => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

export async function analyzeLatinMorphology(text) {
  const engine = await prepareMorphology();
  return analyzeLatinMorphologyWithEngine(text, engine);
}

export function analyzeLatinMorphologyWithEngine(text, engine) {
  const words = [...new Set(String(text).match(/[\p{L}\p{M}]+/gu)?.map(normalizeLatin) || [])].filter(Boolean);
  const analyses = new Map();
  for (const word of words) analyses.set(word, parseWord(engine, word));
  return analyses;
}

function parseWord(engine, word) {
  const analysis = engine.parseWord(word);
  const standard = [...analysis.results, ...analysis.trickResults].map(result => resultRecord(result));
  const addon = analysis.addonResults.flatMap(addonResult => addonResult.baseResults.map(result => ({
    ...resultRecord(result),
    morphology: { ...morphologyFromInflection(result.ir), enclitic: addonResult.type === "tackon" ? addonResult.addon.word : undefined }
  })));
  const seen = new Set();
  return [...standard, ...addon].filter(result => {
    const key = `${result.citation}|${JSON.stringify(result.morphology)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resultRecord(result) {
  const citation = dictionaryForm(result.de);
  const forms = citation
    .split(/\s{2,}/)[0]
    .split(",")
    .map(form => normalizeLatin(form.replace(/\([^)]*\)/g, "")))
    .filter(Boolean);
  return { citation, forms, english: result.de.mean, morphology: morphologyFromInflection(result.ir) };
}

function morphologyFromInflection(inflection) {
  const quality = inflection.qual;
  if (!quality) return {};
  if (quality.pofs === "N") return { part: "n", case: caseName(quality.noun.cs), number: numberName(quality.noun.number), gender: lower(quality.noun.gender) };
  if (quality.pofs === "ADJ") return { part: "adj", case: caseName(quality.adj.cs), number: numberName(quality.adj.number), gender: lower(quality.adj.gender) };
  if (quality.pofs === "VPAR") return { part: "ppa", case: caseName(quality.vpar.cs), number: numberName(quality.vpar.number), gender: lower(quality.vpar.gender), ...tenseVoiceMood(quality.vpar.tenseVoiceMood) };
  if (quality.pofs === "V") return { part: "v", person: quality.verb.person, number: numberName(quality.verb.number), ...tenseVoiceMood(quality.verb.tenseVoiceMood) };
  if (quality.pofs === "ADV") return { part: "adv" };
  return { part: lower(quality.pofs) };
}

function tenseVoiceMood(value = {}) {
  return { tense: tenseName(value.tense), voice: lower(value.voice), mood: moodName(value.mood) };
}

function tenseName(value) {
  return ({ PRES: "present", IMPF: "imperfect", FUT: "future", PERF: "perfect", PLUP: "pluperfect", FUTP: "future-perfect" })[value] || lower(value);
}

function moodName(value) {
  return ({ IND: "indicative", SUB: "subjunctive", IMP: "imperative", INF: "infinitive", PPL: "participle" })[value] || lower(value);
}

function numberName(value) {
  if (value === "S") return "singular";
  if (value === "P") return "plural";
  return lower(value);
}

function caseName(value) {
  return ({ NOM: "nominative", VOC: "vocative", GEN: "genitive", DAT: "dative", ACC: "accusative", ABL: "ablative", LOC: "locative" })[value] || lower(value);
}

function lower(value) {
  return value ? String(value).toLocaleLowerCase("en") : undefined;
}

function normalizeLatin(value) {
  return String(value)
    .normalize("NFD")
    .toLocaleLowerCase("la")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("j", "i")
    .replace(/[^a-z]/g, "");
}

async function loadText(path) {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) throw new Error(`Formendaten fehlen (${response.status}).`);
  return response.text();
}

async function loadGzipText(path) {
  if (!("DecompressionStream" in globalThis)) throw new Error("Dieser Browser unterstützt das lokale Formenlexikon nicht.");
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok || !response.body) throw new Error(`Formendaten fehlen (${response.status}).`);
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
