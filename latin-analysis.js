import {
  ANIMATE_LEMMAS,
  COORDINATORS,
  DISCOURSE_ADVERBS,
  GERMAN_ADJECTIVE_LEMMA_SENSES,
  INTERROGATIVE_FORMS,
  IRREGULAR_LATIN_FORMS,
  LATIN_EXPRESSIONS,
  LATIN_ETHNONYM_LEMMAS,
  LATIN_IDIOMS,
  LATIN_LOCATIVES,
  LATIN_PREPOSITIONS,
  PERSONAL_PRONOUNS,
  PRONOMINAL_ADJECTIVE_LEMMAS,
  RELATIVE_FORMS,
  SOURCE_WEIGHTS,
  SUBSTANTIVIZED_ADJECTIVES,
  SUBORDINATORS,
  VERB_CLASSES,
  VERB_FRAMES
} from "./latin-language-data.js";
import { buildLatinSyntaxTree } from "./latin-syntax-tree.js";

const FINITE_MOODS = new Set(["indicative", "subjunctive", "imperative"]);
const NOMINAL_PARTS = new Set(["n", "pron", "proper", "adj", "num"]);
const RESOLVED_STATUSES = new Set(["exact", "book-form", "fallback", "contextual", "proper", "corrected", "ambiguous"]);
const TOKEN_PATTERN = /[\p{L}\p{M}]+(?:[’'][\p{L}\p{M}]+)?|[.,;:!?()[\]{}„“‚‘’«»—–-]/gu;
const DEMONSTRATIVE_LEMMAS = new Set(["hic", "ille", "iste", "ipse", "idem", "is"]);
const NON_ENCLITIC_QUE_FORMS = new Set([
  "absque", "atque", "denique", "itaque", "neque", "plerumque", "quoque", "ubique", "undique", "usque", "utique"
]);

/** Stage 1: turn source text or learning-engine matches into stable tokens. */
export function tokenizeTranslationInput(input = [], options = {}) {
  if (typeof input === "string") return tokenizeSource(input);
  const matches = Array.isArray(input) ? input : [];
  // Matches have already been tokenized by the lexical layer. Splitting an
  // apparent enclitic a second time would shift every following punctuation
  // mark (usque was the most visible example).
  const sourceTokens = typeof options.source === "string" ? tokenizeSource(options.source, { splitEnclitics: false }) : [];
  const punctuation = sourceTokens.filter(token => token.kind === "punctuation");
  let sourceWordIndex = 0;
  const words = [];

  matches.forEach((match, matchIndex) => {
    const parts = String(match?.token || "").match(/[\p{L}\p{M}]+(?:[’'][\p{L}\p{M}]+)?/gu) || [];
    const values = parts.length ? parts : [String(match?.token || "")].filter(Boolean);
    values.forEach((raw, partIndex) => {
      const sourceToken = sourceTokens.filter(token => token.kind === "word")[sourceWordIndex++];
      words.push({
        id: `w${words.length}`,
        index: words.length,
        raw,
        token: raw,
        normalized: normalizeLatin(raw),
        kind: "word",
        status: match?.status || "unknown",
        entries: distinctEntries(match?.entries || []),
        morphologies: (match?.morphology || []).filter(Boolean).map(cloneMorphology),
        morphologyCandidates: (match?.morphologyCandidates || []).filter(candidate => candidate?.morphology).map(candidate => ({
          entry: candidate.entry || null,
          morphology: cloneMorphology(candidate.morphology)
        })),
        canonicalForm: match?.canonicalForm || null,
        matchIndex,
        partIndex,
        sourceStart: sourceToken?.start ?? null,
        sourceEnd: sourceToken?.end ?? null,
        punctuationBefore: sourceToken ? punctuation.filter(mark => mark.end <= sourceToken.start && (!words.length || mark.start >= (words.at(-1)?.sourceEnd ?? -1))).map(mark => mark.raw) : [],
        punctuationAfter: []
      });
    });
  });

  for (let index = 0; index < words.length; index += 1) {
    const start = words[index].sourceEnd;
    const end = words[index + 1]?.sourceStart ?? Number.POSITIVE_INFINITY;
    if (start != null) words[index].punctuationAfter = punctuation.filter(mark => mark.start >= start && mark.end <= end).map(mark => mark.raw);
  }
  return words;
}

function tokenizeSource(source, options = {}) {
  const tokens = [];
  for (const match of String(source).matchAll(TOKEN_PATTERN)) {
    const raw = match[0];
    const kind = /^[\p{L}\p{M}]/u.test(raw) ? "word" : "punctuation";
    const normalized = kind === "word" ? normalizeLatin(raw) : raw;
    const splitEnclitics = options.splitEnclitics !== false;
    const enclitic = splitEnclitics && normalized.endsWith("que") && normalized.length > 4 && !NON_ENCLITIC_QUE_FORMS.has(normalized) ? "que"
      : normalized.endsWith("ne") && normalized.length > 4 && !["bene", "sine", "paene"].includes(normalized) ? "ne"
        : normalized.endsWith("ve") && normalized.length > 4 ? "ve"
          : null;
    if (kind === "word" && enclitic) {
      const baseRaw = raw.slice(0, -enclitic.length);
      tokens.push({ id: `t${tokens.length}`, index: tokens.length, raw: baseRaw, token: baseRaw, normalized: normalizeLatin(baseRaw), kind, start: match.index, end: match.index + baseRaw.length });
      tokens.push({ id: `t${tokens.length}`, index: tokens.length, raw: raw.slice(-enclitic.length), token: raw.slice(-enclitic.length), normalized: enclitic, kind, start: match.index + baseRaw.length, end: match.index + raw.length, encliticHost: tokens.length - 1 });
    } else {
      tokens.push({ id: `t${tokens.length}`, index: tokens.length, raw, token: raw, normalized, kind, punctuation: kind === "punctuation" ? raw : undefined, start: match.index, end: match.index + raw.length });
    }
  }
  return tokens;
}

/** Stage 2: preserve the lattice, then choose the globally strongest analysis. */
export function resolveMorphology(input = [], options = {}) {
  const words = Array.isArray(input) && input.every(item => item?.kind === "word" && "entries" in item)
    ? input.map(cloneWord)
    : tokenizeTranslationInput(input, options);
  if (!words.length) return [];

  const candidateLists = words.map((word, index) => buildCandidates(word, index, words));
  let beam = [{ choices: [], score: 0 }];
  for (let index = 0; index < words.length; index += 1) {
    const candidates = diverseMorphologyCandidates(candidateLists[index], 24);
    const next = [];
    for (const state of beam) {
      for (const candidate of candidates) {
        next.push({
          choices: [...state.choices, candidate],
          score: state.score + candidate.score + incrementalAgreementScore(words, state.choices, candidate, index)
        });
      }
    }
    next.sort((left, right) => right.score - left.score);
    beam = next.slice(0, Number(options.beamWidth) || 384);
  }

  for (const state of beam) state.score += sentenceAnalysisScore(words, state.choices);
  beam.sort((left, right) => right.score - left.score);
  const best = beam[0] || { choices: [] };
  return words.map((word, index) => {
    const selected = best.choices[index] || candidateLists[index][0];
    return {
      ...word,
      candidates: visibleCandidates(candidateLists[index]).map(candidate => ({ entry: candidate.entry, morphology: candidate.morphology, score: candidate.score })),
      selected,
      entry: selected?.entry || preferredEntry(word.entries, selected?.morphology),
      morphology: selected?.morphology || inferredMorphology(word),
      // Dictionary morphology supplies the canonical lemma even when a book
      // stores its headword as an infinitive (for example "amare" with the
      // principal part "amo").  Keeping that canonical form lets valency and
      // construction rules work while the book entry can still provide the
      // preferred German meaning later.
      lemma: normalizeLatin(selected?.morphology?.dictionaryLemma || selected?.entry?.lemma || selected?.entry?.latein || candidateLemma(selected) || word.normalized),
      analysisScore: selected?.score || 0
    };
  });
}

function diverseMorphologyCandidates(candidates, limit) {
  const selected = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const morphology = candidate.morphology || {};
    const key = [
      morphology.dictionaryLemma || candidate.entry?.lemma || candidate.entry?.latein,
      morphology.part,
      morphology.case,
      morphology.number,
      morphology.gender,
      morphology.person,
      morphology.tense,
      morphology.mood,
      morphology.voice,
      morphology.comparison,
      morphology.nonFiniteType,
      morphology.supineUse
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected.length ? selected : candidates.slice(0, limit);
}

function buildCandidates(word, index, words) {
  const records = [];
  const add = (entry, morphology, origin = "provided") => {
    const normalizedMorphology = normalizeMorphology(morphology, word.normalized);
    const lexicalLemma = normalizeLatin(normalizedMorphology.dictionaryLemma || entry?.lemma || entry?.latein);
    if (partOfMorphology(normalizedMorphology) === "pron"
      && DEMONSTRATIVE_LEMMAS.has(lexicalLemma)
      && hasAdjacentAgreeingHeadNounReading(words, index, normalizedMorphology)) {
      normalizedMorphology.adjectivalPronoun = true;
    }
    const hasNominalController = LATIN_ETHNONYM_LEMMAS.has(lexicalLemma)
      ? hasAdjacentAgreeingNominalReading(words, index, normalizedMorphology)
      : hasNearbyAgreeingNominalReading(words, index, normalizedMorphology);
    if (normalizedMorphology.part === "adj"
      && SUBSTANTIVIZED_ADJECTIVES[lexicalLemma]
      && !hasNominalController) {
      normalizedMorphology.substantivized = true;
    }
    for (const reading of expandAmbiguousCases(normalizedMorphology)) {
      records.push({ entry: entry || null, morphology: reading, origin });
    }
  };

  word.morphologyCandidates.forEach(candidate => add(candidate.entry, candidate.morphology, "linked"));
  for (const morphology of word.morphologies) {
    // Do not combine a dictionary analysis with every same-POS lexeme that
    // happens to share the surface form.  The lemma belongs to the
    // morphology: pairing e.g. libra's genitive with liber's German meaning
    // destroys both parsing and sense selection.  Book entries still match
    // when their display headword is an infinitive because their principal
    // parts are retained in `forms`.
    const compatible = word.entries.filter(entry =>
      partMatches(entry?.pos, morphology?.part)
      && entryMatchesMorphologyLemma(entry, morphology)
    );
    if (compatible.length) compatible.forEach(entry => add(entry, morphology, "cross"));
    else add(null, morphology, "morphology");
  }
  for (const irregular of IRREGULAR_LATIN_FORMS[word.normalized] || []) {
    const entry = word.entries.find(candidate => normalizeLatin(candidate?.lemma || candidate?.latein) === irregular.lemma && candidate?.pos === "v") || {
      lemma: irregular.lemma,
      latein: irregular.lemma,
      deutsch: irregular.german,
      meanings: [irregular.german],
      pos: "v",
      source: "grammar"
    };
    add(entry, { ...irregular, dictionaryLemma: irregular.lemma }, "grammar");
  }
  // Classical editions normally capitalize proper names inside a sentence.
  // Keep that productive interpretation even when a dictionary also contains
  // a homographic numeral or adjective (Quintus, Romanus, ...).
  if (index > 0 && /^\p{Lu}/u.test(word.raw)) {
    const properEntry = {
      lemma: word.normalized,
      latein: word.raw,
      deutsch: word.raw,
      meanings: [word.raw],
      pos: "proper",
      source: "proper-context"
    };
    const nominalReadings = [...word.morphologies, ...word.morphologyCandidates.map(candidate => candidate.morphology)]
      .filter(morphology => ["n", "proper"].includes(partOfMorphology(morphology)) && morphology.case);
    for (const morphology of nominalReadings) {
      add(properEntry, { ...morphology, part: "proper", dictionaryLemma: morphology.dictionaryLemma || word.normalized }, "capitalized-proper");
    }
  }
  if (!records.some(record => !record.morphology?.citation)) {
    for (const entry of word.entries) add(entry, { part: entry.pos, citation: true }, "lexicon");
  }

  const structural = structuralMorphology(word.normalized);
  if (structural && !records.some(record =>
    partMatches(record.morphology?.part, structural.part)
    && (!structural.case || caseIncludes(record.morphology, structural.case))
  )) {
    const structuralEntry = word.entries.find(entry => partMatches(entry?.pos, structural.part)) || null;
    add(structuralEntry, structural, "structure");
  }
  if (!records.length) add(preferredEntry(word.entries), inferredMorphology(word), "inferred");

  const deduplicated = [];
  const seen = new Set();
  for (const record of records) {
    const key = `${entryKey(record.entry)}|${JSON.stringify(record.morphology)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicated.push({ ...record, score: unaryMorphologyScore(word, record, index, words) });
  }
  return deduplicated.sort((left, right) => right.score - left.score);
}

function expandAmbiguousCases(morphology) {
  const cases = String(morphology?.case || "").split("/").filter(Boolean);
  if (cases.length <= 1) return [morphology];
  return cases.map(grammaticalCase => ({
    ...morphology,
    case: grammaticalCase,
    possibleCases: cases
  }));
}

function unaryMorphologyScore(word, candidate, index, words) {
  const morphology = candidate.morphology || {};
  const part = morphology.part;
  const lexicalLemma = normalizeLatin(morphology.dictionaryLemma || candidate.entry?.lemma || candidate.entry?.latein);
  let score = (SOURCE_WEIGHTS[candidate.entry?.source] || 0) / 3;
  if (partMatches(candidate.entry?.pos, part)) score += 3;
  // A richer tag is not inherently more probable.  The previous bonuses for
  // case, gender, mood and tense systematically favoured participles over
  // nouns (e.g. rosa/rodo).  Corpus frequency is a safe lexical tie-breaker;
  // syntax below remains the stronger signal.
  score += Math.max(0, Number(morphology.dictionaryFrequencyRank) || 0) * .75;
  if (morphology.citation && !morphology.case && !morphology.mood) score -= 3;
  if (candidate.origin === "structure") score += 20;
  if (candidate.origin === "grammar") score += 12;

  const lexicalPreposition = LATIN_PREPOSITIONS[word.normalized];
  const governedByPreviousPreposition = Boolean(
    lexicalPreposition?.postpositive
    && LATIN_PREPOSITIONS[words[index - 1]?.normalized]
  );
  const expected = governedByPreviousPreposition ? null : structuralMorphology(word.normalized)?.part;
  if (expected) score += part === expected ? 22 : -18;
  if (governedByPreviousPreposition) {
    if (part === "prep") score -= 26;
    else if (isNominalMorphology(morphology)) {
      const previous = LATIN_PREPOSITIONS[words[index - 1]?.normalized];
      score += previous?.latinCases.some(value => caseIncludes(morphology, value)) ? 18 : 0;
    }
  }
  if (/^(?:[a-z]+(?:are|ere|ire))$/u.test(word.normalized)) {
    const finiteAlternative = wordFiniteAnalyses(word).some(isFiniteMorphology);
    if (morphology.mood === "infinitive" && !finiteAlternative) score += 10;
  }
  if (word.normalized === "esse") score += morphology.mood === "infinitive" ? 16 : -4;
  if (["sum", "es", "est", "sumus", "estis", "sunt", "eram", "eras", "erat", "eramus", "eratis", "erant"].includes(word.normalized)) {
    score += ["sum", "esse"].includes(lexicalLemma) ? 14 : -8;
  }
  if (morphology.mood === "imperative" && !word.punctuationAfter?.includes("!") && index !== 0) score -= 4;
  if (PERSONAL_PRONOUNS[word.normalized] && part === "pron" && !morphology.case) score -= 14;
  if (part === "n" && PRONOMINAL_ADJECTIVE_LEMMAS.has(lexicalLemma)
    && word.morphologies.some(reading => reading.part === "adj" && normalizeLatin(reading.dictionaryLemma) === lexicalLemma)) score -= 12;
  if (morphology.substantivized && LATIN_ETHNONYM_LEMMAS.has(lexicalLemma)) score += 9;
  if (part === "proper" || candidate.entry?.pos === "proper") score += /^[\p{Lu}]/u.test(word.raw) ? 4 : -3;
  if (isNominalMorphology(morphology) && ANIMATE_LEMMAS.has(lexicalLemma) && morphology.gender === "n") score -= 10;
  const expectedSurfaceCase = unambiguousPronounCase(word.normalized);
  if (expectedSurfaceCase && part === "pron") score += caseIncludes(morphology, expectedSurfaceCase) ? 16 : -16;
  if (morphology.enclitic === "que") score += 2;
  if (words[index - 1]?.normalized === "ne" && morphology.mood === "subjunctive") score += 8;
  if (isNominalMorphology(morphology) && caseIncludes(morphology, "nominative")) {
    const nearbyFinite = nearbyFiniteAnalyses(words, index);
    if (nearbyFinite.some(finite => numberAgrees(morphology, finite) && subjectPersonAgrees(word, finite))) score += 9;
    else if (nearbyFinite.length && morphology.number) score -= 3;
  }
  if (isNominalMorphology(morphology) && caseIncludes(morphology, "vocative")) {
    const markedAddress = isMarkedVocativeSurface(words, index);
    score += markedAddress ? 2 : -7;
  }
  if (caseIncludes(morphology, "locative")) {
    const productiveLocative = Boolean(LATIN_LOCATIVES[lexicalLemma])
      || part === "proper"
      || ["proper", "proper-context"].includes(candidate.entry?.source);
    score += productiveLocative ? 6 : -10;
  }
  if (isFiniteMorphology(morphology)) {
    const nextFinite = words.slice(index + 1).find(next =>
      !hasClauseBoundaryBetween(words, index, next.index)
      && wordHasUnambiguousFiniteAnalysis(next)
    );
    if (nextFinite) score -= 10;
  }
  return score;
}

function wordHasUnambiguousFiniteAnalysis(word) {
  const readings = [
    ...(word?.morphologyCandidates || []).map(candidate => candidate.morphology),
    ...(word?.morphologies || [])
  ];
  return readings.some(isFiniteMorphology) && !readings.some(isNominalMorphology);
}

function nearbyFiniteAnalyses(words, index) {
  const start = previousClauseBoundary(words, index);
  const end = nextClauseBoundary(words, index);
  return words.slice(start, end).flatMap(wordFiniteAnalyses);
}

function wordFiniteAnalyses(word) {
  const candidates = [
    ...(word?.morphologyCandidates || []).map(candidate => candidate.morphology),
    ...(word?.morphologies || [])
  ];
  return candidates.filter(isFiniteMorphology);
}

function hasClauseBoundaryBetween(words, left, right) {
  return words.slice(left + 1, right + 1).some((word, offset) => {
    const previous = words[left + offset];
    return Boolean(
      COORDINATORS[word.normalized]
      || SUBORDINATORS[word.normalized]
      || RELATIVE_FORMS.has(word.normalized)
      || previous?.punctuationAfter?.some(mark => [",", ";", ":"].includes(mark))
    );
  });
}

function incrementalAgreementScore(words, choices, candidate, index) {
  let score = 0;
  const morphology = candidate.morphology;
  const previousWord = words[index - 1];
  const previous = choices[index - 1];
  const governingPrepositionIndex = nearestPrefixPreposition(words, choices, index);
  const preposition = governingPrepositionIndex == null ? null : LATIN_PREPOSITIONS[words[governingPrepositionIndex]?.normalized];
  if (preposition && isNominalMorphology(morphology)) {
    score += preposition.latinCases.some(value => caseIncludes(morphology, value)) ? 22 : morphology.case ? -16 : -2;
  }
  if (previous && isModifierMorphology(previous.morphology) && isNominalMorphology(morphology)) {
    const agreement = agreementScore(previous.morphology, morphology);
    if (agreement > 0) score += agreement * 2;
  }
  if (previous && isNominalMorphology(previous.morphology) && isModifierMorphology(morphology)) {
    const agreement = agreementScore(previous.morphology, morphology);
    if (agreement > 0) score += agreement * 2;
  }
  if (["tam", "quam", "ita", "sic"].includes(previousWord?.normalized) && isModifierMorphology(morphology)) score += 14;
  if (wordIsComparisonMarker(words[index]) && choices.some(choice => choice.morphology?.comparison === "comparative")) {
    score += ["adv", "conj"].includes(partOfMorphology(morphology)) ? 20 : -20;
  }
  if (isFiniteMorphology(morphology)) {
    const boundary = previousClauseBoundary(words, index, choices);
    const localChoices = choices.slice(boundary).map((choice, offset) => ({ choice, index: boundary + offset }));
    const nominatives = localChoices.filter(item =>
      isNominalMorphology(item.choice.morphology)
      && caseIncludes(item.choice.morphology, "nominative")
    );
    if (nominatives.some(item => numberAgrees(item.choice.morphology, morphology) && subjectPersonAgrees(words[item.index], morphology))) score += 14;
    else if (!morphology.impersonal) score -= 4;

    const earlierFinite = localChoices.filter(item => isFiniteMorphology(item.choice.morphology));
    const interveningLink = words.slice(boundary, index).some(word =>
      COORDINATORS[word.normalized]
      || SUBORDINATORS[word.normalized]
      || RELATIVE_FORMS.has(word.normalized)
      || word.punctuationAfter?.includes(",")
    );
    if (earlierFinite.length && !interveningLink) score -= 18;
  }
  return score;
}

function sentenceAnalysisScore(words, choices) {
  let score = 0;
  const finiteIndexes = choices.map((choice, index) => isFiniteMorphology(choice.morphology) ? index : -1).filter(index => index >= 0);
  const punctuationLinks = words.filter((word, index) =>
    word.punctuationAfter?.includes(",")
    && finiteIndexes.some(finite => finite <= index)
    && finiteIndexes.some(finite => finite > index)
  ).length;
  const markerLinks = words.filter((word, index) =>
    partOfMorphology(choices[index]?.morphology) === "conj"
    && (COORDINATORS[word.normalized] || SUBORDINATORS[word.normalized])
  ).length;
  // A comma commonly closes the same subordinate clause introduced by a
  // marker. Counting both would license a spurious extra finite predicate.
  const interrogativeLinks = words.filter((word, index) => {
    if (!INTERROGATIVE_FORMS.has(word.normalized) || partOfMorphology(choices[index]?.morphology) !== "pron") return false;
    const governing = finiteIndexes.filter(finiteIndex => finiteIndex < index).at(-1);
    const dependent = finiteIndexes.find(finiteIndex => finiteIndex > index);
    if (governing == null || dependent == null) return false;
    const lemma = normalizeLatin(choices[governing].morphology?.dictionaryLemma || choices[governing].entry?.lemma || choices[governing].entry?.latein);
    return VERB_CLASSES.knowing.has(lemma) || VERB_FRAMES[lemma]?.allowsIndirectQuestion;
  }).length;
  const links = Math.max(markerLinks + interrogativeLinks, punctuationLinks);
  score += interrogativeLinks * 18;
  if (finiteIndexes.length) score += 4;
  else if (words.some(word => wordFiniteAnalyses(word).length)) score -= 18;
  if (finiteIndexes.length > links + 1) score -= (finiteIndexes.length - links - 1) * 18;

  for (let markerIndex = 0; markerIndex < words.length; markerIndex += 1) {
    if (!SUBORDINATORS[words[markerIndex].normalized] || partOfMorphology(choices[markerIndex]?.morphology) !== "conj") continue;
    let end = words.findIndex((word, index) => index > markerIndex && word.punctuationAfter?.some(mark => [",", ";"].includes(mark)));
    if (end < 0) end = words.length - 1;
    const span = range(markerIndex + 1, end);
    const selectedFinite = span.some(index => isFiniteMorphology(choices[index]?.morphology));
    const availableFinite = span.some(index => wordFiniteAnalyses(words[index]).length || (IRREGULAR_LATIN_FORMS[words[index].normalized] || []).length);
    if (availableFinite) score += selectedFinite ? 24 : -32;
  }

  // A self-contained phrase without a finite verb is often an ablative
  // absolute.  Forms in -ibus are equally dative and ablative in isolation;
  // the agreeing noun + participle pair supplies the sentence-level evidence.
  if (!finiteIndexes.length) {
    for (let index = 0; index < choices.length; index += 1) {
      const participle = choices[index]?.morphology || {};
      if (partOfMorphology(participle) !== "ppa") continue;
      const agreeingNominal = choices.some((choice, candidateIndex) =>
        candidateIndex !== index
        && isNominalMorphology(choice.morphology)
        && agreementScore(participle, choice.morphology) >= 2
        && caseIncludes(choice.morphology, "ablative")
      );
      if (caseIncludes(participle, "ablative") && agreeingNominal) score += 24;
      else if (caseIncludes(participle, "dative")) score -= 5;
    }
  }
  for (let position = 1; position < finiteIndexes.length; position += 1) {
    const leftIndex = finiteIndexes[position - 1];
    const rightIndex = finiteIndexes[position];
    const between = words.slice(leftIndex + 1, rightIndex);
    const explicitlySubordinate = between.some(word => SUBORDINATORS[word.normalized] || RELATIVE_FORMS.has(word.normalized));
    const coordinated = !explicitlySubordinate && (
      between.some(word => COORDINATORS[word.normalized])
      || words.slice(leftIndex, rightIndex).some(word => word.punctuationAfter?.includes(","))
    );
    if (coordinated) {
      const left = choices[leftIndex].morphology;
      const right = choices[rightIndex].morphology;
      if (left.tense && right.tense) score += left.tense === right.tense ? 7 : -3;
      if (left.mood && right.mood) score += left.mood === right.mood ? 3 : -2;
      if (left.person && right.person && left.number && right.number) {
        score += left.person === right.person && left.number === right.number ? 4 : -2;
      }
    }
  }

  const asyndeticSegments = commaSeparatedSegments(words);
  if (asyndeticSegments.length > 1
    && asyndeticSegments.every(segment => segment.some(index => wordFiniteAnalyses(words[index]).length))) {
    for (const segment of asyndeticSegments) {
      score += segment.some(index => isFiniteMorphology(choices[index]?.morphology)) ? 10 : -12;
    }
  }

  for (const finiteIndex of finiteIndexes) {
    const finite = choices[finiteIndex].morphology;
    const windowStart = previousClauseBoundary(words, finiteIndex, choices);
    const windowEnd = nextClauseBoundary(words, finiteIndex, choices);
    const nominals = choices.slice(windowStart, windowEnd).map((choice, offset) => ({ choice, index: windowStart + offset })).filter(item => isNominalMorphology(item.choice.morphology));
    const agreeingSubjects = nominals.filter(item =>
      caseIncludes(item.choice.morphology, "nominative")
      && numberAgrees(item.choice.morphology, finite)
      && subjectPersonAgrees(words[item.index], finite)
    );
    if (agreeingSubjects.length) score += 13;
    else {
      const missedAgreeingSubject = words.slice(windowStart, windowEnd).some((word, offset) => {
        const selected = choices[windowStart + offset]?.morphology;
        if (!isNominalMorphology(selected) || caseIncludes(selected, "nominative")) return false;
        const selectedLemma = normalizeLatin(selected.dictionaryLemma
          || choices[windowStart + offset]?.entry?.lemma
          || choices[windowStart + offset]?.entry?.latein);
        return [
          ...(word.morphologies || []),
          ...(word.morphologyCandidates || []).map(candidate => candidate.morphology)
        ].some(reading => (isNominalMorphology(reading)
            || partOfMorphology(reading) === "adj" && LATIN_ETHNONYM_LEMMAS.has(normalizeLatin(reading.dictionaryLemma) || selectedLemma))
          && caseIncludes(reading, "nominative")
          && numberAgrees(reading, finite)
          && subjectPersonAgrees(word, finite));
      });
      if (missedAgreeingSubject) score -= 22;
    }
    if (!isEsseEntry(choices[finiteIndex].entry) && agreeingSubjects.length > 1) {
      const plausibleApposition = agreeingSubjects.some((left, leftPosition) => agreeingSubjects.some((right, rightPosition) =>
        rightPosition > leftPosition
        && Math.abs(left.index - right.index) <= 2
        && Boolean(left.choice.entry?.source?.startsWith?.("proper")) !== Boolean(right.choice.entry?.source?.startsWith?.("proper"))
      ));
      if (!plausibleApposition) score -= (agreeingSubjects.length - 1) * 11;
    }
    const disagreeingSubjects = nominals.filter(item =>
      caseIncludes(item.choice.morphology, "nominative")
      && (!numberAgrees(item.choice.morphology, finite) || !subjectPersonAgrees(words[item.index], finite))
    );
    // Latin normally omits first/second-person subjects.  An ordinary noun or
    // demonstrative cannot be forced into that role merely because it also
    // has a nominative reading; its oblique reading must remain available.
    score -= disagreeingSubjects.length * 15;
    const verbLemma = normalizeLatin(choices[finiteIndex].morphology?.dictionaryLemma || choices[finiteIndex].entry?.lemma || choices[finiteIndex].entry?.latein);
    const frame = VERB_FRAMES[verbLemma];
    const requiredCases = new Set(frame?.cases || []);
    const finiteMorphology = choices[finiteIndex].morphology || {};
    if (finiteMorphology.governsCase) requiredCases.add(finiteMorphology.governsCase);
    if (finiteMorphology.transitivity === "transitive") requiredCases.add("accusative");
    for (const requiredCase of requiredCases) {
      if (nominals.some(item => caseIncludes(item.choice.morphology, requiredCase))) score += 3;
    }
    const gerundiveObligation = choices.some(choice =>
      partOfMorphology(choice.morphology) === "ppa"
      && choice.morphology?.tense === "future"
      && choice.morphology?.voice === "passive"
      && caseIncludes(choice.morphology, "nominative")
    );
    const licensesDative = requiredCases.has("dative") || gerundiveObligation;
    for (const item of nominals) {
      const word = words[item.index];
      if (gerundiveObligation && caseIncludes(item.choice.morphology, "dative")) score += 10;
      if (gerundiveObligation && caseIncludes(item.choice.morphology, "ablative") && hasAvailableCaseReading(word, "dative")) score -= 8;
      if (caseIncludes(item.choice.morphology, "dative") && !licensesDative && hasAvailableCaseReading(word, "ablative")) score -= 8;
      if (caseIncludes(item.choice.morphology, "ablative") && !licensesDative && hasAvailableCaseReading(word, "dative")) score += 6;
    }
    // A finite non-copular predicate with an accusative has a well-formed
    // object analysis even when the dictionary gives no explicit valency.
    // This is intentionally a modest preference because Latin also permits
    // intransitive verbs and adverbial accusatives.
    if (!isEsseEntry(choices[finiteIndex].entry)
      && nominals.some(item => caseIncludes(item.choice.morphology, "accusative"))) score += 4;
  }

  for (let index = 0; index < words.length; index += 1) {
    const morphology = choices[index].morphology;
    const prep = LATIN_PREPOSITIONS[words[index].normalized];
    if (prep) {
      const governed = choices.slice(index + 1, index + 5).find(choice => isNominalMorphology(choice.morphology));
      if (governed) {
        const validGovernment = prep.latinCases.some(value => caseIncludes(governed.morphology, value));
        if (partOfMorphology(morphology) === "prep") score += validGovernment ? 15 : -14;
        else if (validGovernment && !isFiniteMorphology(morphology)) score -= 6;
      }
    }
    if ((COORDINATORS[words[index].normalized] || SUBORDINATORS[words[index].normalized])
      && partOfMorphology(morphology) === "conj"
      && finiteIndexes.some(finite => finite < index)
      && finiteIndexes.some(finite => finite > index)) score += 12;
    if (words[index].normalized === "quam"
      && choices.slice(0, index).some(choice => choice.morphology?.comparison === "comparative")) {
      score += ["adv", "conj"].includes(partOfMorphology(morphology)) ? 24 : -24;
    }
    if (index === 0
      && SUBORDINATORS[words[index].normalized]
      && RELATIVE_FORMS.has(words[index].normalized)
      && finiteIndexes.length >= 2) {
      const firstFinite = finiteIndexes[0];
      const explicitSubject = choices.slice(1, firstFinite).some(choice =>
        isNominalMorphology(choice.morphology) && caseIncludes(choice.morphology, "nominative")
      );
      if (explicitSubject) score += partOfMorphology(morphology) === "conj" ? 24 : -20;
    }
    if (RELATIVE_FORMS.has(words[index].normalized)
      && partOfMorphology(morphology) === "pron"
      && index > 0
      && !(words[index].normalized === "quam" && choices.slice(0, index).some(choice => choice.morphology?.comparison === "comparative"))) {
      const antecedent = choices.slice(0, index).map((choice, choiceIndex) => ({ choice, choiceIndex })).reverse()
        .find(item => isNominalMorphology(item.choice.morphology));
      if (antecedent && agreementScore(antecedent.choice.morphology, morphology) >= 0) score += 18;
      else score -= 14;
      const finiteAfter = finiteIndexes.filter(finiteIndex => finiteIndex > index);
      const resumedMainFinite = finiteAfter[1];
      if (antecedent && resumedMainFinite != null) {
        const mainMorphology = choices[resumedMainFinite].morphology;
        if (caseIncludes(antecedent.choice.morphology, "nominative")
          && numberAgrees(antecedent.choice.morphology, mainMorphology)
          && subjectPersonAgrees(words[antecedent.choiceIndex], mainMorphology)) score += 22;
        if (caseIncludes(antecedent.choice.morphology, "vocative")) score -= 18;
      }
    }
    if (isFiniteMorphology(morphology) && isEsseEntry(choices[index].entry)) {
      const predicateNominal = choices.some((choice, candidateIndex) =>
        candidateIndex !== index
        && Math.abs(candidateIndex - index) <= 5
        && isModifierMorphology(choice.morphology)
        && caseIncludes(choice.morphology, "nominative")
      );
      if (predicateNominal) score += 10;
    }
    const hasCopularInfinitive = choices.some(choice => choice.morphology?.mood === "infinitive")
      && choices.some(choice => isFiniteMorphology(choice.morphology) && isEsseEntry(choice.entry));
    if (hasCopularInfinitive && caseIncludes(morphology, "nominative")) {
      if (partOfMorphology(morphology) === "adj") score += 38;
      if (partOfMorphology(morphology) === "n"
        && words[index].morphologies?.some(reading => reading.part === "adj")) score -= 28;
    }
    if (isModifierMorphology(morphology)) {
      const agreeing = choices.some((choice, candidateIndex) =>
        candidateIndex !== index
        && Math.abs(candidateIndex - index) <= 4
        && !hasClauseBoundaryBetween(words, Math.min(candidateIndex, index), Math.max(candidateIndex, index))
        && isNominalMorphology(choice.morphology)
        && agreementScore(morphology, choice.morphology) >= 2
      );
      score += agreeing ? 8 : -5;
      const competingNominalReading = partOfMorphology(morphology) === "adj"
        && Boolean(GERMAN_ADJECTIVE_LEMMA_SENSES[normalizeLatin(morphology.dictionaryLemma || choices[index]?.entry?.lemma || choices[index]?.entry?.latein)])
        && (words[index].morphologyCandidates || []).some(candidate => isNominalMorphology(candidate.morphology));
      const adjacentExactAgreement = choices.some((choice, candidateIndex) =>
        candidateIndex !== index
        && Math.abs(candidateIndex - index) === 1
        && isNominalMorphology(choice.morphology)
        && agreementScore(morphology, choice.morphology) >= 3
      );
      if (competingNominalReading && adjacentExactAgreement) score += 22;
      if (partOfMorphology(morphology) === "ppa" && morphology.voice === "active") {
        const controllerIndex = choices.findIndex((choice, candidateIndex) =>
          candidateIndex !== index
          && isNominalMorphology(choice.morphology)
          && agreementScore(morphology, choice.morphology) >= 2
        );
        const governedAccusative = choices.some((choice, candidateIndex) =>
          candidateIndex !== index
          && candidateIndex !== controllerIndex
          && isNominalMorphology(choice.morphology)
          && caseIncludes(choice.morphology, "accusative")
        );
        if (controllerIndex >= 0 && governedAccusative) score += 12;
      }
      // If the very same surface form also has a nominal reading, a detached
      // participle is substantially less plausible unless a controller,
      // copula or ablative-absolute partner licenses it.  Substantivised
      // participles without a competing nominal reading remain possible.
      const hasCompetingNominalReading = (words[index].morphologyCandidates || []).some(candidate => isNominalMorphology(candidate.morphology));
      if (partOfMorphology(morphology) === "ppa" && hasCompetingNominalReading && !agreeing) score -= 7;
      const enumeratedBetweenNominals = index > 0 && index < choices.length - 1
        && words[index - 1]?.punctuationAfter?.includes(",")
        && words[index]?.punctuationAfter?.includes(",")
        && isNominalMorphology(choices[index - 1]?.morphology)
        && isNominalMorphology(choices[index + 1]?.morphology)
        && [choices[index - 1]?.morphology, choices[index + 1]?.morphology]
          .every(neighbor => firstCase(neighbor) === firstCase(morphology));
      if (partOfMorphology(morphology) === "ppa" && hasCompetingNominalReading && enumeratedBetweenNominals) score -= 30;
    }
    if (isNominalMorphology(morphology)
      && index > 0 && index < choices.length - 1
      && words[index - 1]?.punctuationAfter?.includes(",")
      && words[index]?.punctuationAfter?.includes(",")
      && isNominalMorphology(choices[index - 1]?.morphology)
      && isNominalMorphology(choices[index + 1]?.morphology)
      && [choices[index - 1]?.morphology, choices[index + 1]?.morphology].every(neighbor => firstCase(neighbor) === firstCase(morphology))) score += 12;
    if (isNominalMorphology(morphology) && index > 0 && !words[index - 1]?.punctuationAfter?.length) {
      const previous = choices[index - 1]?.morphology;
      const agreeingAdjectiveAlternative = isNominalMorphology(previous)
        && [
          ...(words[index].morphologies || []),
          ...(words[index].morphologyCandidates || []).map(candidate => candidate.morphology)
        ].some(reading => partOfMorphology(reading) === "adj"
          && Boolean(GERMAN_ADJECTIVE_LEMMA_SENSES[normalizeLatin(reading.dictionaryLemma)])
          && agreementScore(reading, previous) >= 3);
      if (agreeingAdjectiveAlternative) score -= 24;
    }
    if (morphology.nonFiniteType === "perfect-participle" || partOfMorphology(morphology) === "ppa" && morphology.tense === "perfect") {
      const esse = choices.some((choice, candidateIndex) => Math.abs(candidateIndex - index) <= 4 && isFiniteMorphology(choice.morphology) && isEsseEntry(choice.entry));
      const ablativePartner = choices.some((choice, candidateIndex) => candidateIndex !== index && Math.abs(candidateIndex - index) <= 4 && caseIncludes(choice.morphology, "ablative") && agreementScore(morphology, choice.morphology) >= 2);
      if (esse || ablativePartner) score += 12;
      if (esse) {
        const agreeingNominative = choices.some((choice, candidateIndex) => candidateIndex !== index
          && isNominalMorphology(choice.morphology)
          && caseIncludes(choice.morphology, "nominative")
          && agreementScore(morphology, choice.morphology) >= 2);
        if (caseIncludes(morphology, "nominative") && agreeingNominative) score += 20;
        else if (!caseIncludes(morphology, "nominative")) score -= 16;
      }
    }
    if (partOfMorphology(morphology) === "supine") {
      const motionPredicate = finiteIndexes.some(finiteIndex => VERB_CLASSES.motion.has(normalizeLatin(choices[finiteIndex].morphology?.dictionaryLemma || choices[finiteIndex].entry?.lemma || choices[finiteIndex].entry?.latein)));
      if ((morphology.supineUse === "purpose" || caseIncludes(morphology, "accusative")) && motionPredicate) score += 24;
    }
    if ((morphology.gerundCandidate || morphology.nonFiniteType === "gerund" || partOfMorphology(morphology) === "gerund")) {
      if (caseIncludes(morphology, "genitive") && words.some(word => ["causa", "gratia"].includes(word.normalized))) score += 24;
      const precedingPreposition = [...words.slice(Math.max(0, index - 3), index)].reverse().find(word => LATIN_PREPOSITIONS[word.normalized]);
      if (precedingPreposition) score += 12;
    }
  }

  const infinitives = choices.map((choice, index) => choice.morphology.mood === "infinitive" ? index : -1).filter(index => index >= 0);
  for (const infinitiveIndex of infinitives) {
    const governing = nearestIndex(finiteIndexes, infinitiveIndex);
    const lemma = governing >= 0 ? normalizeLatin(choices[governing].morphology?.dictionaryLemma || choices[governing].entry?.lemma || choices[governing].entry?.latein) : "";
    const accusative = choices.some((choice, index) => index !== infinitiveIndex && caseIncludes(choice.morphology, "accusative"));
    if (VERB_CLASSES.speechThought.has(lemma) && accusative) score += 16;
    if ((VERB_CLASSES.command.has(lemma) || VERB_CLASSES.modal.has(lemma)) && governing >= 0) score += 12;

    // A modal present participle can itself govern a complementary
    // infinitive (for example inside an ablative absolute).  Prefer an
    // available accusative as the infinitive's object, independent of Latin
    // word order.
    const participleGovernor = choices.findIndex((choice, index) => {
      if (index === infinitiveIndex || partOfMorphology(choice.morphology) !== "ppa") return false;
      const participleLemma = normalizeLatin(choice.morphology?.dictionaryLemma || choice.entry?.lemma || choice.entry?.latein);
      return VERB_CLASSES.modal.has(participleLemma);
    });
    if (participleGovernor >= 0 && accusative) score += 14;

    if (VERB_CLASSES.speechThought.has(lemma)) {
      for (let index = 0; index < choices.length; index += 1) {
        if (!PERSONAL_PRONOUNS[words[index]?.normalized] || !["se", "sese"].includes(words[index].normalized)) continue;
        if (caseIncludes(choices[index].morphology, "accusative")) score += 18;
        else if (caseIncludes(choices[index].morphology, "ablative")) score -= 8;
      }
    }
  }

  return score;
}

function wordIsComparisonMarker(word) {
  return word?.normalized === "quam";
}

function nearestPrefixPreposition(words, choices, index) {
  for (let cursor = index - 1; cursor >= Math.max(0, index - 4); cursor -= 1) {
    if (words[cursor]?.punctuationAfter?.some(mark => [",", ";", ":"].includes(mark))) return null;
    const preposition = LATIN_PREPOSITIONS[words[cursor]?.normalized];
    if (preposition && !preposition.postpositive) return cursor;
    const selected = choices[cursor]?.morphology;
    if (isNominalMorphology(selected) || isFiniteMorphology(selected)) return null;
  }
  return null;
}

function commaSeparatedSegments(words) {
  const segments = [];
  let current = [];
  for (let index = 0; index < words.length; index += 1) {
    current.push(index);
    if (words[index].punctuationAfter?.some(mark => [",", ";"].includes(mark))) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  return segments;
}

function coordinateSegments(words, finiteIndexes) {
  const result = [];
  for (const original of commaSeparatedSegments(words)) {
    let indexes = [...original];
    let connector = null;
    if (indexes.length && COORDINATORS[words[indexes[0]]?.normalized]) {
      const markerIndex = indexes.shift();
      connector = { value: COORDINATORS[words[markerIndex].normalized], marker: words[markerIndex].normalized };
    }
    while (indexes.length) {
      const splitAt = indexes.findIndex((index, offset) =>
        offset > 0
        && COORDINATORS[words[index]?.normalized]
        && indexes.slice(0, offset).some(item => finiteIndexes.includes(item))
        && indexes.slice(offset + 1).some(item => finiteIndexes.includes(item))
      );
      if (splitAt < 0) {
        result.push({ tokenIndexes: indexes, conjunction: connector?.value || null, marker: connector?.marker || null });
        break;
      }
      const markerIndex = indexes[splitAt];
      result.push({ tokenIndexes: indexes.slice(0, splitAt), conjunction: connector?.value || null, marker: connector?.marker || null });
      connector = { value: COORDINATORS[words[markerIndex].normalized], marker: words[markerIndex].normalized };
      indexes = indexes.slice(splitAt + 1);
    }
  }
  return result;
}

/** Stage 3: create clauses, dependencies, roles and agreement links. */
export function parseLatinSyntax(input = [], options = {}) {
  const words = input.every?.(word => word?.morphology && "lemma" in word) ? input.map(cloneResolvedWord) : resolveMorphology(input, options);
  const finiteIndexes = words.map((word, index) => isFinite(word) ? index : -1).filter(index => index >= 0);
  const clauses = segmentClauses(words, finiteIndexes, options);
  clauses.forEach(clause => assignClauseRoles(clause, words));
  for (const clause of clauses.filter(item => item.type === "relative" && item.antecedentIndex != null)) {
    clause.dependencies.push(dependency("antecedent", clause.markerIndex, clause.antecedentIndex, words));
  }
  const dependencies = clauses.flatMap(clause => clause.dependencies || []);
  const parse = {
    type: options.source?.trim().endsWith("?") ? "question" : "sentence",
    source: options.source || words.map(word => word.raw).join(" "),
    words,
    clauses,
    dependencies,
    rootClauseId: clauses.find(clause => clause.type === "main")?.id || clauses[0]?.id || null
  };
  return { ...parse, tree: buildLatinSyntaxTree(parse) };
}

function segmentClauses(words, finiteIndexes, options) {
  if (!words.length) return [];
  if (RELATIVE_FORMS.has(words[0].normalized)
    && partOf(words[0]) === "pron"
    && (!words[0].morphology?.pronounKind || words[0].morphology.pronounKind === "relative")
    && finiteIndexes.length >= 2) {
    const dependentEnd = clausePunctuationEnd(words, 0, finiteIndexes[0]) ?? finiteIndexes[0];
    return [
      makeClause("main", range(dependentEnd + 1, words.length - 1), null, 0),
      makeClause("free-relative", range(0, dependentEnd), words[0], 1)
    ];
  }
  const relativeIndex = words.findIndex((word, index) => index > 0 && isRelativeMarker(words, index) && finiteIndexes.some(item => item > index));
  if (relativeIndex > 0) {
    const relativeFinite = finiteIndexes.find(index => index > relativeIndex);
    const end = relativeFinite == null ? words.length - 1 : clausePunctuationEnd(words, relativeIndex, relativeFinite) ?? relativeFinite;
    const relative = makeClause("relative", range(relativeIndex, end), words[relativeIndex], 1);
    const mainIndexes = range(0, words.length - 1).filter(index => index < relativeIndex || index > end);
    const main = makeClause("main", mainIndexes, null, 0);
    relative.antecedentIndex = nearestAntecedent(words, relativeIndex);
    const resumedFinite = finiteIndexes.find(index => index > end);
    const antecedentIndex = relative.antecedentIndex;
    if (antecedentIndex != null && resumedFinite != null && !firstCase(words[antecedentIndex].morphology)) {
      const nominative = readingForCase(words[antecedentIndex], "nominative");
      if (nominative && numberAgrees(nominative.morphology, words[resumedFinite].morphology)) words[antecedentIndex] = nominative;
    }
    return [main, relative];
  }

  const interrogativeIndex = words.findIndex(word => INTERROGATIVE_FORMS.has(word.normalized));
  if (interrogativeIndex === 0 && finiteIndexes.length >= 2) {
    const firstFinite = finiteIndexes[0];
    const laterKnowing = finiteIndexes.slice(1).find(index => VERB_CLASSES.knowing.has(words[index].lemma));
    if (laterKnowing != null) {
      return [
        makeClause("main", range(firstFinite + 1, words.length - 1), null, 0),
        makeClause("indirect-question", range(0, firstFinite), words[0], 1)
      ];
    }
  }
  if (interrogativeIndex > 0 && finiteIndexes.some(index => index < interrogativeIndex) && finiteIndexes.some(index => index > interrogativeIndex)) {
    const governing = [...finiteIndexes].filter(index => index < interrogativeIndex).sort((left, right) => right - left).find(index => VERB_CLASSES.knowing.has(words[index].lemma) || VERB_FRAMES[words[index].lemma]?.allowsIndirectQuestion || words[index].lemma === "rogo");
    if (governing != null) {
      return [
        makeClause("main", range(0, interrogativeIndex - 1), null, 0),
        makeClause("indirect-question", range(interrogativeIndex, words.length - 1), words[interrogativeIndex], 1)
      ];
    }
  }

  const subordinatorIndex = words.findIndex((word, index) => SUBORDINATORS[word.normalized] && !(word.normalized === "cum" && isPrepositionalCum(words, index)));
  if (subordinatorIndex >= 0 && finiteIndexes.length >= 2) {
    if (subordinatorIndex === 0) {
      const dependentEnd = clausePunctuationEnd(words, 0, finiteIndexes[0]) ?? finiteIndexes[0];
      return [
        makeClause("main", range(dependentEnd + 1, words.length - 1), null, 0),
        makeClause(subordinateType(words[subordinatorIndex].normalized), range(0, dependentEnd), words[subordinatorIndex], 1)
      ];
    }
    const dependentFinite = finiteIndexes.find(index => index > subordinatorIndex) ?? words.length - 1;
    const dependentEnd = clausePunctuationEnd(words, subordinatorIndex, dependentFinite) ?? dependentFinite;
    const mainIndexes = range(0, words.length - 1).filter(index => index < subordinatorIndex || index > dependentEnd);
    return [
      makeClause("main", mainIndexes, null, 0),
      makeClause(subordinateType(words[subordinatorIndex].normalized), range(subordinatorIndex, dependentEnd), words[subordinatorIndex], 1)
    ];
  }

  const coordinated = coordinateSegments(words, finiteIndexes);
  if (coordinated.length > 1 && coordinated.every(segment => segment.tokenIndexes.some(index => finiteIndexes.includes(index)))) {
    return coordinated.map((segment, order) => ({
      ...makeClause(order === 0 ? "main" : "coordinate", segment.tokenIndexes, null, order),
      conjunction: segment.conjunction || (order === coordinated.length - 1 ? "und" : null),
      marker: segment.marker || null
    }));
  }

  const coordinatorIndex = words.findIndex((word, index) => COORDINATORS[word.normalized] && finiteIndexes.some(item => item < index) && finiteIndexes.some(item => item > index));
  if (coordinatorIndex >= 0) {
    return [
      makeClause("main", range(0, coordinatorIndex - 1), null, 0),
      { ...makeClause("coordinate", range(coordinatorIndex + 1, words.length - 1), words[coordinatorIndex], 1), conjunction: COORDINATORS[words[coordinatorIndex].normalized] }
    ];
  }

  return [makeClause(options.source?.trim().endsWith("?") ? "question" : "main", range(0, words.length - 1), null, 0)];
}

function clausePunctuationEnd(words, startIndex, finiteIndex) {
  for (let index = Math.max(startIndex, finiteIndex); index < words.length - 1; index += 1) {
    if (words[index].punctuationAfter?.some(mark => [",", ";"].includes(mark))) return index;
  }
  return null;
}

function makeClause(type, tokenIndexes, marker, order) {
  return {
    id: `c${order}`,
    type,
    markerIndex: marker?.index ?? null,
    marker: marker?.normalized || null,
    tokenIndexes,
    headIndex: null,
    roles: {
      subject: [], directObject: [], indirectObject: [], genitive: [], ablative: [],
      prepositional: [], predicates: [], adverbial: [], vocative: []
    },
    dependencies: [],
    constructions: []
  };
}

function assignClauseRoles(clause, words) {
  const indexes = clause.tokenIndexes;
  for (const index of indexes) {
    const word = words[index];
    if (!isProper(word) || firstCase(word.morphology)) continue;
    const neighborIndex = [index - 1, index + 1].find(candidateIndex =>
      indexes.includes(candidateIndex)
      && isNominal(words[candidateIndex])
      && !isProper(words[candidateIndex])
      && Boolean(firstCase(words[candidateIndex].morphology))
      && !words[Math.min(index, candidateIndex)]?.punctuationAfter?.length
    );
    if (neighborIndex == null) continue;
    const neighbor = words[neighborIndex];
    words[index] = {
      ...word,
      morphology: {
        ...word.morphology,
        case: firstCase(neighbor.morphology),
        number: word.morphology?.number || neighbor.morphology?.number
      }
    };
  }
  const clauseWords = indexes.map(index => words[index]);
  const finite = clauseWords.filter(isFinite);
  const copula = finite.find(isEsse);
  const pureCopula = copula && !clauseWords.some(word => partOf(word) === "ppa" && word.morphology?.tense === "perfect" && word.morphology?.voice === "passive");
  const head = finite.find(word => !isEsse(word)) || copula || clauseWords.find(word => word.morphology?.mood === "infinitive") || null;
  clause.headIndex = head?.index ?? null;
  const interrogativeIndex = indexes.find(index => INTERROGATIVE_FORMS.has(words[index].normalized));
  if (interrogativeIndex != null && caseIncludes(words[interrogativeIndex].morphology, "nominative")) {
    const explicitSubject = indexes.find(index =>
      index !== interrogativeIndex
      && isNominal(words[index])
      && caseIncludes(words[index].morphology, "nominative")
      && numberAgrees(words[index].morphology, head?.morphology || {})
    );
    const accusative = explicitSubject != null ? readingForCase(words[interrogativeIndex], "accusative") : null;
    if (accusative) words[interrogativeIndex] = accusative;
    else if (explicitSubject != null) {
      const objectReading = readingForCase(words[explicitSubject], "accusative");
      if (objectReading) words[explicitSubject] = objectReading;
    }
  }
  const contextualVocatives = new Set(indexes.filter(index =>
    isNominal(words[index]) && isMarkedVocativeSurface(words, index, head)
  ));
  for (const index of contextualVocatives) {
    clause.roles.vocative.push(index);
    clause.dependencies.push(dependency("vocative", head?.index ?? clause.headIndex, index, words));
  }

  const governed = new Set();
  for (const index of indexes) {
    const preposition = LATIN_PREPOSITIONS[words[index].normalized];
    if (!preposition || words[index].normalized === "cum" && !isPrepositionalCum(words, index)) continue;
    const directionalIndexes = preposition.postpositive
      ? indexes.filter(item => item < index && item >= index - 4).sort((left, right) => right - left)
      : indexes.filter(item => item > index && item <= index + 4);
    const object = directionalIndexes.map(item => words[item]).find(word =>
      isNominal(word) && preposition.latinCases.some(value => caseIncludes(word.morphology, value))
    );
    if (!object) continue;
    governed.add(object.index);
    clause.roles.prepositional.push({ prepositionIndex: index, objectIndex: object.index, latinCase: firstCase(object.morphology), german: preposition.german, germanCase: preposition.germanCaseByLatin?.[firstCase(object.morphology)] || preposition.germanCase });
    clause.dependencies.push(dependency("prepositional-object", index, object.index, words));
  }

  const modifiers = new Set();
  for (const index of indexes) {
    const word = words[index];
    if (!isModifier(word) || isFinite(word) || contextualVocatives.has(index)) continue;
    if (pureCopula && partOf(word) === "adj" && caseIncludes(word.morphology, "nominative") && numberAgrees(word.morphology, copula.morphology)) continue;
    const target = partOf(word) === "num" && !word.morphology?.case
      ? indexes.find(candidateIndex => candidateIndex > index && candidateIndex <= index + 2 && isNominal(words[candidateIndex])) ?? null
      : nearestAgreeingNominal(words, indexes, index);
    if (target == null) continue;
    modifiers.add(index);
    clause.dependencies.push(dependency(partOf(word) === "ppa" ? "participle" : "attribute", target, index, words));
  }

  const nominalIndexes = indexes.filter(index => isNominal(words[index]) && !governed.has(index) && !modifiers.has(index) && !contextualVocatives.has(index));
  const subjectCandidates = nominalIndexes.filter(index => caseIncludes(words[index].morphology, "nominative") && !RELATIVE_FORMS.has(words[index].normalized));
  const agreement = head ? { number: head.morphology.number, person: head.morphology.person } : {};
  const agreeingSubjects = subjectCandidates.filter(index => numberAgrees(words[index].morphology, agreement) && subjectPersonAgrees(words[index], head?.morphology || agreement));
  const explicitPerson = Number(head?.morphology?.person) || 3;
  const subjectPool = agreeingSubjects.length
    ? agreeingSubjects
    : explicitPerson === 3 ? subjectCandidates : [];
  let subject = chooseSubject(subjectPool, head?.index, words);
  if (["relative", "free-relative"].includes(clause.type)) subject = indexes.find(index => RELATIVE_FORMS.has(words[index].normalized) && caseIncludes(words[index].morphology, "nominative")) ?? subject;
  if (subject != null) {
    clause.roles.subject.push(subject);
    clause.dependencies.push(dependency("subject", head?.index ?? clause.headIndex, subject, words));
    const apposition = subjectCandidates.find(index => {
      if (index === subject || Math.abs(index - subject) > 2 || isProper(words[index]) === isProper(words[subject])) return false;
      if (head?.index == null) return true;
      return (index < head.index) === (subject < head.index);
    });
    if (apposition != null) {
      clause.roles.subject.push(apposition);
      clause.dependencies.push(dependency("apposition", subject, apposition, words));
    }
  }

  for (const coordinatorIndex of indexes.filter(index => COORDINATORS[words[index].normalized])) {
    const left = [...subjectCandidates].filter(index => index < coordinatorIndex).sort((a, b) => b - a)[0];
    const right = [...subjectCandidates].filter(index => index > coordinatorIndex).sort((a, b) => a - b)[0];
    if (left == null || right == null) continue;
    const alreadySubject = clause.roles.subject.includes(left) || clause.roles.subject.includes(right);
    if (!alreadySubject && !(isProper(words[left]) && isProper(words[right]))) continue;
    for (const coordinated of [left, right]) {
      if (!clause.roles.subject.includes(coordinated)) clause.roles.subject.push(coordinated);
    }
    clause.dependencies.push(dependency("coordination", left, right, words));
  }

  for (const index of nominalIndexes) {
    if (clause.roles.subject.includes(index)) continue;
    const word = words[index];
    if (caseIncludes(word.morphology, "accusative")) clause.roles.directObject.push(index);
    else if (caseIncludes(word.morphology, "dative")) clause.roles.indirectObject.push(index);
    else if (caseIncludes(word.morphology, "genitive")) clause.roles.genitive.push(index);
    else if (caseIncludes(word.morphology, "ablative")) clause.roles.ablative.push(index);
    else if (caseIncludes(word.morphology, "vocative") && !clause.roles.vocative.includes(index)) clause.roles.vocative.push(index);
  }

  for (const index of clause.roles.directObject) clause.dependencies.push(dependency("direct-object", head?.index ?? clause.headIndex, index, words));
  for (const index of clause.roles.indirectObject) clause.dependencies.push(dependency("indirect-object", head?.index ?? clause.headIndex, index, words));
  for (const index of clause.roles.genitive) {
    const target = nearestNominalIndex(words, indexes, index, new Set([index]));
    clause.dependencies.push(dependency("genitive-attribute", target, index, words));
  }
  clause.roles.predicates = clauseWords.filter(word => isFinite(word) || word.morphology?.mood === "infinitive").map(word => word.index);
  clause.roles.adverbial = clauseWords.filter(word => isAdverb(word) && !["non", "haud"].includes(word.normalized)).map(word => word.index);
}

/** Stage 4: identify constructions and assign a single contextual reading. */
export function interpretLatinGrammar(parse, options = {}) {
  const result = {
    ...parse,
    words: parse.words.map(cloneResolvedWord),
    clauses: parse.clauses.map(clause => ({ ...clause, roles: cloneRoles(clause.roles), dependencies: [...clause.dependencies], constructions: [...clause.constructions] })),
    constructions: [],
    diagnostics: []
  };
  const words = result.words;
  const finiteWords = words.filter(isFinite);
  const infinitives = words.filter(word => word.morphology?.mood === "infinitive");
  const allIndexes = range(0, words.length - 1);

  for (const idiom of LATIN_IDIOMS) {
    const indexes = idiom.lemmas.map(lemma => words.find(word => word.lemma === lemma)?.index ?? -1);
    if (!indexes.every(index => index >= 0)) continue;
    const consumedIndexes = indexes.filter(index => idiom.consumes?.includes(words[index]?.lemma));
    // Inflected or modified idiom nouns carry information that must survive
    // generation (multa bella gerere -> viele Kriege führen).  In that case
    // use the same verb's ordinary valency frame instead of collapsing the
    // whole phrase into a fixed expression.
    const expandedArgument = consumedIndexes.some(index =>
      words[index]?.morphology?.number === "plural"
      || result.dependencies.some(dependency => dependency.headIndex === index && dependency.type === "attribute")
    );
    if (!expandedArgument) result.constructions.push({ type: "idiom", id: idiom.id, indexes, headIndex: words.find(word => word.lemma === idiom.head)?.index, german: idiom.german, consumes: idiom.consumes });
  }

  const expressionIndexes = new Set();
  for (const expression of [...LATIN_EXPRESSIONS].sort((left, right) => right.tokens.length - left.tokens.length)) {
    for (let start = 0; start <= words.length - expression.tokens.length; start += 1) {
      const indexes = expression.tokens.map((token, offset) => words[start + offset]?.normalized === token ? start + offset : -1);
      if (indexes.some(index => index < 0 || expressionIndexes.has(index))) continue;
      indexes.forEach(index => expressionIndexes.add(index));
      result.constructions.push({ type: "expression", id: expression.id, kind: expression.kind, indexes, german: expression.german });
    }
  }

  const participles = words.filter(word => partOf(word) === "ppa" || word.morphology?.nonFiniteType?.includes("participle"));
  const consumedParticiples = new Set();
  for (const participle of participles) {
    const esse = finiteWords.find(word => isEsse(word) && Math.abs(word.index - participle.index) <= 5 && numberAgrees(word.morphology, participle.morphology));
    if (esse && participle.morphology.tense === "future" && participle.morphology.voice === "passive" && caseIncludes(participle.morphology, "nominative")) {
      const subjectIndex = nearestAgreeingNominal(words, range(0, words.length - 1), participle.index, { nominativeOnly: true });
      if (subjectIndex != null) {
        const construction = { type: "gerundive-obligation", participleIndex: participle.index, auxiliaryIndex: esse.index, subjectIndex };
        result.constructions.push(construction);
        consumedParticiples.add(participle.index);
      } else if (participle.morphology.number === "singular" && ["n", "x", undefined].includes(participle.morphology.gender)) {
        result.constructions.push({ type: "gerundive-obligation", participleIndex: participle.index, auxiliaryIndex: esse.index, subjectIndex: null, impersonal: true });
        consumedParticiples.add(participle.index);
      }
    } else if (esse && participle.morphology.tense === "perfect") {
      const construction = { type: "perfect-passive", participleIndex: participle.index, auxiliaryIndex: esse.index };
      result.constructions.push(construction);
      consumedParticiples.add(participle.index);
    }
  }

  /*
   * A gerund and a neuter singular gerundive can have the same surface form.
   * Decide between them through agreement: an agreeing noun licenses an
   * attributive gerundive; without one, the oblique neuter form is a gerund.
   * This decision precedes ablative-absolute detection so an ablative
   * gerundive is not mistaken for a present/perfect participle.
   */
  const gerundiveForms = words.filter(word => isGerundiveForm(word));
  for (const form of gerundiveForms.filter(word => !consumedParticiples.has(word.index))) {
    const nounIndex = nearestAgreeingNominal(words, allIndexes, form.index);
    const gerundReading = nounIndex == null && (
      isGerundForm(form)
      || form.morphology?.tense === "future" && form.morphology?.voice === "passive" && ["genitive", "dative", "ablative", "accusative"].some(value => caseIncludes(form.morphology, value))
    );
    if (gerundReading) {
      const clause = result.clauses.find(item => item.tokenIndexes.includes(form.index)) || result.clauses[0];
      const purposeMarkerIndex = nearestGerundPurposeMarker(words, clause?.tokenIndexes || allIndexes, form);
      const prepositionIndex = nearestGerundPreposition(words, clause?.tokenIndexes || allIndexes, form);
      const governing = nearestGoverningFinite(words, form.index);
      const modifierIndexes = (clause?.tokenIndexes || allIndexes).filter(index =>
        isAdverb(words[index]) && Math.abs(index - form.index) <= 2
      );
      const governingNominalIndex = caseIncludes(form.morphology, "genitive")
        ? (clause?.tokenIndexes || allIndexes).filter(index => index !== form.index && isNominal(words[index]))
          .sort((left, right) => Math.abs(left - form.index) - Math.abs(right - form.index))[0] ?? null
        : null;
      const construction = {
        type: purposeMarkerIndex != null || words[prepositionIndex]?.normalized === "ad" ? "gerund-purpose" : "gerund",
        gerundIndex: form.index,
        governingIndex: governing?.index ?? null,
        markerIndex: purposeMarkerIndex ?? prepositionIndex,
        prepositionIndex,
        grammaticalCase: firstCase(form.morphology),
        modifierIndexes,
        governingNominalIndex
      };
      result.constructions.push(construction);
      consumedParticiples.add(form.index);
      continue;
    }
    if (nounIndex != null) {
      const clause = result.clauses.find(item => item.tokenIndexes.includes(form.index)) || result.clauses[0];
      const prepositionIndex = nearestGerundPreposition(words, clause?.tokenIndexes || allIndexes, form);
      const purpose = words[prepositionIndex]?.normalized === "ad" && caseIncludes(form.morphology, "accusative");
      const governing = nearestGoverningFinite(words, form.index);
      result.constructions.push({
        type: purpose ? "gerundive-purpose" : "gerundive-attributive",
        participleIndex: form.index,
        nounIndex,
        objectIndexes: purpose ? [nounIndex] : [],
        prepositionIndex: purpose ? prepositionIndex : null,
        markerIndex: purpose ? prepositionIndex : null,
        governingIndex: purpose ? governing?.index ?? clause?.headIndex ?? null : null,
        grammaticalCase: firstCase(form.morphology)
      });
      consumedParticiples.add(form.index);
    }
  }

  // Some morphology providers expose a gerund as its own part of speech
  // instead of a future-passive neuter participle. Normalize that representation
  // into the same construction model.
  for (const gerund of words.filter(word => partOf(word) === "gerund" && !result.constructions.some(item => item.gerundIndex === word.index))) {
    const clause = result.clauses.find(item => item.tokenIndexes.includes(gerund.index)) || result.clauses[0];
    const purposeMarkerIndex = nearestGerundPurposeMarker(words, clause?.tokenIndexes || allIndexes, gerund);
    const prepositionIndex = nearestGerundPreposition(words, clause?.tokenIndexes || allIndexes, gerund);
    const governing = nearestGoverningFinite(words, gerund.index);
    const modifierIndexes = (clause?.tokenIndexes || allIndexes).filter(index =>
      isAdverb(words[index]) && Math.abs(index - gerund.index) <= 2
    );
    const governingNominalIndex = caseIncludes(gerund.morphology, "genitive")
      ? (clause?.tokenIndexes || allIndexes).filter(index => index !== gerund.index && isNominal(words[index]))
        .sort((left, right) => Math.abs(left - gerund.index) - Math.abs(right - gerund.index))[0] ?? null
      : null;
    result.constructions.push({
      type: purposeMarkerIndex != null || words[prepositionIndex]?.normalized === "ad" ? "gerund-purpose" : "gerund",
      gerundIndex: gerund.index,
      governingIndex: governing?.index ?? null,
      markerIndex: purposeMarkerIndex ?? prepositionIndex,
      prepositionIndex,
      grammaticalCase: firstCase(gerund.morphology),
      modifierIndexes,
      governingNominalIndex
    });
  }

  for (const adjective of words.filter(word => word.morphology?.comparison === "comparative")) {
    const clause = result.clauses.find(item => item.tokenIndexes.includes(adjective.index));
    if (!clause) continue;
    const markerIndex = clause.tokenIndexes.find(index => index > adjective.index && words[index].normalized === "quam");
    const standardIndex = markerIndex != null
      ? clause.tokenIndexes.find(index => index > markerIndex && isNominal(words[index]))
      : clause.tokenIndexes.find(index => index !== adjective.index && caseIncludes(words[index].morphology, "ablative") && isNominal(words[index]));
    result.constructions.push({
      type: "comparison",
      adjectiveIndex: adjective.index,
      markerIndex: markerIndex ?? null,
      standardIndex: standardIndex ?? null,
      clauseId: clause.id
    });
  }

  for (const adjective of words.filter(word => word.morphology?.comparison === "superlative")) {
    const clause = result.clauses.find(item => item.tokenIndexes.includes(adjective.index));
    if (!clause) continue;
    const genitiveIndexes = clause.tokenIndexes.filter(index =>
      index !== adjective.index
      && (caseIncludes(words[index].morphology, "genitive")
        || result.dependencies.some(dependency => dependency.type === "attribute"
          && caseIncludes(words[dependency.headIndex]?.morphology, "genitive")
          && dependency.dependentIndex === index))
    );
    if (genitiveIndexes.length) result.constructions.push({
      type: "partitive-genitive",
      governorIndex: adjective.index,
      memberIndexes: genitiveIndexes,
      clauseId: clause.id
    });
  }

  const prepositionObjects = new Set(result.clauses.flatMap(clause => clause.roles.prepositional.map(item => item.objectIndex)));
  for (const participle of participles.filter(word => !consumedParticiples.has(word.index) && caseIncludes(word.morphology, "ablative"))) {
    const nounIndex = nearestAgreeingNominal(words, range(0, words.length - 1), participle.index, { case: "ablative", exclude: prepositionObjects });
    if (nounIndex == null || prepositionObjects.has(nounIndex)) continue;
    const internalIndexes = participleInternalIndexes(result, nounIndex, participle.index);
    const construction = {
      type: "ablative-absolute",
      participleIndex: participle.index,
      subjectIndex: nounIndex,
      relation: ablativeAbsoluteRelation(words),
      temporalRelation: participle.morphology.tense === "perfect"
        ? "anterior"
        : participle.morphology.tense === "future" && participle.morphology.voice === "active"
          ? "prospective"
          : "simultaneous",
      internalIndexes: [...internalIndexes].sort((left, right) => left - right),
      argumentIndexes: participleArgumentIndexes(words, internalIndexes, nounIndex, participle.index)
    };
    result.constructions.push(construction);
    consumedParticiples.add(participle.index);
  }

  /*
   * Classical Latin may omit the present participle of esse in an ablative
   * absolute (Caesare duce).  Recognize the productive nominal pattern only
   * when an ungoverned proper/animate nominal is paired with a common nominal
   * of the same number.  This keeps ordinary instrumental ablatives out.
   */
  const occupiedAblativeIndexes = new Set(result.constructions
    .filter(construction => construction.type === "ablative-absolute")
    .flatMap(construction => [construction.subjectIndex, construction.participleIndex]));
  for (const clause of result.clauses) {
    const candidates = (clause.tokenIndexes || [])
      .map(index => words[index])
      .filter(word => isNominal(word)
        && caseIncludes(word.morphology, "ablative")
        && !prepositionObjects.has(word.index)
        && !occupiedAblativeIndexes.has(word.index));
    const subjects = candidates.filter(word => isProper(word) || ANIMATE_LEMMAS.has(word.lemma));
    for (const subject of subjects) {
      const predicate = candidates.find(word =>
        word.index !== subject.index
        && !isProper(word)
        && numberAgrees(word.morphology, subject.morphology)
        && Math.abs(word.index - subject.index) <= 3
        && !hasClauseBoundaryBetween(words, Math.min(word.index, subject.index), Math.max(word.index, subject.index))
      );
      if (!predicate) continue;
      const internalIndexes = [subject.index, predicate.index].sort((left, right) => left - right);
      result.constructions.push({
        type: "ablative-absolute",
        nominal: true,
        subjectIndex: subject.index,
        predicateNominalIndex: predicate.index,
        participleIndex: null,
        relation: ablativeAbsoluteRelation(words, new Set(internalIndexes)),
        temporalRelation: "simultaneous",
        internalIndexes,
        argumentIndexes: []
      });
      occupiedAblativeIndexes.add(subject.index);
      occupiedAblativeIndexes.add(predicate.index);
      break;
    }
  }

  for (const participle of participles.filter(word => !consumedParticiples.has(word.index))) {
    if (participle.morphology.tense === "future" && participle.morphology.voice === "passive" && ["genitive", "dative", "ablative"].some(value => caseIncludes(participle.morphology, value))) {
      result.constructions.push({ type: participle.morphology.gerundCandidate ? "gerund" : "gerundive", participleIndex: participle.index });
      consumedParticiples.add(participle.index);
      continue;
    }
    const clause = result.clauses.find(item => item.tokenIndexes.includes(participle.index)) || result.clauses[0];
    const antecedentIndex = nearestAgreeingNominal(words, clause?.tokenIndexes || allIndexes, participle.index);
    if (antecedentIndex == null && ["nominative", "accusative"].some(value => caseIncludes(participle.morphology, value))) {
      const grammaticalCase = clause?.roles.subject.length && clause.headIndex != null && !isEsse(words[clause.headIndex]) ? "accusative" : "nominative";
      const contextual = participleReadingForCase(participle, grammaticalCase);
      if (contextual) words[participle.index] = contextual;
      result.constructions.push({ type: "substantivized-participle", participleIndex: participle.index, grammaticalCase, clauseId: clause?.id });
      consumedParticiples.add(participle.index);
      continue;
    }
    const internalIndexes = antecedentIndex == null
      ? new Set([participle.index])
      : participleInternalIndexes(result, antecedentIndex, participle.index);
    const type = participle.morphology.tense === "present"
      ? "present-participle"
      : participle.morphology.tense === "future" && participle.morphology.voice === "active"
        ? "future-participle"
        : participle.morphology.tense === "perfect" && participle.morphology.voice === "passive" && !participleIsLexicallyActive(participle)
          ? "perfect-passive-participle"
          : "participial-phrase";
    result.constructions.push({
      type,
      participleIndex: participle.index,
      antecedentIndex,
      internalIndexes: [...internalIndexes].sort((left, right) => left - right),
      argumentIndexes: participleArgumentIndexes(words, internalIndexes, antecedentIndex, participle.index)
    });
  }

  /*
   * The accusative supine expresses purpose only with a governing motion verb.
   * The ablative supine expresses specification.  Objects are recorded on the
   * construction because they semantically belong to the supine, even though
   * a shallow case parser initially associates them with the finite verb.
   */
  for (const supine of words.filter(isSupine)) {
    const clause = result.clauses.find(item => item.tokenIndexes.includes(supine.index)) || result.clauses[0];
    const governing = (clause?.tokenIndexes || allIndexes)
      .map(index => words[index])
      .filter(word => isFinite(word) && VERB_CLASSES.motion.has(word.lemma))
      .sort((left, right) => Math.abs(left.index - supine.index) - Math.abs(right.index - supine.index))[0];
    if ((supine.morphology.supineUse === "purpose" || caseIncludes(supine.morphology, "accusative")) && governing) {
      result.constructions.push({
        type: "supine-purpose",
        supineIndex: supine.index,
        governingIndex: governing.index,
        objectIndexes: (clause?.roles.directObject || []).filter(index => index !== supine.index)
      });
    } else if (supine.morphology.supineUse === "specification" || caseIncludes(supine.morphology, "ablative")) {
      result.constructions.push({ type: "supine-specification", supineIndex: supine.index, governingIndex: clause?.headIndex ?? null });
    }
  }

  for (const infinitive of infinitives) {
    const governing = nearestGoverningPredicate(words, infinitive.index);
    if (!governing) continue;
    if (isEsse(governing)) {
      const passiveStatementController = words.find(word =>
        partOf(word) === "ppa"
        && word.morphology?.tense === "perfect"
        && word.morphology?.voice === "passive"
        && Math.abs(word.index - governing.index) <= 4
        && allowsAci(word)
        && !word.morphology?.deponent
        && !word.morphology?.semideponent
        && !VERB_FRAMES[word.lemma]?.deponent
        && !VERB_FRAMES[word.lemma]?.semideponent
      );
      if (passiveStatementController) {
        const subject = words.find(word =>
          word.index !== governing.index
          && word.index !== passiveStatementController.index
          && caseIncludes(word.morphology, "nominative")
        );
        const objects = words
          .filter(word => ![infinitive.index, governing.index, passiveStatementController.index, subject?.index].includes(word.index) && !prepositionObjects.has(word.index))
          .map(word => readingForCase(word, "accusative"))
          .filter(Boolean);
        commitContextualReadings(words, objects);
        result.constructions.push({
          type: "nci",
          governingIndex: governing.index,
          controllerIndex: passiveStatementController.index,
          infinitiveIndex: infinitive.index,
          subjectIndex: subject?.index ?? null,
          subject: subject || null,
          objectIndexes: objects.map(word => word.index)
        });
        continue;
      }
      const activePerfectController = words.find(word =>
        partOf(word) === "ppa"
        && word.morphology?.tense === "perfect"
        && Math.abs(word.index - governing.index) <= 4
        && (word.morphology?.semideponent || word.morphology?.deponent || VERB_FRAMES[word.lemma]?.semideponent)
        && VERB_FRAMES[word.lemma]?.allowsInfinitive
      );
      if (activePerfectController) {
        const clause = result.clauses.find(item => item.tokenIndexes.includes(governing.index)) || result.clauses[0];
        const objectReadings = (clause?.tokenIndexes || allIndexes)
          .filter(index => ![infinitive.index, governing.index, activePerfectController.index, ...(clause?.roles.subject || [])].includes(index))
          .map(index => readingForCase(words[index], "accusative"))
          .filter(Boolean);
        commitContextualReadings(words, objectReadings);
        for (const object of objectReadings) {
          result.dependencies = result.dependencies.filter(dependency => dependency.dependentIndex !== object.index || dependency.type !== "attribute");
          clause.dependencies = clause.dependencies.filter(dependency => dependency.dependentIndex !== object.index || dependency.type !== "attribute");
          if (!clause.roles.directObject.includes(object.index)) clause.roles.directObject.push(object.index);
        }
        result.constructions.push({
          type: "complementary-infinitive",
          governingIndex: governing.index,
          controllerIndex: activePerfectController.index,
          infinitiveIndex: infinitive.index,
          objectIndexes: objectReadings.map(word => word.index),
          withZu: Boolean(VERB_FRAMES[activePerfectController.lemma]?.germanInfinitiveWithZu)
        });
        continue;
      }
      result.constructions.push({ type: "infinitive-subject", governingIndex: governing.index, infinitiveIndex: infinitive.index });
      continue;
    }
    const allAccusatives = words
      .filter(word => word.index !== infinitive.index && word.index !== governing.index && !prepositionObjects.has(word.index))
      .map(word => readingForCase(word, "accusative"))
      .filter(Boolean);
    const followingAccusatives = governing.morphology?.mood === "infinitive"
      ? allAccusatives.filter(word => word.index > governing.index)
      : [];
    const accusatives = followingAccusatives.length ? followingAccusatives : allAccusatives;
    if (VERB_CLASSES.command.has(governing.lemma) && accusatives.length) {
      const commanded = accusatives.find(word => ANIMATE_LEMMAS.has(word.lemma)) || accusatives[0];
      const objects = accusatives.filter(word => word.index !== commanded.index);
      commitContextualReadings(words, [commanded, ...objects]);
      result.constructions.push({ type: "infinitive-command", governingIndex: governing.index, infinitiveIndex: infinitive.index, subjectIndex: commanded.index, subject: commanded, objectIndexes: objects.map(word => word.index) });
      continue;
    }
    if (isFinite(governing) && (governing.morphology.voice === "passive" || hasPerfectPassiveAt(words, governing.index)) && allowsAci(governing)) {
      const subject = words.find(word => caseIncludes(word.morphology, "nominative") && word.index !== governing.index);
      commitContextualReadings(words, accusatives);
      result.constructions.push({
        type: "nci",
        governingIndex: governing.index,
        infinitiveIndex: infinitive.index,
        subjectIndex: subject?.index ?? null,
        subject: subject || null,
        objectIndexes: accusatives.map(word => word.index)
      });
      continue;
    }
    if (allowsAci(governing) && accusatives.length) {
      const inheritedSubject = coordinatedAciSubject(result.constructions, words, governing, infinitive, accusatives);
      const subject = inheritedSubject || chooseAciSubject(accusatives, infinitive, governing);
      const complements = accusatives.filter(word => word.index !== subject.index);
      const predicate = isEsse(infinitive)
        ? complements.find(word => agreementScore(word.morphology, subject.morphology) >= 1) || complements[0] || null
        : null;
      const objects = complements.filter(word => word.index !== predicate?.index);
      commitContextualReadings(words, [subject, ...objects, predicate].filter(Boolean));
      result.constructions.push({
        type: "aci",
        governingIndex: governing.index,
        infinitiveIndex: infinitive.index,
        subjectIndex: subject.index,
        subject,
        embeddedSubject: subject,
        predicateIndex: predicate?.index ?? null,
        objectIndexes: objects.map(word => word.index)
      });
      continue;
    }
    result.constructions.push({
      type: "complementary-infinitive",
      governingIndex: governing.index,
      infinitiveIndex: infinitive.index,
      withZu: Boolean(VERB_FRAMES[governing.lemma]?.germanInfinitiveWithZu)
    });
  }

  normalizeStatementInfinitives(result, words);

  for (const clause of result.clauses) {
    const marker = clause.marker;
    const finite = clause.headIndex != null ? words[clause.headIndex] : null;
    if (marker === "ut") {
      const previous = nearestFiniteBefore(words, clause.markerIndex);
      const precedingTokens = words.slice(0, clause.markerIndex).map(word => word.normalized);
      if (finite?.morphology.mood === "indicative") clause.type = "temporal";
      else if (precedingTokens.some(token => ["tam", "tantus", "talis", "tot", "ita", "sic"].includes(token))) clause.type = "consecutive";
      else if (previous && (VERB_CLASSES.command.has(previous.lemma) || VERB_FRAMES[previous.lemma]?.allowsUt)) clause.type = "complement";
      else if (finite?.morphology.mood === "subjunctive") clause.type = "final";
      else clause.type = "content";
    } else if (marker === "ne") {
      clause.type = clause.id === result.rootClauseId || result.clauses.length === 1 ? "prohibition" : "negative-final";
    } else if (marker === "si" || marker === "nisi") clause.type = "conditional";
    else if (marker === "cum") clause.type = words.some(word => word.normalized === "tamen") ? "concessive" : finite?.morphology.tense === "pluperfect" || finite?.morphology.tense === "perfect" ? "temporal-anterior" : "temporal";
    else if (["quia", "quoniam", "quod"].includes(marker)) clause.type = "causal";
  }

  for (const clause of result.clauses.filter(clause => clause.type === "relative")) {
    result.constructions.push({ type: "relative-clause", clauseId: clause.id, antecedentIndex: clause.antecedentIndex ?? nearestAntecedent(words, clause.markerIndex) });
  }
  for (const clause of result.clauses.filter(clause => clause.type === "free-relative")) result.constructions.push({ type: "free-relative", clauseId: clause.id });
  for (const clause of result.clauses.filter(clause => clause.type === "indirect-question")) result.constructions.push({ type: "indirect-question", clauseId: clause.id });
  for (const clause of result.clauses.filter(clause => ["final", "negative-final", "consecutive", "conditional", "temporal", "temporal-anterior", "causal", "relative"].includes(clause.type))) result.constructions.push({ type: clause.type, clauseId: clause.id });

  if (!finiteWords.length && !result.constructions.some(construction => construction.type === "ablative-absolute")) result.diagnostics.push("syntax-incomplete");
  if (words.some(word => !word.entry && !isStructural(word))) result.diagnostics.push("unresolved-lexeme");
  return result;
}

/** Stage 5: choose a sense only after syntax and constructions are known. */
export function selectContextualMeanings(interpretation, options = {}) {
  const constructions = interpretation.constructions || [];
  const words = interpretation.words.map(word => {
    const compatibleEntries = distinctEntries([
      ...(word.candidates || []).map(candidate => candidate.entry).filter(Boolean),
      ...(word.entries || [])
    ]).filter(entry => partMatches(entry.pos, partOf(word)) && entryMatchesResolvedLemma(entry, word));
    const entries = compatibleEntries.length ? compatibleEntries : distinctEntries(word.entries || []);
    const entry = preferredEntry(entries, word.morphology) || word.entry || null;
    const senses = entries.flatMap(entrySenses);
    const frame = VERB_FRAMES[word.lemma];
    const clause = interpretation.clauses.find(clause => clause.tokenIndexes.includes(word.index));
    const sense = chooseSense(word, senses, frame, clause, interpretation.words, constructions, options);
    return { ...word, entries, entry, senses, sense, meaning: sense };
  });
  return { ...interpretation, words, meaningSelectionComplete: words.every(word => isStructural(word) || Boolean(word.sense)) };
}

function entryMatchesResolvedLemma(entry, word) {
  if (!word.lemma || partOf(word) === "pron") return true;
  if (normalizeLatin(entry?.lemma || entry?.latein) === word.lemma) return true;
  // Book data often uses the infinitive as its display headword while the
  // morphology engine uses the first principal part.  Forms establish that
  // both records describe the same lexeme without weakening POS agreement.
  return [entry?.lemma, entry?.latein, ...(entry?.forms || [])]
    .some(form => normalizeLatin(form) === word.lemma);
}

function chooseSense(word, senses, frame, clause, words, constructions) {
  const idiom = constructions.find(construction => construction.type === "idiom" && construction.headIndex === word.index);
  if (idiom) return idiom.german;
  if (partOf(word) === "pron") return pronounMeaning(word);
  if (isStructural(word)) return structuralMeaning(word);
  if (isProper(word)) return cleanProperName(word.entry?.deutsch || word.entry?.meanings?.[0] || word.raw);
  if (["v", "ppa", "gerund", "supine"].includes(partOf(word))) {
    const governsIndirectQuestion = constructions.some(construction => construction.type === "indirect-question")
      && clause?.type === "main" && ["quaero", "rogo"].includes(word.lemma);
    if (governsIndirectQuestion) return senses.map(cleanVerbSense).find(sense => /fragen/i.test(sense)) || "fragen";
    const prepositions = clause?.roles.prepositional.map(item => words[item.prepositionIndex]?.normalized) || [];
    const objectLemmas = (clause?.roles.directObject || []).map(index => words[index]?.lemma);
    const subjectLemmas = (clause?.roles.subject || []).map(index => words[index]?.lemma);
    const contextual = frame?.senses?.find(rule =>
      (!rule.withPreposition || prepositions.includes(rule.withPreposition))
      && (!rule.withDirectObject || objectLemmas.length > 0)
      && (!rule.withConstruction || constructions.some(construction =>
        construction.type === rule.withConstruction && construction.governingIndex === word.index
      ))
      && (!rule.objectLemmas || rule.objectLemmas.some(lemma => objectLemmas.includes(lemma)))
      && (!rule.subjectLemmas || rule.subjectLemmas.some(lemma => subjectLemmas.includes(lemma)))
    );
    if (contextual?.german) return contextual.german;
    if (frame?.defaultSense && senses.some(sense => normalizeGerman(sense).includes(normalizeGerman(frame.defaultSense)))) return frame.defaultSense;
    if (frame?.defaultSense && !senses.length) return frame.defaultSense;
    const verbal = senses.map(cleanVerbSense).filter(Boolean);
    if (frame?.defaultSense) return frame.defaultSense;
    // When a non-modal Latin verb offers both a lexical translation and a
    // German modal paraphrase, keep the lexical verb.  Modal readings remain
    // valid for actual Latin modal verbs such as posse, debere and velle.
    const nonModal = VERB_CLASSES.modal.has(word.lemma)
      ? verbal
      : verbal.filter(value => !/^(?:dürfen|können|mögen|müssen|sollen|wollen)$/iu.test(value));
    return nonModal.find(value => /(?:en|n)$/.test(value.replace(/^sich\s+/, "")))
      || verbal.find(value => /(?:en|n)$/.test(value.replace(/^sich\s+/, "")))
      || verbal[0]
      || "";
  }
  if (partOf(word) === "adj" && GERMAN_ADJECTIVE_LEMMA_SENSES[word.lemma]) {
    return GERMAN_ADJECTIVE_LEMMA_SENSES[word.lemma];
  }
  const governingLemma = clause?.headIndex != null ? words[clause.headIndex]?.lemma : null;
  const contextualNominal = VERB_FRAMES[governingLemma]?.nominalSenses?.[word.lemma];
  if (contextualNominal) return contextualNominal;
  return senses.map(cleanNominalSense).find(Boolean) || "";
}

export function partOf(word) {
  return word?.morphology?.part || word?.entry?.pos || structuralMorphology(word?.normalized)?.part || "x";
}

export function isFinite(word) {
  return partOf(word) === "v" && FINITE_MOODS.has(word.morphology?.mood) && Number(word.morphology?.person) > 0;
}

export function isNominal(word) {
  return ["n", "pron", "proper"].includes(partOf(word))
    || isProper(word)
    || Boolean(PERSONAL_PRONOUNS[word?.normalized])
    || Boolean(word?.morphology?.substantivized);
}

export function isModifier(word) {
  return (["adj", "num", "ppa"].includes(partOf(word)) && !isNominal(word) || isAdjectivalPronounMorphology(word?.morphology)) && !isFinite(word);
}

export function isProper(word) {
  if (partOf(word) === "adj" && !word?.morphology?.substantivized) return false;
  return partOf(word) === "proper"
    || word?.entry?.pos === "proper"
    || ["proper", "proper-context"].includes(word?.entry?.source)
    || (word?.index > 0 && /^\p{Lu}/u.test(word?.raw || "") && partOf(word) === "n");
}

export function isAdverb(word) {
  const selectedPart = partOf(word);
  return selectedPart === "adv"
    || selectedPart === "x" && word?.entry?.pos === "adv"
    || Boolean(DISCOURSE_ADVERBS[word?.normalized]);
}

export function isEsse(word) {
  return ["sum", "esse"].includes(word?.lemma) || ["sum", "esse"].includes(normalizeLatin(word?.entry?.lemma || word?.entry?.latein));
}

export function caseIncludes(morphology, grammaticalCase) {
  return String(morphology?.case || "").split("/").includes(grammaticalCase);
}

export function firstCase(morphology) {
  return String(morphology?.case || "").split("/").find(value => value && value !== "x") || "";
}

export function normalizeLatin(value = "") {
  return String(value)
    .normalize("NFD")
    .toLocaleLowerCase("la")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("j", "i")
    .replace(/[’']/g, "")
    .replace(/[^a-z]/g, "");
}

function normalizeMorphology(value = {}, token = "") {
  const morphology = cloneMorphology(value);
  if (morphology.part === "participle") morphology.part = "ppa";
  if (morphology.part === "pronoun") morphology.part = "pron";
  if (morphology.part === "pack") {
    morphology.part = "pron";
    morphology.adjectivalPronoun = true;
  }
  if (morphology.number === "x") delete morphology.number;
  if (morphology.gender === "x") delete morphology.gender;
  if (morphology.mood === "x") delete morphology.mood;
  if (morphology.case === "x") delete morphology.case;
  if (morphology.part === "ppa") {
    morphology.nonFiniteType ||= morphology.tense === "present" ? "present-participle"
      : morphology.tense === "perfect" ? "perfect-participle"
        : morphology.tense === "future" && morphology.voice === "active" ? "future-participle"
          : morphology.tense === "future" && morphology.voice === "passive" ? "gerundive"
            : "participle";
  }
  if (morphology.part === "adj" && (token.endsWith("ior") || token.endsWith("ius") || token.endsWith("iores") || token.endsWith("ioris") || token.endsWith("iorem") || token.endsWith("iore") || token.endsWith("ioribus"))) {
    morphology.comparison ||= "comparative";
  }
  if (morphology.part === "adj" && /(?:issim|errim|illim)/u.test(token)) morphology.comparison ||= "superlative";
  if (/nd(?:us|a|um|i|ae|o|am|os|as|orum|arum|is)$/u.test(token)) morphology.gerundiveCandidate = true;
  if (/nd(?:i|o|um)$/u.test(token) && ["genitive", "dative", "ablative", "accusative"].some(value => caseIncludes(morphology, value))) morphology.gerundCandidate = true;
  return morphology;
}

function structuralMorphology(token) {
  if (!token) return null;
  const readings = [];
  if (COORDINATORS[token] || SUBORDINATORS[token]) readings.push({ part: "conj" });
  if (LATIN_PREPOSITIONS[token]) readings.push({ part: "prep" });
  if (PERSONAL_PRONOUNS[token] || RELATIVE_FORMS.has(token) || INTERROGATIVE_FORMS.has(token)) {
    const grammaticalCase = unambiguousPronounCase(token);
    readings.push({ part: "pron", ...(grammaticalCase ? { case: grammaticalCase, number: "singular" } : {}) });
  }
  if (["non", "haud"].includes(token) || DISCOURSE_ADVERBS[token]) readings.push({ part: "adv" });
  if (token === "que") readings.push({ part: "conj", enclitic: true });
  const distinct = [...new Map(readings.map(reading => [reading.part, reading])).values()];
  return distinct.length === 1 ? distinct[0] : null;
}

function inferredMorphology(word) {
  return structuralMorphology(word.normalized) || { part: preferredEntry(word.entries)?.pos || "x" };
}

function partMatches(entryPart, morphologyPart) {
  if (!entryPart || entryPart === "x" || !morphologyPart || morphologyPart === "x") return true;
  if (morphologyPart === "ppa") return entryPart === "v" || entryPart === "ppa" || entryPart === "adj";
  if (["gerund", "supine"].includes(morphologyPart)) return entryPart === "v" || entryPart === morphologyPart;
  if (entryPart === "proper") return morphologyPart === "proper" || morphologyPart === "n";
  return entryPart === morphologyPart;
}

function entryMatchesMorphologyLemma(entry, morphology = {}) {
  const dictionaryLemma = normalizeLatin(morphology.dictionaryLemma);
  if (!dictionaryLemma || ["x", "xx", "xxx", "zzz"].includes(dictionaryLemma)) return true;
  return [entry?.lemma, entry?.latein, ...(entry?.forms || [])]
    .some(value => normalizeLatin(value) === dictionaryLemma);
}

function hasNearbyAgreeingNominalReading(words, index, modifierMorphology) {
  return words.some((candidateWord, candidateIndex) => {
    if (candidateIndex === index || Math.abs(candidateIndex - index) > 4) return false;
    if (hasClauseBoundaryBetween(words, Math.min(index, candidateIndex), Math.max(index, candidateIndex))) return false;
    const readings = [
      ...(candidateWord.morphologies || []),
      ...(candidateWord.morphologyCandidates || []).map(candidate => candidate.morphology)
    ];
    return readings.some(reading => isNominalMorphology(reading) && agreementScore(modifierMorphology, reading) >= 2);
  });
}

function hasAdjacentAgreeingNominalReading(words, index, modifierMorphology) {
  return words.some((candidateWord, candidateIndex) => {
    if (candidateIndex === index || Math.abs(candidateIndex - index) > 1) return false;
    const readings = [
      ...(candidateWord.morphologies || []),
      ...(candidateWord.morphologyCandidates || []).map(candidate => candidate.morphology)
    ];
    return readings.some(reading => isNominalMorphology(reading) && agreementScore(modifierMorphology, reading) >= 2);
  });
}

function hasAdjacentAgreeingHeadNounReading(words, index, modifierMorphology) {
  return words.some((candidateWord, candidateIndex) => {
    if (candidateIndex === index || Math.abs(candidateIndex - index) > 1) return false;
    const readings = [
      ...(candidateWord.morphologies || []),
      ...(candidateWord.morphologyCandidates || []).map(candidate => candidate.morphology)
    ];
    return readings.some(reading => ["n", "proper"].includes(partOfMorphology(reading))
      && agreementScore(modifierMorphology, reading) >= 2);
  });
}

function hasAvailableCaseReading(word, grammaticalCase) {
  return [
    ...(word?.morphologies || []),
    ...(word?.morphologyCandidates || []).map(candidate => candidate.morphology)
  ].some(morphology => caseIncludes(morphology, grammaticalCase));
}

function isMarkedVocativeSurface(words, index, finite = null) {
  const word = words[index];
  const commaBefore = word?.punctuationBefore?.includes(",") || words[index - 1]?.punctuationAfter?.includes(",");
  const commaAfter = word?.punctuationAfter?.includes(",") || word?.punctuationAfter?.includes("!");
  const finiteReadings = finite ? [finite.morphology] : words.slice(1).flatMap(wordFiniteAnalyses);
  const addressesSecondPerson = finiteReadings.some(morphology => morphology?.mood === "imperative" || Number(morphology?.person) === 2);
  const addressable = isProper(word)
    || ANIMATE_LEMMAS.has(normalizeLatin(word?.lemma || word?.entry?.lemma || word?.entry?.latein))
    || caseIncludes(word?.morphology, "vocative");
  if (commaBefore && commaAfter) return addressesSecondPerson && addressable;
  return index === 0 && commaAfter && addressesSecondPerson && addressable;
}

function preferredEntry(entries = [], morphology = {}) {
  const compatible = entries.filter(entry => partMatches(entry?.pos, morphology?.part));
  const pool = compatible.length ? compatible : entries;
  return [...pool].sort((left, right) => (SOURCE_WEIGHTS[right?.source] || 0) - (SOURCE_WEIGHTS[left?.source] || 0))[0] || null;
}

function isNominalMorphology(morphology = {}) {
  return ["n", "pron", "proper"].includes(partOfMorphology(morphology)) || Boolean(morphology.substantivized);
}

function isModifierMorphology(morphology = {}) {
  return ["adj", "num", "ppa"].includes(partOfMorphology(morphology)) && !morphology.substantivized || isAdjectivalPronounMorphology(morphology);
}

function isAdjectivalPronounMorphology(morphology = {}) {
  return partOfMorphology(morphology) === "pron"
    && (morphology.adjectivalPronoun || ["adjectival", "demonstrative"].includes(morphology.pronounKind));
}

function isFiniteMorphology(morphology = {}) {
  return partOfMorphology(morphology) === "v" && FINITE_MOODS.has(morphology.mood) && Number(morphology.person) > 0;
}

function partOfMorphology(morphology = {}) {
  return morphology.part === "participle" ? "ppa" : morphology.part;
}

function agreementScore(left = {}, right = {}) {
  let score = 0;
  if (left.case && right.case) score += firstCase(left) === firstCase(right) || String(left.case).split("/").some(value => caseIncludes(right, value)) ? 1 : -2;
  if (left.number && right.number) score += left.number === right.number ? 1 : -2;
  if (left.gender && right.gender && !["c", "x"].includes(left.gender) && !["c", "x"].includes(right.gender)) score += left.gender === right.gender ? 1 : -2;
  return score;
}

function numberAgrees(left = {}, right = {}) {
  return !left.number || !right.number || left.number === right.number;
}

function subjectPersonAgrees(word, finite = {}) {
  const person = Number(finite.person) || 3;
  const token = word?.normalized;
  if (person === 1) return ["ego", "nos"].includes(token);
  if (person === 2) return ["tu", "vos"].includes(token);
  return !["ego", "nos", "tu", "vos"].includes(token);
}

function unambiguousPronounCase(token) {
  return ({
    quis: "nominative",
    quem: "accusative",
    quos: "accusative",
    quas: "accusative",
    cui: "dative",
    cuius: "genitive",
    quorum: "genitive",
    quarum: "genitive"
  })[token] || null;
}

function previousClauseBoundary(words, index, choices = null) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const marker = COORDINATORS[words[cursor].normalized] || SUBORDINATORS[words[cursor].normalized] || RELATIVE_FORMS.has(words[cursor].normalized) || INTERROGATIVE_FORMS.has(words[cursor].normalized);
    const activeMarker = marker && (!choices
      || partOfMorphology(choices[cursor]?.morphology) === "conj"
      || (RELATIVE_FORMS.has(words[cursor].normalized) || INTERROGATIVE_FORMS.has(words[cursor].normalized)) && partOfMorphology(choices[cursor]?.morphology) === "pron");
    const finiteCommaBoundary = words[cursor].punctuationAfter?.includes(",")
      && words.slice(0, cursor + 1).some(word => wordFiniteAnalyses(word).length)
      && words.slice(cursor + 1).some(word => wordFiniteAnalyses(word).length);
    if (activeMarker || finiteCommaBoundary || words[cursor].punctuationAfter?.some(mark => [";", ":"].includes(mark))) return cursor + 1;
  }
  return 0;
}

function nextClauseBoundary(words, index, choices = null) {
  for (let cursor = index + 1; cursor < words.length; cursor += 1) {
    const marker = COORDINATORS[words[cursor].normalized] || SUBORDINATORS[words[cursor].normalized] || RELATIVE_FORMS.has(words[cursor].normalized) || INTERROGATIVE_FORMS.has(words[cursor].normalized);
    const activeMarker = marker && (!choices
      || partOfMorphology(choices[cursor]?.morphology) === "conj"
      || (RELATIVE_FORMS.has(words[cursor].normalized) || INTERROGATIVE_FORMS.has(words[cursor].normalized)) && partOfMorphology(choices[cursor]?.morphology) === "pron");
    const finiteCommaBoundary = words[cursor - 1]?.punctuationAfter?.includes(",")
      && words.slice(0, cursor).some(word => wordFiniteAnalyses(word).length)
      && words.slice(cursor).some(word => wordFiniteAnalyses(word).length);
    if (activeMarker || finiteCommaBoundary || words[cursor - 1]?.punctuationAfter?.some(mark => [";", ":"].includes(mark))) return cursor;
  }
  return words.length;
}

function nearestIndex(indexes, target) {
  return [...indexes].sort((left, right) => Math.abs(left - target) - Math.abs(right - target))[0] ?? -1;
}

function isPrepositionalCum(words, index) {
  return words.slice(index + 1, index + 5).some(word => isNominal(word) && caseIncludes(word.morphology, "ablative"));
}

function subordinateType(marker) {
  if (marker === "si" || marker === "nisi") return "conditional";
  if (["quia", "quoniam", "quod"].includes(marker)) return "causal";
  if (["postquam"].includes(marker)) return "temporal-anterior";
  if (["cum", "dum", "antequam", "priusquam"].includes(marker)) return "temporal";
  return "subordinate";
}

function chooseSubject(candidates, finiteIndex, words) {
  if (!candidates.length) return null;
  const before = candidates.filter(index => finiteIndex == null || index < finiteIndex);
  return (before.length ? before : candidates)[0];
}

function nearestAgreeingNominal(words, indexes, modifierIndex, options = {}) {
  const excluded = options.exclude || new Set();
  return indexes
    .filter(index => index !== modifierIndex && !excluded.has(index) && isNominal(words[index]) && (!options.case || caseIncludes(words[index].morphology, options.case)) && (!options.nominativeOnly || caseIncludes(words[index].morphology, "nominative")))
    .map(index => ({ index, distance: Math.abs(index - modifierIndex), score: agreementScore(words[index].morphology, words[modifierIndex].morphology) }))
    .filter(item => item.score >= 1)
    .sort((left, right) => right.score - left.score || left.distance - right.distance)[0]?.index ?? null;
}

function isGerundiveForm(word) {
  const morphology = word?.morphology || {};
  return partOf(word) === "gerund"
    || morphology.nonFinite === "gerund"
    || morphology.nonFiniteType === "gerund"
    || morphology.gerundiveCandidate
    || morphology.gerundCandidate
    || partOf(word) === "ppa" && morphology.tense === "future" && morphology.voice === "passive";
}

function isGerundForm(word) {
  const morphology = word?.morphology || {};
  return partOf(word) === "gerund"
    || morphology.nonFinite === "gerund"
    || morphology.nonFiniteType === "gerund"
    || Boolean(morphology.gerundCandidate);
}

function isSupine(word) {
  return partOf(word) === "supine" || word?.morphology?.nonFinite === "supine";
}

function nearestGerundPurposeMarker(words, indexes, gerund) {
  if (!caseIncludes(gerund.morphology, "genitive")) return null;
  return indexes
    .filter(index => ["causa", "gratia"].includes(words[index]?.lemma) || ["causa", "gratia"].includes(words[index]?.normalized))
    .sort((left, right) => Math.abs(left - gerund.index) - Math.abs(right - gerund.index))[0] ?? null;
}

function nearestGerundPreposition(words, indexes, gerund) {
  const candidates = indexes.filter(index => index < gerund.index && gerund.index - index <= 3 && LATIN_PREPOSITIONS[words[index]?.normalized]);
  return candidates.sort((left, right) => right - left)[0] ?? null;
}

function nearestNominalIndex(words, indexes, targetIndex, excluded = new Set()) {
  return indexes.filter(index => !excluded.has(index) && isNominal(words[index])).sort((left, right) => Math.abs(left - targetIndex) - Math.abs(right - targetIndex))[0] ?? null;
}

function nearestAntecedent(words, relativeIndex) {
  return words.slice(0, relativeIndex).filter(isNominal).sort((left, right) => right.index - left.index)[0]?.index ?? null;
}

function isRelativeMarker(words, index) {
  const word = words[index];
  if (!word || !RELATIVE_FORMS.has(word.normalized) || partOf(word) !== "pron") return false;
  if (word.morphology?.pronounKind && word.morphology.pronounKind !== "relative") return false;

  // `quam` after a comparative or the correlatives tam/tantus/talis is a
  // comparison particle, not a relative pronoun.
  if (word.normalized === "quam") {
    const leftContext = words.slice(Math.max(0, index - 5), index);
    if (leftContext.some(item => item.morphology?.comparison === "comparative" || ["tam", "tantus", "talis", "tot"].includes(item.normalized))) return false;
  }

  const antecedent = words.slice(0, index).filter(item => isNominal(item) && !RELATIVE_FORMS.has(item.normalized)).at(-1);
  if (!antecedent) return false;
  const relative = word.morphology || {};
  const nominal = antecedent.morphology || {};
  if (relative.number && nominal.number && relative.number !== nominal.number) return false;
  if (relative.gender && nominal.gender && !["c", "x"].includes(relative.gender) && !["c", "x"].includes(nominal.gender) && relative.gender !== nominal.gender) return false;
  return true;
}

function allowsAci(word) {
  return Boolean(word && (VERB_CLASSES.speechThought.has(word.lemma) || VERB_FRAMES[word.lemma]?.allowsAci));
}

function canGovernInfinitive(word) {
  if (!word || word.morphology?.mood !== "infinitive") return false;
  return allowsAci(word)
    || VERB_CLASSES.command.has(word.lemma)
    || VERB_CLASSES.modal.has(word.lemma)
    || Boolean(VERB_FRAMES[word.lemma]?.allowsInfinitive);
}

function nearestGoverningPredicate(words, infinitiveIndex) {
  const infinitiveController = words
    .filter(word => word.index < infinitiveIndex && canGovernInfinitive(word))
    .sort((left, right) => right.index - left.index)[0];
  return infinitiveController || nearestGoverningFinite(words, infinitiveIndex);
}

function nearestGoverningFinite(words, infinitiveIndex) {
  const finite = words.filter(isFinite);
  const before = finite.filter(word => word.index < infinitiveIndex).sort((left, right) => right.index - left.index);
  return before[0] || finite.sort((left, right) => Math.abs(left.index - infinitiveIndex) - Math.abs(right.index - infinitiveIndex))[0] || null;
}

function chooseAciSubject(accusatives, infinitive, governing) {
  const reflexive = accusatives.find(word => ["se", "sese"].includes(word.normalized));
  if (reflexive) return reflexive;
  return [...accusatives].sort((left, right) => {
    const score = word => {
      let value = 0;
      if (ANIMATE_LEMMAS.has(word.lemma)) value += 12;
      if (partOf(word) === "pron") value += 8;
      if (isProper(word) && word.morphology?.gender !== "n") value += 4;
      if (word.morphology?.gender === "n") value -= 2;
      // Distance resolves otherwise equal candidates without overriding
      // animacy, pronoun or proper-name evidence.  This is what separates
      // adjacent subjects in nested or coordinated infinitive statements.
      value -= Math.abs(word.index - infinitive.index) * .1;
      if (word.index < infinitive.index) value += .02;
      return value;
    };
    return score(right) - score(left);
  })[0];
}

function coordinatedAciSubject(constructions, words, governing, infinitive, accusatives) {
  const previous = [...constructions].reverse().find(item =>
    item.type === "aci" && item.governingIndex === governing.index && item.infinitiveIndex < infinitive.index
  );
  if (!previous) return null;
  const coordinated = words.slice(previous.infinitiveIndex + 1, infinitive.index)
    .some(word => Boolean(COORDINATORS[word.normalized]));
  if (!coordinated) return null;
  const frame = VERB_FRAMES[infinitive.lemma];
  const requiresAccusative = frame?.cases?.includes("accusative") || infinitive.morphology?.transitivity === "transitive";
  if (!requiresAccusative) return null;
  const inherited = accusatives.find(word => word.index === previous.subjectIndex);
  const availableObject = accusatives.some(word => word.index !== previous.subjectIndex);
  return inherited && availableObject ? inherited : null;
}

function normalizeStatementInfinitives(result, words) {
  const statements = result.constructions.filter(item => ["aci", "nci"].includes(item.type));
  if (!statements.length) return;

  const statementSet = new Set(statements);
  const statementGroups = new Map();
  const grouped = [];
  const groups = new Map();
  for (const statement of statements) {
    const key = `${statement.type}:${statement.governingIndex}:${statement.subjectIndex ?? "implicit"}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        ...statement,
        infinitiveIndexes: [],
        predicates: []
      };
      groups.set(key, group);
      grouped.push(group);
    }
    group.infinitiveIndexes.push(statement.infinitiveIndex);
    group.predicates.push({
      infinitiveIndex: statement.infinitiveIndex,
      predicateIndex: statement.predicateIndex ?? null,
      objectIndexes: [...new Set(statement.objectIndexes || [])]
    });
    statementGroups.set(statement, group);
  }

  for (const group of grouped) {
    const objectIndexes = [...new Set(group.predicates.flatMap(predicate => predicate.objectIndexes))];
    for (const predicate of group.predicates) predicate.objectIndexes = [];
    for (const objectIndex of objectIndexes) {
      const closest = [...group.predicates].sort((left, right) =>
        Math.abs(left.infinitiveIndex - objectIndex) - Math.abs(right.infinitiveIndex - objectIndex)
      )[0];
      if (closest) closest.objectIndexes.push(objectIndex);
    }
    group.infinitiveIndex = group.infinitiveIndexes[0];
    group.predicateIndex = group.predicates[0]?.predicateIndex ?? null;
    group.objectIndexes = objectIndexes;
  }

  // Nominals owned by a nested statement must not leak into its parent's
  // complement list.  The hierarchy is defined by a statement-governing
  // infinitive, so it remains independent of a particular source sentence.
  for (const child of grouped) {
    const parent = grouped.find(candidate => candidate.infinitiveIndexes.includes(child.governingIndex));
    if (!parent) continue;
    child.parentInfinitiveIndex = child.governingIndex;
    const nestedIndexes = new Set([
      child.subjectIndex,
      child.predicateIndex,
      ...(child.objectIndexes || [])
    ].filter(index => index != null));
    parent.objectIndexes = parent.objectIndexes.filter(index => !nestedIndexes.has(index));
    for (const predicate of parent.predicates) {
      predicate.objectIndexes = predicate.objectIndexes.filter(index => !nestedIndexes.has(index));
    }
  }

  const emitted = new Set();
  result.constructions = result.constructions.flatMap(item => {
    if (!statementSet.has(item)) return [item];
    const group = statementGroups.get(item);
    if (!group || emitted.has(group)) return [];
    emitted.add(group);
    return [group];
  });
}

/*
 * Participial constructions own the material between their controller and
 * the participle, plus attributes that depend on that material. Recording
 * this span keeps a shallow main-clause parser from later emitting the same
 * object or modifier a second time.
 */
function participleInternalIndexes(result, controllerIndex, participleIndex) {
  const lower = Math.min(controllerIndex, participleIndex);
  const upper = Math.max(controllerIndex, participleIndex);
  const indexes = new Set(range(lower, upper));
  const dependencies = result.dependencies || [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const dependency of dependencies) {
      const dependentType = ["attribute", "participle", "genitive-attribute"].includes(dependency.type);
      if (dependentType && indexes.has(dependency.headIndex) && !indexes.has(dependency.dependentIndex)) {
        indexes.add(dependency.dependentIndex);
        changed = true;
      }
      if (dependency.type === "prepositional-object") {
        if (indexes.has(dependency.headIndex) && !indexes.has(dependency.dependentIndex)) {
          indexes.add(dependency.dependentIndex);
          changed = true;
        } else if (indexes.has(dependency.dependentIndex) && !indexes.has(dependency.headIndex)) {
          indexes.add(dependency.headIndex);
          changed = true;
        }
      }
    }
  }
  return indexes;
}

function participleArgumentIndexes(words, internalIndexes, controllerIndex, participleIndex) {
  return [...internalIndexes].filter(index => {
    if (index === controllerIndex || index === participleIndex || !isNominal(words[index])) return false;
    return ["accusative", "dative", "genitive"].some(grammaticalCase => caseIncludes(words[index].morphology, grammaticalCase));
  });
}

function ablativeAbsoluteRelation(words) {
  const discourseTokens = words.map(word => word.normalized);
  if (discourseTokens.includes("tamen")) return "concessive";
  if (discourseTokens.some(token => ["ergo", "ideo", "itaque", "propterea"].includes(token))) return "causal";
  return "temporal";
}

function participleIsLexicallyActive(word) {
  return Boolean(
    word?.morphology?.deponent
    || word?.morphology?.semideponent
    || word?.morphology?.lexicalVoice === "deponent"
    || word?.morphology?.verbClass === "deponent"
    || VERB_FRAMES[word?.lemma]?.deponent
    || VERB_FRAMES[word?.lemma]?.semideponent
  );
}

function readingForCase(word, grammaticalCase) {
  if (!word || !isNominal(word)) return null;
  if (caseIncludes(word.morphology, grammaticalCase)) return word;
  const candidates = (word.candidates || [])
    .filter(candidate => isNominal({ ...word, morphology: candidate.morphology, entry: candidate.entry || word.entry }) && caseIncludes(candidate.morphology, grammaticalCase))
    .sort((left, right) => {
      const semanticPenalty = candidate => ANIMATE_LEMMAS.has(normalizeLatin(candidate.morphology?.dictionaryLemma || candidate.entry?.lemma || word.lemma)) && candidate.morphology?.gender === "n" ? 10 : 0;
      return (Number(right.score) - semanticPenalty(right)) - (Number(left.score) - semanticPenalty(left));
    });
  const selected = candidates[0];
  if (!selected) return null;
  return {
    ...word,
    morphology: cloneMorphology(selected.morphology),
    entry: selected.entry || word.entry,
    lemma: normalizeLatin(selected.morphology?.dictionaryLemma || selected.entry?.lemma || selected.entry?.latein || word.lemma),
    selected: { ...selected, origin: "contextual-case" }
  };
}

function participleReadingForCase(word, grammaticalCase) {
  const selected = (word.candidates || [])
    .filter(candidate => partOfMorphology(candidate.morphology) === "ppa" && caseIncludes(candidate.morphology, grammaticalCase))
    .sort((left, right) => Number(right.score) - Number(left.score))[0];
  const morphology = cloneMorphology(selected?.morphology || word.morphology);
  if (!caseIncludes(morphology, grammaticalCase)) return null;
  morphology.substantivized = true;
  return {
    ...word,
    morphology,
    entry: selected?.entry || word.entry,
    selected: selected ? { ...selected, origin: "contextual-substantive" } : word.selected
  };
}

function commitContextualReadings(words, readings) {
  for (const reading of readings) {
    if (reading?.index == null) continue;
    words[reading.index] = reading;
  }
}

function nearestFiniteBefore(words, index) {
  return words.filter(word => isFinite(word) && word.index < index).sort((left, right) => right.index - left.index)[0] || null;
}

function hasPerfectPassiveAt(words, finiteIndex) {
  return words.some(word => partOf(word) === "ppa" && word.morphology.tense === "perfect" && Math.abs(word.index - finiteIndex) <= 4);
}

function isEsseEntry(entry) {
  return ["sum", "esse"].includes(normalizeLatin(entry?.lemma || entry?.latein));
}

function structuralMeaning(word) {
  return COORDINATORS[word.normalized] || SUBORDINATORS[word.normalized] || LATIN_PREPOSITIONS[word.normalized]?.german || DISCOURSE_ADVERBS[word.normalized] || (["non", "haud"].includes(word.normalized) ? "nicht" : word.normalized === "que" ? "und" : "");
}

function isStructural(word) {
  return Boolean(structuralMorphology(word.normalized));
}

function pronounMeaning(word) {
  const grammaticalCase = firstCase(word.morphology) || "nominative";
  if (PERSONAL_PRONOUNS[word.normalized]?.[grammaticalCase]) return PERSONAL_PRONOUNS[word.normalized][grammaticalCase];
  if (RELATIVE_FORMS.has(word.normalized)) return ({ nominative: "der", accusative: "den", dative: "dem", genitive: "dessen", ablative: "dem" })[grammaticalCase] || "der";
  if (INTERROGATIVE_FORMS.has(word.normalized)) return word.normalized === "cur" || word.normalized === "quare" ? "warum" : word.normalized === "ubi" ? "wo" : word.normalized === "quando" ? "wann" : "was";
  return entrySenses(word.entry)[0] || "";
}

function entrySenses(entry) {
  if (!entry) return [];
  const stored = Array.isArray(entry.meanings) ? entry.meanings : [];
  const raw = stored.length ? stored : [entry.deutsch || ""];
  return raw.flatMap(splitSenseAlternatives).map(value => value.trim()).filter(Boolean);
}

function splitSenseAlternatives(value) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (const character of String(value || "")) {
    if (character === "(") depth += 1;
    if (character === ")" && depth > 0) depth -= 1;
    if ((character === ";" || character === ",") && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function cleanVerbSense(value) {
  return String(value)
    .replace(/^\|+/g, "")
    .replace(/^\([^)]*\)\s*/, "")
    .replace(/\([^)]*(?:Dat|Akk|Gen|Abl)[^)]*\)/gi, "")
    .replace(/^(?:jdn\.?|jdm\.?|jemanden|jemandem|etw\.?|etwas)\s+/i, "")
    .trim();
}

function cleanNominalSense(value) {
  return String(value).replace(/^\|+/g, "").replace(/^\([^)]*\)\s*/, "").trim();
}

function cleanProperName(value) {
  const name = String(value || "").replace(/^(?:der|die|das)\s+/i, "").trim();
  return name ? name[0].toLocaleUpperCase("de") + name.slice(1) : name;
}

function normalizeGerman(value) {
  return String(value || "").toLocaleLowerCase("de").replace(/[^a-zäöüß]/g, "");
}

function cloneMorphology(value = {}) {
  return { ...value, possibleCases: value.possibleCases ? [...value.possibleCases] : value.possibleCases, valency: value.valency ? [...value.valency] : value.valency };
}

function cloneWord(word) {
  return { ...word, entries: [...(word.entries || [])], morphologies: (word.morphologies || []).map(cloneMorphology), morphologyCandidates: (word.morphologyCandidates || []).map(candidate => ({ entry: candidate.entry, morphology: cloneMorphology(candidate.morphology) })), punctuationBefore: [...(word.punctuationBefore || [])], punctuationAfter: [...(word.punctuationAfter || [])] };
}

function cloneResolvedWord(word) {
  return { ...cloneWord(word), morphology: cloneMorphology(word.morphology), candidates: (word.candidates || []).map(candidate => ({ ...candidate, morphology: cloneMorphology(candidate.morphology) })), selected: word.selected ? { ...word.selected, morphology: cloneMorphology(word.selected.morphology) } : word.selected };
}

function cloneRoles(roles) {
  return Object.fromEntries(Object.entries(roles || {}).map(([key, value]) => [key, Array.isArray(value) ? value.map(item => typeof item === "object" ? { ...item } : item) : value]));
}

function candidateLemma(candidate) {
  return candidate?.entry?.lemma || candidate?.entry?.latein || "";
}

function distinctEntries(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    if (!entry) return false;
    const key = entryKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function entryKey(entry) {
  return entry ? `${entry.source || ""}|${entry.lemma || entry.latein || ""}|${entry.deutsch || (entry.meanings || []).join(";")}` : "-";
}

function visibleCandidates(candidates) {
  const grammatical = candidates.filter(candidate => !candidate.morphology?.citation);
  return grammatical.length ? grammatical : candidates;
}

function dependency(type, headIndex, dependentIndex, words) {
  return {
    type,
    relation: type,
    headIndex,
    dependentIndex,
    head: headIndex == null ? null : words[headIndex] || null,
    dependent: dependentIndex == null ? null : words[dependentIndex] || null
  };
}

function range(start, end) {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

export { RESOLVED_STATUSES };
