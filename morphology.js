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
  const standard = (analysis.results || []).map(result => resultRecord(result, { origin: "dictionary" }));
  const trick = (analysis.trickResults || []).map(result => resultRecord(result, { origin: "orthographic-trick" }));
  const contractions = contractedPerfectVariants(word).flatMap(variant => {
    const expanded = engine.parseWord(variant);
    return (expanded.results || [])
      .map(result => resultRecord(result, { origin: "orthographic-contraction", variant }))
      .filter(record => record.morphology.part === "v" && record.morphology.tense === "perfect" && record.morphology.mood === "indicative");
  });
  const addon = (analysis.addonResults || []).flatMap(addonResult => (addonResult.baseResults || []).map(result => {
    const addonText = addonResult.type === "tackon" ? addonResult.addon?.word : addonResult.addon?.fix;
    const record = resultRecord(result, { origin: "addon", addonType: addonResult.type, addon: addonText });
    return {
      ...record,
      morphology: {
        ...record.morphology,
        enclitic: addonResult.type === "tackon" ? addonText : undefined
      }
    };
  }));
  const seen = new Set();
  return [...standard, ...trick, ...contractions, ...addon].filter(result => {
    const key = `${result.provenance.entryIndex ?? result.citation}|${JSON.stringify(result.morphology)}|${result.provenance.origin}|${result.provenance.addon || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contractedPerfectVariants(word) {
  const variants = [];
  // Classical and school texts regularly contract -ivi- in fourth-
  // conjugation compounds: abiit < abivit, redierunt < rediverunt.  Expanding
  // only these diagnostic endings avoids speculative spelling correction.
  if (word.endsWith("iit") && word.length > 3) variants.push(`${word.slice(0, -3)}ivit`);
  if (word.endsWith("ierunt") && word.length > 6) variants.push(`${word.slice(0, -6)}iverunt`);
  return variants;
}

function resultRecord(result, evidence = {}) {
  const citation = dictionaryForm(result.de);
  const forms = citation
    .split(/\s{2,}/)[0]
    .split(",")
    .map(form => normalizeLatin(form.replace(/\([^)]*\)/g, "")))
    .filter(Boolean);
  const lexemeFrequency = result.de?.tran?.freq;
  const inflectionFrequency = result.ir?.freq;
  const morphology = morphologyFromInflection(result.ir, result.de);
  // Keep lexical evidence beside the grammatical features because the
  // learning engine deliberately passes morphology candidates, rather than
  // Whitaker's complete result objects, into the syntax pipeline.  Frequency
  // is only a tie-breaker there; it must never replace sentence grammar.
  morphology.dictionaryLemma = forms[0];
  morphology.dictionaryFrequencyRank = frequencyRank(lexemeFrequency || inflectionFrequency);
  morphology.dictionaryOrigin = evidence.origin || "dictionary";
  return {
    citation,
    forms,
    english: result.de.mean,
    morphology,
    frequency: {
      lexeme: lexemeFrequency,
      inflection: inflectionFrequency,
      rank: frequencyRank(lexemeFrequency || inflectionFrequency)
    },
    provenance: {
      origin: evidence.origin || "dictionary",
      entryIndex: Number.isInteger(result.entryIndex) ? result.entryIndex : undefined,
      inflectionKey: result.ir?.key,
      dictionaryAge: result.de?.tran?.age,
      dictionaryArea: result.de?.tran?.area,
      dictionaryGeography: result.de?.tran?.geo,
      dictionarySource: result.de?.tran?.source,
      addonType: evidence.addonType,
      addon: evidence.addon,
      orthographicVariant: evidence.variant
    }
  };
}

function morphologyFromInflection(inflection = {}, dictionaryEntry = {}) {
  const quality = inflection.qual;
  if (!quality) return {};
  if (quality.pofs === "N") return { part: "n", case: caseName(quality.noun.cs), number: numberName(quality.noun.number), gender: lower(quality.noun.gender) };
  if (quality.pofs === "PRON") return {
    part: "pron",
    case: caseName(quality.pron.cs),
    number: numberName(quality.pron.number),
    gender: lower(quality.pron.gender),
    pronounKind: pronounKindName(dictionaryEntry.part?.pron?.kind)
  };
  if (quality.pofs === "PACK") return {
    part: "pack",
    case: caseName(quality.pack.cs),
    number: numberName(quality.pack.number),
    gender: lower(quality.pack.gender),
    pronounKind: pronounKindName(dictionaryEntry.part?.pack?.kind),
    pronounLike: true
  };
  if (quality.pofs === "ADJ") return {
    part: "adj",
    case: caseName(quality.adj.cs),
    number: numberName(quality.adj.number),
    gender: lower(quality.adj.gender),
    comparison: comparisonName(quality.adj.comparison)
  };
  if (quality.pofs === "NUM") return {
    part: "num",
    case: caseName(quality.num.cs),
    number: numberName(quality.num.number),
    gender: lower(quality.num.gender),
    numeralKind: numeralKindName(quality.num.sort)
  };
  if (quality.pofs === "VPAR") {
    const morphology = {
      part: "ppa",
      case: caseName(quality.vpar.cs),
      number: numberName(quality.vpar.number),
      gender: lower(quality.vpar.gender),
      ...tenseVoiceMood(quality.vpar.tenseVoiceMood),
      ...lexicalVerbMetadata(dictionaryEntry)
    };
    return { ...morphology, ...participleMetadata(morphology) };
  }
  if (quality.pofs === "V") {
    const morphology = {
      part: "v",
      person: quality.verb.person,
      number: numberName(quality.verb.number),
      ...tenseVoiceMood(quality.verb.tenseVoiceMood),
      ...lexicalVerbMetadata(dictionaryEntry)
    };
    if (morphology.mood === "infinitive") {
      morphology.nonFinite = "infinitive";
      morphology.infinitiveType = [morphology.tense, morphology.voice].filter(Boolean).join("-");
    }
    return morphology;
  }
  if (quality.pofs === "SUPINE") return {
    part: "supine",
    case: caseName(quality.supine.cs),
    number: numberName(quality.supine.number),
    gender: lower(quality.supine.gender),
    nonFinite: "supine",
    supineUse: quality.supine.cs === "ACC" ? "purpose" : quality.supine.cs === "ABL" ? "specification" : undefined,
    ...lexicalVerbMetadata(dictionaryEntry)
  };
  if (quality.pofs === "PREP") return { part: "prep", governsCase: caseName(quality.prep.cs) };
  if (quality.pofs === "ADV") return { part: "adv", comparison: comparisonName(quality.adv.comparison) };
  return { part: lower(quality.pofs) };
}

function participleMetadata(morphology) {
  const type = morphology.tense === "present" && morphology.voice === "active" ? "present-active"
    : morphology.tense === "perfect" && morphology.voice === "passive" ? "perfect-passive"
      : morphology.tense === "future" && morphology.voice === "active" ? "future-active"
        : morphology.tense === "future" && morphology.voice === "passive" ? "future-passive"
          : [morphology.tense, morphology.voice].filter(Boolean).join("-") || "participle";
  const traditionalName = type === "present-active" ? "PPA"
    : type === "perfect-passive" ? "PPP"
      : type === "future-active" ? "PFA"
        : type === "future-passive" ? "Gerundiv"
          : undefined;
  const gerundiveCandidate = type === "future-passive";
  const gerundCandidate = gerundiveCandidate
    && morphology.number === "singular"
    && morphology.gender === "n"
    && ["genitive", "dative", "accusative", "ablative"].includes(morphology.case);
  return {
    nonFinite: "participle",
    participleType: type,
    traditionalName,
    gerundiveCandidate,
    gerundCandidate
  };
}

function lexicalVerbMetadata(dictionaryEntry = {}) {
  const code = dictionaryEntry.part?.pofs === "V" ? dictionaryEntry.part.v?.kind : undefined;
  if (!code || code === "X") return {};
  const verbKind = ({
    TO_BE: "copular",
    TO_BEING: "copular-participle",
    GEN: "governs-genitive",
    DAT: "governs-dative",
    ABL: "governs-ablative",
    TRANS: "transitive",
    INTRANS: "intransitive",
    IMPERS: "impersonal",
    DEP: "deponent",
    SEMIDEP: "semideponent",
    PERFDEF: "perfect-defective"
  })[code] || lower(code);
  return {
    verbKind,
    deponent: code === "DEP",
    semideponent: code === "SEMIDEP",
    impersonal: code === "IMPERS",
    semanticVoice: ["DEP", "SEMIDEP"].includes(code) ? "active" : undefined,
    governsCase: ({ GEN: "genitive", DAT: "dative", ABL: "ablative" })[code],
    transitivity: code === "TRANS" ? "transitive" : code === "INTRANS" ? "intransitive" : undefined
  };
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

function comparisonName(value) {
  return ({ POS: "positive", COMP: "comparative", SUPER: "superlative" })[value] || lower(value);
}

function pronounKindName(value) {
  return ({
    PERS: "personal",
    REL: "relative",
    REFLEX: "reflexive",
    DEMONS: "demonstrative",
    INTERR: "interrogative",
    INDEF: "indefinite",
    ADJECT: "adjectival"
  })[value] || lower(value);
}

function numeralKindName(value) {
  return ({ CARD: "cardinal", ORD: "ordinal", DIST: "distributive", ADVERB: "adverbial" })[value] || lower(value);
}

function frequencyRank(value) {
  return ({ A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 })[value] || 0;
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
