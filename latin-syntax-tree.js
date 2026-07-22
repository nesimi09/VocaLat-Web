/**
 * Structural representation and confidence estimates for the deterministic
 * Latin parser.  This module deliberately knows nothing about individual
 * sentences or German translations: it only turns parser dependencies into a
 * stable tree and makes the parser's existing alternatives inspectable.
 */

const DEPENDENCY_PRIORITY = Object.freeze({
  subject: 100,
  "direct-object": 95,
  "indirect-object": 94,
  "predicate-nominative": 93,
  "prepositional-object": 90,
  apposition: 86,
  "genitive-attribute": 84,
  attribute: 82,
  participle: 81,
  coordination: 78,
  vocative: 70,
  antecedent: 65
});

const DEPENDENT_CLAUSE_TYPES = new Set([
  "relative", "free-relative", "indirect-question", "final",
  "negative-final", "consecutive", "conditional", "causal", "temporal",
  "temporal-anterior", "concessive", "content", "complement", "prohibition"
]);

/** Add normalized probabilities without discarding any morphological reading. */
export function annotateMorphologyConfidence(words = []) {
  return words.map(word => {
    const candidates = Array.isArray(word.candidates) ? word.candidates : [];
    if (!candidates.length) {
      return {
        ...word,
        analysisConfidence: word.morphology?.part && word.morphology.part !== "x" ? .5 : 0,
        analysisMargin: 0,
        analysisAlternatives: []
      };
    }

    const probabilities = softmax(candidates.map(candidate => finiteNumber(candidate.score)));
    const alternatives = candidates.map((candidate, index) => ({
      entry: candidate.entry || null,
      morphology: candidate.morphology || {},
      score: finiteNumber(candidate.score),
      probability: probabilities[index]
    })).sort((left, right) => right.probability - left.probability);
    const selectedIndex = candidates.findIndex(candidate => sameAnalysis(candidate, word.selected));
    const selectedProbability = selectedIndex >= 0 ? probabilities[selectedIndex] : alternatives[0]?.probability || 0;
    const competing = alternatives.filter(alternative => !sameAnalysis(alternative, word.selected));
    const selectedScore = selectedIndex >= 0 ? finiteNumber(candidates[selectedIndex].score) : finiteNumber(alternatives[0]?.score);
    const competingScore = finiteNumber(competing[0]?.score, selectedScore);

    return {
      ...word,
      analysisConfidence: roundProbability(selectedProbability),
      analysisMargin: roundScore(selectedScore - competingScore),
      analysisAlternatives: alternatives.map(alternative => ({
        ...alternative,
        probability: roundProbability(alternative.probability)
      }))
    };
  });
}

/**
 * Convert flat clause/dependency records into a rooted clause tree containing
 * one dependency tree per clause. Cross-clause links (for example relative
 * antecedents) stay explicit rather than duplicating token nodes.
 */
export function buildLatinSyntaxTree(parse = {}) {
  const words = Array.isArray(parse.words) ? parse.words : [];
  const clauses = Array.isArray(parse.clauses) ? parse.clauses : [];
  if (!clauses.length) {
    return {
      type: "sentence",
      rootClauseId: null,
      confidence: 0,
      clauses: [],
      crossClauseLinks: [],
      parentheticals: detectParentheticals(words),
      unattachedTokenIndexes: words.map(word => word.index)
    };
  }

  const rootClauseId = parse.rootClauseId || clauses.find(clause => clause.type === "main")?.id || clauses[0].id;
  const clauseRecords = clauses.map(clause => buildClauseRecord(clause, words));
  const clauseById = new Map(clauseRecords.map(clause => [clause.id, clause]));
  const crossClauseLinks = (parse.dependencies || []).filter(link => {
    const headClause = clauseForToken(clauses, link.headIndex);
    const dependentClause = clauseForToken(clauses, link.dependentIndex);
    return headClause && dependentClause && headClause.id !== dependentClause.id;
  }).map(link => ({ ...link }));

  for (const record of clauseRecords) {
    if (record.id === rootClauseId) continue;
    const source = clauses.find(clause => clause.id === record.id);
    const parentId = chooseParentClause(source, clauses, rootClauseId);
    record.parentClauseId = parentId;
    record.relation = clauseRelation(source);
    const parent = clauseById.get(parentId) || clauseById.get(rootClauseId);
    if (parent) parent.clauses.push(record);
  }

  const nestedIds = new Set(clauseRecords.filter(clause => clause.parentClauseId).map(clause => clause.id));
  const roots = clauseRecords.filter(clause => !nestedIds.has(clause.id));
  roots.sort(compareClauseOrder);
  for (const clause of clauseRecords) clause.clauses.sort(compareClauseOrder);

  const covered = new Set(clauses.flatMap(clause => clause.tokenIndexes || []));
  const unattachedTokenIndexes = words.map(word => word.index).filter(index => !covered.has(index));
  const lexicalConfidence = mean(words.filter(word => !isStructural(word)).map(word => word.analysisConfidence ?? .5), .5);
  const structuralConfidence = mean(clauseRecords.map(clause => clause.confidence), 0);

  return {
    type: parse.type || "sentence",
    rootClauseId,
    confidence: roundProbability(.45 * lexicalConfidence + .55 * structuralConfidence),
    clauses: roots,
    flatClauses: clauseRecords,
    crossClauseLinks,
    parentheticals: detectParentheticals(words),
    unattachedTokenIndexes
  };
}

/** Compact public summary for diagnostics; generation still emits one result. */
export function summarizeAnalysisConfidence(words = [], syntaxTree = null) {
  const ambiguous = words.filter(word => (word.analysisAlternatives || []).length > 1)
    .map(word => ({
      index: word.index,
      token: word.raw,
      selected: analysisLabel(word.selected || word),
      confidence: word.analysisConfidence ?? 0,
      alternatives: (word.analysisAlternatives || []).slice(0, 5).map(alternative => ({
        lemma: alternative.morphology?.dictionaryLemma || alternative.entry?.lemma || alternative.entry?.latein || null,
        morphology: alternative.morphology,
        probability: alternative.probability
      }))
    }));
  return {
    confidence: syntaxTree?.confidence ?? roundProbability(mean(words.map(word => word.analysisConfidence ?? .5), 0)),
    ambiguous,
    selectedInterpretationOnly: true
  };
}

function buildClauseRecord(clause, words) {
  const indexes = [...new Set(clause.tokenIndexes || [])].filter(index => words[index]).sort((a, b) => a - b);
  const indexSet = new Set(indexes);
  const localDependencies = (clause.dependencies || []).filter(link =>
    indexSet.has(link.dependentIndex) && (link.headIndex == null || indexSet.has(link.headIndex))
  );
  const incoming = chooseIncomingDependencies(localDependencies);
  const headIndex = indexSet.has(clause.headIndex) ? clause.headIndex : chooseFallbackHead(indexes, words);
  const childrenByHead = new Map();
  const roots = [];

  for (const index of indexes) {
    if (index === headIndex) continue;
    const link = incoming.get(index);
    const proposedHead = link?.headIndex;
    const parentIndex = proposedHead != null && proposedHead !== index && !createsCycle(index, proposedHead, incoming)
      ? proposedHead
      : headIndex;
    if (parentIndex == null || parentIndex === index) roots.push(index);
    else {
      const children = childrenByHead.get(parentIndex) || [];
      children.push({ index, relation: link?.type || inferFallbackRelation(words[index]) });
      childrenByHead.set(parentIndex, children);
    }
  }

  if (headIndex != null) roots.unshift(headIndex);
  const uniqueRoots = [...new Set(roots)];
  const tokenTrees = uniqueRoots.map(index => makeTokenNode(index, words, childrenByHead, new Set()));
  const dependencyCoverage = indexes.length <= 1 ? 1 : incoming.size / Math.max(indexes.length - 1, 1);
  const hasPredicate = headIndex != null;
  const hasSubject = Boolean(clause.roles?.subject?.length) || implicitSubjectAllowed(words[headIndex]);
  const confidence = roundProbability(.5 * Math.min(1, dependencyCoverage) + .3 * Number(hasPredicate) + .2 * Number(hasSubject));

  return {
    type: "clause",
    id: clause.id,
    clauseType: clause.type,
    relation: ["main", "question"].includes(clause.type) ? "root" : clauseRelation(clause),
    parentClauseId: null,
    markerIndex: clause.markerIndex ?? null,
    headIndex,
    tokenIndexes: indexes,
    roles: cloneRoles(clause.roles),
    confidence,
    tokens: tokenTrees,
    clauses: []
  };
}

function chooseIncomingDependencies(dependencies) {
  const incoming = new Map();
  for (const link of dependencies) {
    if (link?.dependentIndex == null) continue;
    const existing = incoming.get(link.dependentIndex);
    if (!existing || dependencyPriority(link) > dependencyPriority(existing)) incoming.set(link.dependentIndex, link);
  }
  return incoming;
}

function makeTokenNode(index, words, childrenByHead, visited) {
  const word = words[index];
  if (!word) return null;
  if (visited.has(index)) return tokenSnapshot(word, "cycle-reference", []);
  const nextVisited = new Set(visited).add(index);
  const children = (childrenByHead.get(index) || [])
    .sort((left, right) => left.index - right.index)
    .map(child => {
      const node = makeTokenNode(child.index, words, childrenByHead, nextVisited);
      return node ? { ...node, relation: child.relation } : null;
    }).filter(Boolean);
  return tokenSnapshot(word, "root", children);
}

function tokenSnapshot(word, relation, children) {
  return {
    type: "token",
    index: word.index,
    form: word.raw,
    lemma: word.lemma || word.normalized,
    part: word.morphology?.part || null,
    morphology: { ...(word.morphology || {}) },
    relation,
    confidence: word.analysisConfidence ?? .5,
    children
  };
}

function chooseParentClause(clause, clauses, rootClauseId) {
  if (!clause) return rootClauseId;
  if (clause.type === "relative" && clause.antecedentIndex != null) {
    return clauseForToken(clauses, clause.antecedentIndex, clause.id)?.id || rootClauseId;
  }
  if (clause.type === "coordinate") return rootClauseId;

  const span = clauseSpan(clause);
  const enclosing = clauses.filter(candidate => candidate.id !== clause.id && candidate.id !== rootClauseId)
    .map(candidate => ({ candidate, span: clauseSpan(candidate) }))
    .filter(item => item.span.start <= span.start && item.span.end >= span.end)
    .sort((left, right) => (left.span.end - left.span.start) - (right.span.end - right.span.start))[0];
  return enclosing?.candidate.id || rootClauseId;
}

function clauseRelation(clause) {
  if (clause?.type === "coordinate") return "coordinate";
  if (clause?.type === "relative") return "relative-modifier";
  if (clause?.type === "free-relative") return "nominal-clause";
  if (clause?.type === "indirect-question") return "interrogative-complement";
  if (DEPENDENT_CLAUSE_TYPES.has(clause?.type)) return "subordinate";
  return "parataxis";
}

function detectParentheticals(words) {
  const stack = [];
  const ranges = [];
  for (const word of words) {
    const marks = word.punctuationAfter || [];
    for (const mark of marks) {
      if (["(", "[", "{"].includes(mark)) stack.push({ mark, startIndex: word.index + 1 });
      else if ([")", "]", "}"].includes(mark) && stack.length) {
        const opening = stack.pop();
        ranges.push({
          type: "parenthetical",
          opening: opening.mark,
          closing: mark,
          startIndex: opening.startIndex,
          endIndex: word.index,
          tokenIndexes: range(opening.startIndex, word.index)
        });
      }
    }
  }
  return ranges;
}

function createsCycle(dependentIndex, headIndex, incoming) {
  const visited = new Set([dependentIndex]);
  let cursor = headIndex;
  while (cursor != null) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = incoming.get(cursor)?.headIndex;
  }
  return false;
}

function clauseForToken(clauses, tokenIndex, excludedId = null) {
  if (tokenIndex == null) return null;
  return clauses.find(clause => clause.id !== excludedId && clause.tokenIndexes?.includes(tokenIndex)) || null;
}

function chooseFallbackHead(indexes, words) {
  return indexes.find(index => isFiniteMorphology(words[index]?.morphology))
    ?? indexes.find(index => words[index]?.morphology?.mood === "infinitive")
    ?? indexes.find(index => !isStructural(words[index]))
    ?? indexes[0]
    ?? null;
}

function implicitSubjectAllowed(word) {
  if (!word) return false;
  if (isFiniteMorphology(word.morphology)) return true;
  return word.morphology?.mood === "infinitive";
}

function inferFallbackRelation(word) {
  const part = word?.morphology?.part;
  if (["conj", "prep"].includes(part)) return "marker";
  if (part === "adv") return "adverbial";
  if (["adj", "ppa", "participle"].includes(part)) return "modifier";
  return "dependent";
}

function isStructural(word) {
  return ["conj", "prep"].includes(word?.morphology?.part)
    || ["que", "ve", "ne"].includes(word?.normalized);
}

function isFiniteMorphology(morphology = {}) {
  return ["indicative", "subjunctive", "imperative"].includes(morphology.mood);
}

function sameAnalysis(candidate, selected) {
  if (!candidate || !selected) return false;
  return analysisLabel(candidate) === analysisLabel(selected);
}

function analysisLabel(candidate) {
  const morphology = candidate?.morphology || candidate || {};
  return [
    morphology.dictionaryLemma || candidate?.entry?.lemma || candidate?.entry?.latein || "",
    morphology.part, morphology.case, morphology.number, morphology.gender,
    morphology.person, morphology.tense, morphology.mood, morphology.voice,
    morphology.comparison, morphology.nonFiniteType, morphology.supineUse
  ].join("|");
}

function softmax(scores) {
  if (!scores.length) return [];
  const maximum = Math.max(...scores);
  const weights = scores.map(score => Math.exp(Math.max(-30, Math.min(30, score - maximum))));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights.map(weight => weight / total);
}

function dependencyPriority(link) {
  return DEPENDENCY_PRIORITY[link?.type] || 50;
}

function clauseSpan(clause) {
  const indexes = clause?.tokenIndexes || [];
  return { start: Math.min(...indexes, Number.POSITIVE_INFINITY), end: Math.max(...indexes, Number.NEGATIVE_INFINITY) };
}

function compareClauseOrder(left, right) {
  return (left.tokenIndexes?.[0] ?? 0) - (right.tokenIndexes?.[0] ?? 0);
}

function cloneRoles(roles = {}) {
  return Object.fromEntries(Object.entries(roles).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.map(item => item && typeof item === "object" ? { ...item } : item) : value
  ]));
}

function mean(values, fallback) {
  return values.length ? values.reduce((sum, value) => sum + finiteNumber(value), 0) / values.length : fallback;
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function roundProbability(value) {
  return Math.round(Math.max(0, Math.min(1, finiteNumber(value))) * 1000) / 1000;
}

function roundScore(value) {
  return Math.round(finiteNumber(value) * 1000) / 1000;
}

function range(start, end) {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}
