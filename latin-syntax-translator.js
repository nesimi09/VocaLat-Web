/**
 * Deterministic Latin -> German translation pipeline.
 *
 * Every public stage accepts the result of the preceding stage and can be
 * tested independently. Dictionary lookup and OCR stay in learning-engine.js;
 * complete source sentences are never looked up or substituted here.
 */

import {
  RESOLVED_STATUSES,
  isFinite,
  partOf,
  interpretLatinGrammar,
  parseLatinSyntax,
  resolveMorphology,
  selectContextualMeanings,
  tokenizeTranslationInput
} from "./latin-analysis.js";
import { SOURCE_WEIGHTS, SUBORDINATORS } from "./latin-language-data.js";
import { generateGermanSentence, postprocessGerman, realizeGermanClausePlan } from "./german-generator.js";
import {
  annotateMorphologyConfidence,
  buildLatinSyntaxTree,
  summarizeAnalysisConfidence
} from "./latin-syntax-tree.js";

export {
  generateGermanSentence,
  interpretLatinGrammar,
  parseLatinSyntax,
  postprocessGerman,
  realizeGermanClausePlan,
  resolveMorphology,
  selectContextualMeanings,
  tokenizeTranslationInput
};

export {
  annotateMorphologyConfidence,
  buildLatinSyntaxTree,
  summarizeAnalysisConfidence
};

/** Prefer a textbook entry only after checking part-of-speech compatibility. */
export function selectPreferredLexeme(entries = [], morphology = {}) {
  const compatible = entries.filter(entry => partMatches(entry?.pos, morphology?.part));
  const pool = compatible.length ? compatible : entries;
  return [...pool].sort((left, right) => (SOURCE_WEIGHTS[right?.source] || 0) - (SOURCE_WEIGHTS[left?.source] || 0))[0] || null;
}

export function translateLatinSyntax(matches = [], options = {}) {
  const tokens = tokenizeTranslationInput(matches, options);
  if (!tokens.length) return {
    text: "",
    reliable: false,
    confidence: 0,
    analysisConfidence: { confidence: 0, ambiguous: [], selectedInterpretationOnly: true },
    unresolved: [],
    diagnostics: ["empty"],
    pipeline: { tokens: [], morphology: [], syntax: null, grammar: null, semantics: null }
  };

  const morphology = annotateMorphologyConfidence(resolveMorphology(tokens, options));
  const parsedSyntax = parseLatinSyntax(morphology, options);
  const syntaxTree = parsedSyntax.tree || buildLatinSyntaxTree(parsedSyntax);
  const syntax = { ...parsedSyntax, tree: syntaxTree, confidence: syntaxTree.confidence };
  const grammar = interpretLatinGrammar(syntax, options);
  const semantics = selectContextualMeanings(grammar, options);
  const generated = generateGermanSentence(semantics, options);
  const text = postprocessGerman(typeof generated === "string" ? generated : generated?.text || "", { question: syntax.type === "question" });

  const expressionIndexes = new Set((semantics.constructions || [])
    .filter(construction => construction.type === "expression")
    .flatMap(construction => construction.indexes || []));
  const lexicalUnresolved = morphology
    .filter(word => {
      if (word.entry && RESOLVED_STATUSES.has(word.status)) return false;
      const semantic = semantics.words[word.index];
      return !semantic?.sense && !expressionIndexes.has(word.index);
    })
    .map(word => word.raw);
  const semanticUnresolved = semantics.words
    .filter(word => !word.sense
      && !expressionIndexes.has(word.index)
      && !["prep", "conj"].includes(partOf(word))
      && !["non", "haud", "que"].includes(word.normalized))
    .map(word => word.raw);
  const unresolved = [...new Set([...lexicalUnresolved, ...semanticUnresolved])];
  const structuralDiagnostics = validateStructure(semantics);
  const diagnostics = [...new Set([
    ...(grammar.diagnostics || []),
    ...structuralDiagnostics,
    ...(!semantics.meaningSelectionComplete && semanticUnresolved.length ? ["meaning-selection-incomplete"] : []),
    ...(text ? [] : ["generation-incomplete"]),
    ...(unresolved.length ? ["unresolved-lexeme"] : [])
  ])];
  const resolvedRatio = (morphology.length - unresolved.length) / Math.max(morphology.length, 1);
  const structuralPenalty = diagnostics.filter(item => item !== "unresolved-lexeme").length * .12;
  const ambiguityPenalty = morphology.filter(word => word.candidates?.length > 1 && (word.candidates[0]?.score || 0) - (word.candidates[1]?.score || 0) < 2).length / Math.max(morphology.length, 1) * .15;
  const pipelineConfidence = Math.max(0, Math.min(1, resolvedRatio - structuralPenalty - ambiguityPenalty));
  const confidence = Math.max(0, Math.min(1, pipelineConfidence * .85 + syntaxTree.confidence * .15));
  const analysisConfidence = summarizeAnalysisConfidence(morphology, syntaxTree);

  return {
    text,
    reliable: unresolved.length === 0 && !diagnostics.some(item => item !== "unresolved-lexeme") && confidence >= .72,
    confidence,
    analysisConfidence,
    unresolved,
    diagnostics,
    lexicalSources: semantics.words.filter(word => word.entry).map(word => ({
      token: word.raw,
      lemma: word.entry.lemma || word.entry.latein,
      source: word.entry.source || "fallback",
      sense: word.sense
    })),
    pipeline: { tokens, morphology, syntax, grammar, semantics },
    analysis: semantics,
    syntax
  };
}

function validateStructure(semantics) {
  const diagnostics = [];
  const clauses = semantics.clauses || [];
  const finiteIndexes = semantics.words.filter(isFinite).map(word => word.index);
  const licensedFinite = new Set(clauses.map(clause => clause.headIndex).filter(index => index != null));
  for (const construction of semantics.constructions || []) {
    for (const key of ["auxiliaryIndex", "governingIndex"]) {
      const index = construction[key];
      if (index != null && isFinite(semantics.words[index])) licensedFinite.add(index);
    }
  }
  if (finiteIndexes.some(index => !licensedFinite.has(index))) diagnostics.push("unassigned-finite-predicate");

  for (const clause of clauses) {
    const hasFinite = clause.tokenIndexes?.some(index => isFinite(semantics.words[index]));
    const licensedEllipsis = (semantics.constructions || []).some(construction =>
      construction.type === "ablative-absolute"
      && [construction.subjectIndex, construction.participleIndex].some(index => clause.tokenIndexes?.includes(index))
    );
    if (!hasFinite && !licensedEllipsis) diagnostics.push("clause-without-finite");
  }

  const claimedMarkers = new Set([
    ...clauses.map(clause => clause.markerIndex).filter(index => index != null),
    ...clauses.flatMap(clause => (clause.roles?.prepositional || []).map(item => item.prepositionIndex)),
    ...(semantics.constructions || []).flatMap(construction => construction.indexes || [])
  ]);
  if (semantics.words.some(word => SUBORDINATORS[word.normalized] && !claimedMarkers.has(word.index))) {
    diagnostics.push("dangling-clause-marker");
  }
  return diagnostics;
}

export function translateLatinPassage(lines = [], options = {}) {
  const results = lines.map(line => {
    const matches = Array.isArray(line) ? line : line.matches || [];
    const source = Array.isArray(line) ? options.source : line.source || options.source;
    return translateLatinSyntax(matches, { ...options, source });
  });
  return {
    text: results.map(result => result.text).filter(Boolean).join("\n"),
    reliable: results.length > 0 && results.every(result => result.reliable),
    confidence: results.length ? results.reduce((sum, result) => sum + result.confidence, 0) / results.length : 0,
    sentences: results
  };
}

function partMatches(entryPart, morphologyPart) {
  if (!entryPart || entryPart === "x" || !morphologyPart || morphologyPart === "x") return true;
  if (morphologyPart === "ppa" || morphologyPart === "participle") return ["v", "ppa", "adj"].includes(entryPart);
  if (entryPart === "proper") return ["n", "proper"].includes(morphologyPart);
  return entryPart === morphologyPart;
}
