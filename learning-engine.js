const ANSWER_SEPARATORS = /[,;/]/;
const LATIN_WORD_PATTERN = /[\p{L}\p{M}]+(?:[’'][\p{L}\p{M}]+)?/gu;

export function normalizeAnswer(value = "") {
  return String(value)
    .normalize("NFC")
    .toLocaleLowerCase("de")
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ");
}

export function answerVariants(answer = "") {
  return String(answer)
    .replace(/[()]/g, ",")
    .replaceAll("/", ",")
    .split(ANSWER_SEPARATORS)
    .map(value => value.trim())
    .filter(Boolean);
}

export function answerMatches(input, expected) {
  const inputCore = normalizeAnswer(input);
  if (!inputCore) return false;
  return answerVariants(expected).some(variant => {
    const normalized = normalizeAnswer(variant);
    return normalized === inputCore || withoutLeadingArticle(normalized) === withoutLeadingArticle(inputCore);
  });
}

function withoutLeadingArticle(value) {
  return value.replace(/^(?:der|die|das|ein|eine|einen|einem|einer|zu)\s+/, "");
}

export function shuffledUniqueMeanings(entry, entries, random = Math.random) {
  const seen = new Set([entry.deutsch]);
  const distractors = shuffle(
    entries
      .filter(candidate => candidate !== entry && candidate.deutsch !== entry.deutsch)
      .map(candidate => candidate.deutsch)
      .filter(meaning => seen.has(meaning) ? false : (seen.add(meaning), true)),
    random
  ).slice(0, 3);
  return shuffle([entry.deutsch, ...distractors], random);
}

/** Selects the exact book-ordered pool for a free test across one or more lessons. */
export function selectPracticeVocabulary(entries, selectedLessons = "all") {
  if (!Array.isArray(entries)) return [];
  if (selectedLessons === "all") return [...entries];
  if (!Array.isArray(selectedLessons) || selectedLessons.length === 0) return [];
  const lessons = new Set(selectedLessons.map(String));
  return entries.filter(entry => lessons.has(String(entry?.lektion)));
}

export function answerOptionState(choice, answer, selectedChoice, answerRecorded) {
  if (!answerRecorded) return "idle";
  if (choice === answer) return "correct";
  if (choice === selectedChoice) return "wrong";
  return "idle";
}

export function normalizeLatinWord(value = "") {
  return String(value)
    .normalize("NFD")
    .toLocaleLowerCase("la")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("j", "i")
    .replace(/[’']/g, "")
    .replace(/[^a-z]/g, "");
}

export function tokenizeLatinText(text = "") {
  return [...String(text).matchAll(LATIN_WORD_PATTERN)]
    .map(match => ({ raw: match[0], normalized: normalizeLatinWord(match[0]) }))
    .filter(token => token.normalized);
}

const RESOLVED_STATUSES = new Set(["exact", "book-form", "fallback", "contextual", "proper", "corrected", "ambiguous"]);
const SOURCE_PRIORITY = { "proper-context": 5, glossary: 4, book: 3, fallback: 2, proper: 1 };

export function analyzeBookText(text, vocabulary, grammarSections, maxLesson = null, fallbackEntries = [], morphologyAnalyses = new Map(), translationMemory = []) {
  const allowedVocabulary = vocabulary.filter(entry => maxLesson == null || Number(entry.lektion) <= Number(maxLesson));
  const sourceLines = splitLatinUnits(text);
  const sourceTokens = sourceLines.flatMap(line => tokenizeLatinText(line));
  const descriptors = [
    ...allowedVocabulary.map(bookDescriptor),
    ...fallbackEntries.map(fallbackDescriptor)
  ];
  const contextualProperNames = morphologyProperNameDescriptors(sourceTokens, morphologyAnalyses);
  const baseIndex = buildVocabularyIndex([...descriptors, ...contextualProperNames]);
  const unresolvedCapitalizedTokens = sourceTokens.filter(token => !baseIndex.words.has(token.normalized) && !baseIndex.forms.has(token.normalized));
  const properNames = properNameDescriptors(unresolvedCapitalizedTokens);
  const index = properNames.length ? buildVocabularyIndex([...descriptors, ...contextualProperNames, ...properNames]) : baseIndex;
  const lineAnalyses = sourceLines.map(line => {
    const tokens = tokenizeLatinText(line);
    return { source: line, tokens, matches: analyzeTokens(tokens, index, morphologyAnalyses) };
  });
  const tokens = lineAnalyses.flatMap(line => line.tokens);
  const matches = lineAnalyses.flatMap(line => line.matches);
  const resolved = matches.filter(match => RESOLVED_STATUSES.has(match.status));
  const coveredWords = resolved.reduce((total, match) => total + match.length, 0);
  const grammar = detectGrammarRules(tokens, grammarSections);
  if (lineAnalyses.some(line => hasAblativeAbsolute(line.matches))) addGrammarRule(grammar, grammarSections, "Ablativus absolutus", "Substantiv und Partizip im Ablativ bilden wahrscheinlich einen Ablativus absolutus.");
  if (matches.some(match => hasMorphology(match, morphology => morphology.part === "v" && morphology.mood === "indicative" && morphology.tense === "present"))) {
    addGrammarRule(grammar, grammarSections, "Präsens Aktiv", "Eine finite Verbform im Präsens Aktiv wurde über Person und Numerus bestimmt.", false);
  }

  const passageMatches = findTranslationMemoryPassage(text, translationMemory);
  const translatedLines = passageMatches?.length
    ? passageMatches.map(match => ({ text: match.german, verified: true, reliable: true }))
    : lineAnalyses.map(line => {
      const verified = findTranslationMemoryMatch(line.source, translationMemory);
      const reliable = Boolean(verified) || isReliableHeuristicLine(line.matches);
      return { text: verified?.german || translateLatinLine(line.matches), verified: Boolean(verified), reliable };
    });
  const translationReliable = translatedLines.length > 0 && translatedLines.every(line => line.reliable);

  return {
    text: String(text).trim(),
    correctedText: lineAnalyses.map(line => line.matches.map(match => match.canonicalForm || match.token).join(" ")).join("\n"),
    translation: translationReliable ? translatedLines.map(line => line.text).join("\n") : "",
    translationReliable,
    verifiedLines: translatedLines.filter(line => line.verified).length,
    translationVerified: translatedLines.length > 0 && translatedLines.every(line => line.verified),
    maxLesson,
    tokenCount: tokens.length,
    coveredWords,
    unresolvedWords: Math.max(tokens.length - coveredWords, 0),
    coverage: tokens.length ? Math.round(coveredWords / tokens.length * 100) : 0,
    matches,
    draft: matches.map(match => RESOLVED_STATUSES.has(match.status) ? match.entries[0].deutsch : `[${match.token}]`).join(" · "),
    grammar
  };
}

function isReliableHeuristicLine(matches) {
  if (!matches.length || matches.some(match => !RESOLVED_STATUSES.has(match.status) || !match.entries.length)) return false;
  const ppaIndex = matches.findIndex(match => hasMorphology(match, morphology => morphology.part === "ppa" && morphology.case?.includes("ablative") && morphology.number === "plural"));
  const ablativeSubject = matches.findIndex((match, index) => index !== ppaIndex && hasMorphology(match, morphology => morphology.part === "n" && morphology.case?.includes("ablative") && morphology.number === "plural"));
  if (ppaIndex >= 0 && ablativeSubject >= 0) return matches.length <= 8;

  const clauseMarkers = new Set(["cum", "dum", "ne", "nisi", "postquam", "quam", "quod", "qui", "quia", "si", "ut"]);
  if (matches.some(match => clauseMarkers.has(match.normalized))) return false;
  const finiteVerbs = matches.filter(match => hasMorphology(match, morphology => morphology.part === "v" && morphology.mood === "indicative" && morphology.person));
  const nominativeSubjects = matches.filter(match => hasMorphology(match, morphology => morphology.part === "n" && morphology.case?.includes("nominative")));
  return matches.length <= 6 && finiteVerbs.length === 1 && nominativeSubjects.length === 1;
}

function findTranslationMemoryMatch(source, entries) {
  const sourceTokens = tokenizeLatinText(source).map(token => token.normalized);
  if (sourceTokens.length < 4) return null;
  let best = null;
  for (const entry of entries || []) {
    const candidateTokens = tokenizeLatinText(entry.latin).map(token => token.normalized);
    if (sourceTokens.length !== candidateTokens.length || hasCriticalTokenMismatch(sourceTokens, candidateTokens)) continue;
    const similarity = ocrCompatibleTokenSimilarity(sourceTokens, candidateTokens);
    if (similarity == null) continue;
    if (similarity >= .88 && (!best || similarity > best.similarity)) best = { ...entry, similarity };
  }
  return best;
}

function findTranslationMemoryPassage(source, entries) {
  const sourceTokens = tokenizeLatinText(source).map(token => token.normalized);
  if (sourceTokens.length < 4) return null;
  const candidates = (entries || [])
    .map(entry => ({ entry, tokens: tokenizeLatinText(entry.latin).map(token => token.normalized) }))
    .filter(candidate => candidate.tokens.length >= 4);
  const states = Array(sourceTokens.length + 1).fill(null);
  states[0] = { score: 0, weight: 0, matches: [] };

  for (let start = 0; start < sourceTokens.length; start += 1) {
    const state = states[start];
    if (!state) continue;
    for (const candidate of candidates) {
      const observedLength = candidate.tokens.length;
      if (start + observedLength > sourceTokens.length) continue;
      const observed = sourceTokens.slice(start, start + observedLength);
      if (hasCriticalTokenMismatch(observed, candidate.tokens)) continue;
      const similarity = ocrCompatibleTokenSimilarity(observed, candidate.tokens);
      if (similarity == null) continue;
      const threshold = candidate.tokens.length <= 6 ? .92 : .88;
      if (similarity < threshold) continue;
      const end = start + observedLength;
      const next = {
        score: state.score + similarity * candidate.tokens.length,
        weight: state.weight + candidate.tokens.length,
        matches: [...state.matches, candidate.entry]
      };
      const previous = states[end];
      if (!previous || next.score / next.weight > previous.score / previous.weight) states[end] = next;
    }
  }

  const complete = states[sourceTokens.length];
  return complete && complete.score / complete.weight >= .9 ? complete.matches : null;
}

function hasCriticalTokenMismatch(observed, candidate) {
  const critical = new Set(["haud", "ne", "nec", "neque", "nihil", "nisi", "non", "num", "sine"]);
  for (const token of critical) {
    if (observed.filter(word => word === token).length !== candidate.filter(word => word === token).length) return true;
  }
  return false;
}

function ocrCompatibleTokenSimilarity(observed, candidate) {
  if (observed.length !== candidate.length) return null;
  let cost = 0;
  for (let index = 0; index < observed.length; index += 1) {
    if (observed[index] === candidate[index]) continue;
    if (Math.min(observed[index].length, candidate[index].length) < 4 || levenshtein(observed[index], candidate[index]) !== 1) return null;
    cost += .25;
  }
  return 1 - cost / Math.max(observed.length, 1);
}

function splitLatinUnits(text) {
  const rawLines = String(text).split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (rawLines.some(line => /^\d+\s*[.)]/.test(line))) {
    return rawLines.reduce((units, line) => {
      if (/^\d+\s*[.)]/.test(line) || !units.length) units.push(line.replace(/^\s*\d+\s*[.)]\s*/, ""));
      else units[units.length - 1] += ` ${line}`;
      return units;
    }, []).map(line => line.trim()).filter(Boolean);
  }
  return rawLines.join(" ")
    .split(/(?<=[.!?;])\s+/)
    .map(line => line.replace(/^\s*\d+\s*[.)]\s*/, "").trim())
    .filter(Boolean);
}

function analyzeTokens(tokens, index, morphologyAnalyses) {
  const matches = [];
  for (let position = 0; position < tokens.length;) {
    const phrase = longestPhraseMatch(tokens, position, index.phrases);
    if (phrase) {
      matches.push(classifyExactMatch(phrase.raw, phrase.entries, phrase.length, [], phrase.key));
      position += phrase.length;
      continue;
    }

    const token = tokens[position];
    const headwordEntries = index.words.get(token.normalized) || [];
    const externalMorphology = morphologyAnalyses.get(token.normalized) || [];
    const formRecords = preferContextualCase(
      mergeFormRecords(resolveFormRecords(token.normalized, index.forms), resolveMorphologyRecords(token.normalized, morphologyAnalyses, index)),
      tokens,
      position,
      morphologyAnalyses
    );
    if (headwordEntries.length) {
      const directMorphologyRecords = formRecords.filter(record => record.directLemma);
      const directLemmas = new Set(directMorphologyRecords.map(record => normalizeLatinWord(record.entry.lemma)));
      if (directLemmas.size === 1 && !directLemmas.has(token.normalized)) {
        matches.push(classifyFormMatch(token.raw, directMorphologyRecords, token.normalized));
      } else if (directMorphologyRecords.length) {
        matches.push(classifyExactMatch(token.raw, [...directMorphologyRecords.map(record => record.entry), ...headwordEntries], 1, formRecords, token.normalized));
      } else {
        matches.push(classifyExactMatch(token.raw, headwordEntries, 1, formRecords, token.normalized));
      }
    } else if (formRecords.length) {
      matches.push(classifyFormMatch(token.raw, formRecords, token.normalized));
    } else {
      const correction = externalMorphology.length ? null : findOcrCorrection(token.normalized, index);
      if (correction) {
        matches.push(classifyFormMatch(token.raw, correction.records, correction.form, "corrected"));
      } else {
        const suggestions = conservativeSuggestions(token.normalized, index.singleWordEntries);
        matches.push({
          token: token.raw,
          normalized: token.normalized,
          status: suggestions.length ? "candidate" : "unknown",
          entries: suggestions,
          morphology: [],
          canonicalForm: null,
          length: 1
        });
      }
    }
    position += 1;
  }
  return matches;
}

function resolveMorphologyRecords(token, analyses, index) {
  const records = [];
  for (const analysis of analyses.get(token) || []) {
    const directEntries = index.words.get(analysis.forms[0]) || [];
    const generatedEntries = analysis.forms.flatMap(form => (index.forms.get(form) || []).map(record => record.entry));
    const rawEntries = directEntries.length ? directEntries : generatedEntries;
    const citationLemma = normalizeLatinWord(String(analysis.citation || "").match(/^([\p{L}\p{M}]+)/u)?.[1]);
    const citationCompatible = rawEntries.filter(entry => entry.source !== "proper-context" || normalizeLatinWord(entry.lemma) === citationLemma);
    const entries = rawEntries.some(entry => entry.source === "proper-context") ? citationCompatible : rawEntries;
    const compatible = entries.filter(entry => partOfSpeechMatches(entry.pos, analysis.morphology?.part));
    for (const entry of preferredEntries(compatible.length ? compatible : entries)) records.push({ form: token, entry, morphology: analysis.morphology, directLemma: directEntries.includes(entry) });
  }
  return records;
}

function partOfSpeechMatches(entryPart, analysisPart) {
  if (!entryPart || entryPart === "x" || !analysisPart) return true;
  if (analysisPart === "ppa") return entryPart === "v" || entryPart === "ppa";
  return entryPart === analysisPart;
}

function preferContextualCase(records, tokens, position, analyses) {
  if (records.length < 2) return records;
  const previous = tokens[position - 1];
  const next = tokens[position + 1];
  const accusativePrepositions = new Set(["ad", "ante", "apud", "contra", "inter", "ob", "per", "post", "propter", "trans"]);
  const ablativePrepositions = new Set(["ab", "cum", "de", "ex", "pro", "sine"]);
  let preferredCase = ["salve", "salvete"].includes(previous?.normalized) ? "vocative"
    : accusativePrepositions.has(previous?.normalized) ? "accusative"
    : ablativePrepositions.has(previous?.normalized) ? "ablative"
      : null;

  if (!preferredCase && previous && next) {
    const previousCanBeSubject = (analyses.get(previous.normalized) || []).some(analysis => morphologyHasCase(analysis.morphology, "nominative"));
    const nextIsFiniteVerb = (analyses.get(next.normalized) || []).some(analysis => analysis.morphology?.part === "v" && analysis.morphology.mood === "indicative" && analysis.morphology.person);
    const hasAccusativeReading = records.some(record => morphologyHasCase(record.morphology, "accusative"));
    if (previousCanBeSubject && nextIsFiniteVerb && hasAccusativeReading) preferredCase = "accusative";
  }

  if (!preferredCase) return records;
  const matching = records.filter(record => morphologyHasCase(record.morphology, preferredCase));
  return matching.length ? matching : records;
}

function morphologyHasCase(morphology, grammaticalCase) {
  return String(morphology?.case || "").split("/").includes(grammaticalCase);
}

function mergeFormRecords(...groups) {
  const seen = new Set();
  return groups.flat().filter(record => {
    const key = `${record.entry.source}|${record.entry.lemma}|${JSON.stringify(record.morphology)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function bookDescriptor(entry) {
  const forms = [...headwordVariants(entry.latein), ...latinFormsFromGrammar(entry.grammatik)];
  return {
    ...entry,
    lemma: headwordVariants(entry.latein)[0] || entry.latein,
    forms: [...new Set(forms)],
    meanings: [entry.deutsch],
    pos: inferPartOfSpeech(entry.latein, entry.grammatik),
    source: "book"
  };
}

function fallbackDescriptor(entry) {
  return {
    lemma: entry.lemma,
    latein: entry.lemma,
    grammatik: entry.grammatik || entry.forms.slice(1).join(", "),
    deutsch: entry.meanings.join(", "),
    lektion: null,
    forms: entry.forms,
    meanings: entry.meanings,
    pos: entry.pos,
    source: entry.source || "fallback"
  };
}

function properNameDescriptors(tokens) {
  const descriptors = new Map();
  for (const token of tokens) {
    if (!/^\p{Lu}/u.test(token.raw) || token.normalized.length < 3) continue;
    const lemma = inferProperLemma(token.raw);
    const key = normalizeLatinWord(lemma);
    if (!key || descriptors.has(key)) continue;
    const forms = properNameForms(lemma);
    descriptors.set(key, {
      lemma,
      latein: lemma,
      grammatik: "Eigenname",
      deutsch: lemma,
      lektion: null,
      forms,
      meanings: [lemma],
      pos: "proper",
      source: "proper"
    });
  }
  return [...descriptors.values()];
}

function morphologyProperNameDescriptors(tokens, analyses) {
  const descriptors = new Map();
  for (const token of tokens) {
    if (!/^\p{Lu}/u.test(token.raw)) continue;
    for (const analysis of analyses.get(token.normalized) || []) {
      const lemma = String(analysis.citation || "").match(/^([\p{L}\p{M}]+)/u)?.[1];
      if (!lemma || !/^\p{Lu}/u.test(lemma)) continue;
      const key = normalizeLatinWord(lemma);
      if (!key || descriptors.has(key)) continue;
      descriptors.set(key, {
        lemma,
        latein: lemma,
        grammatik: "Eigenname",
        deutsch: lemma,
        lektion: null,
        forms: [...new Set([lemma, ...analysis.forms, ...properNameForms(lemma)])],
        meanings: [lemma],
        pos: "proper",
        source: "proper-context"
      });
    }
  }
  return [...descriptors.values()];
}

function inferProperLemma(value) {
  const normalized = normalizeLatinWord(value);
  const lemma = normalized.endsWith("um") ? `${normalized.slice(0, -2)}us`
    : normalized.endsWith("ae") || normalized.endsWith("am") ? `${normalized.slice(0, -2)}a`
      : normalized;
  return lemma[0].toLocaleUpperCase("la") + lemma.slice(1);
}

function properNameForms(lemma) {
  const normalized = normalizeLatinWord(lemma);
  if (normalized.endsWith("us")) {
    const stem = normalized.slice(0, -2);
    return [lemma, `${stem}i`, `${stem}o`, `${stem}um`, `${stem}e`];
  }
  if (normalized.endsWith("a")) {
    const stem = normalized.slice(0, -1);
    return [lemma, `${stem}ae`, `${stem}am`, `${stem}a`];
  }
  return [lemma];
}

function buildVocabularyIndex(entries) {
  const words = new Map();
  const phrases = new Map();
  const forms = new Map();
  const formsByPrefix = new Map();
  const singleWordEntries = [];

  for (const entry of entries) {
    for (const variant of headwordVariants(entry.latein)) {
      const variantTokens = tokenizeLatinText(variant);
      if (!variantTokens.length || variant.includes("...")) continue;
      const key = variantTokens.map(token => token.normalized).join(" ");
      const target = variantTokens.length > 1 ? phrases : words;
      pushMap(target, key, entry);
      if (variantTokens.length === 1) singleWordEntries.push({ word: key, entry });
    }
    for (const record of generateSurfaceForms(entry)) {
      const form = normalizeLatinWord(record.form);
      if (!form) continue;
      const value = { ...record, form, entry };
      pushMap(forms, form, value);
      const prefix = form.slice(0, 2);
      if (!formsByPrefix.has(prefix)) formsByPrefix.set(prefix, new Set());
      formsByPrefix.get(prefix).add(form);
    }
  }

  return { words, phrases, forms, formsByPrefix, singleWordEntries };
}

function pushMap(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function headwordVariants(headword = "") {
  return String(headword).split("/").map(value => value.trim()).filter(Boolean);
}

function longestPhraseMatch(tokens, start, phrases) {
  const lengths = [...phrases.keys()].map(key => key.split(" ").length);
  const maxLength = Math.min(Math.max(0, ...lengths), tokens.length - start);
  for (let length = maxLength; length >= 2; length -= 1) {
    const key = tokens.slice(start, start + length).map(token => token.normalized).join(" ");
    const entries = phrases.get(key);
    if (entries?.length) {
      return { raw: tokens.slice(start, start + length).map(token => token.raw).join(" "), entries, length, key };
    }
  }
  return null;
}

function classifyExactMatch(token, entries, length, formRecords = [], canonicalForm = null) {
  const senses = preferredEntries(entries);
  const status = senses.length > 1 ? "ambiguous" : statusForSource(senses[0]?.source, false);
  return {
    token,
    normalized: normalizeLatinWord(token),
    status,
    entries: senses,
    morphology: preferredRecords(formRecords, senses).map(record => record.morphology).filter(Boolean),
    canonicalForm: displayCanonicalForm(token, canonicalForm),
    length
  };
}

function classifyFormMatch(token, records, canonicalForm, forcedStatus = null) {
  const entries = preferredEntries(records.map(record => record.entry));
  const selectedRecords = preferredRecords(records, entries);
  const source = entries[0]?.source;
  const status = forcedStatus || statusForSource(source, true);
  return { token, normalized: normalizeLatinWord(token), status, entries, morphology: selectedRecords.map(record => record.morphology).filter(Boolean), canonicalForm: displayCanonicalForm(token, canonicalForm), length: 1 };
}

function displayCanonicalForm(original, canonical) {
  if (!canonical) return null;
  return /^\p{Lu}/u.test(original) ? canonical[0].toLocaleUpperCase("la") + canonical.slice(1) : canonical;
}

function preferredEntries(entries) {
  const distinct = distinctEntries(entries);
  const highestPriority = Math.max(0, ...distinct.map(entry => SOURCE_PRIORITY[entry.source] || 0));
  return distinct.filter(entry => (SOURCE_PRIORITY[entry.source] || 0) === highestPriority);
}

function statusForSource(source, inflected) {
  if (source === "book") return inflected ? "book-form" : "exact";
  if (source === "glossary") return "contextual";
  if (source === "proper" || source === "proper-context") return "proper";
  return "fallback";
}

function preferredRecords(records, entries) {
  const allowed = new Set(entries);
  return records.filter(record => allowed.has(record.entry));
}

function distinctEntries(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = `${entry.source}|${entry.latein}|${entry.deutsch}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveFormRecords(token, forms) {
  const direct = forms.get(token) || [];
  if (direct.length) return direct;
  if (token.endsWith("que") && token.length > 4) {
    return (forms.get(token.slice(0, -3)) || []).map(record => ({ ...record, morphology: { ...(record.morphology || {}), enclitic: "que" } }));
  }
  return [];
}

function findOcrCorrection(token, index) {
  if (token.length < 5) return null;
  const possiblePrefixes = new Set(safeOcrVariants(token.slice(0, 2)));
  if (token.length > 2) {
    possiblePrefixes.add(token.slice(1, 3));
    possiblePrefixes.add(token[0] + token[2]);
  }
  for (const character of "abcdefghijklmnopqrstuvwxyz") {
    possiblePrefixes.add(character + token[0]);
    possiblePrefixes.add(token[0] + character);
  }
  const candidates = new Set();
  for (const prefix of possiblePrefixes) {
    for (const form of index.formsByPrefix.get(prefix) || []) {
      if (Math.abs(form.length - token.length) <= 1) candidates.add(form);
    }
  }
  const ranked = [...candidates]
    .map(form => ({ form, distance: levenshtein(token, form), prefix: commonPrefixLength(token, form), records: index.forms.get(form) || [] }))
    .filter(candidate => candidate.distance === 1 && (candidate.form.length !== token.length || isSafeOcrSubstitution(token, candidate.form)))
    .sort((left, right) => recordPriority(right.records) - recordPriority(left.records) || right.prefix - left.prefix || Math.abs(left.form.length - token.length) - Math.abs(right.form.length - token.length));
  if (!ranked.length) return null;
  const best = ranked[0];
  const bestEntries = preferredEntries(best.records.map(record => record.entry));
  const equallyGood = ranked.filter(candidate => recordPriority(candidate.records) === recordPriority(best.records));
  const competingLemmas = new Set(equallyGood.flatMap(candidate => preferredEntries(candidate.records.map(record => record.entry)).map(entry => normalizeLatinWord(entry.lemma))));
  return competingLemmas.size === 1 && bestEntries.length > 0 ? best : null;
}

function safeOcrVariants(value) {
  const variants = new Set([value]);
  const confusions = { i: "l", l: "i", u: "v", v: "u" };
  [...value].forEach((character, index) => {
    if (!confusions[character]) return;
    variants.add(`${value.slice(0, index)}${confusions[character]}${value.slice(index + 1)}`);
  });
  return variants;
}

function isSafeOcrSubstitution(left, right) {
  const confusions = new Set(["il", "li", "uv", "vu"]);
  const differences = [...left].reduce((items, character, index) => character === right[index] ? items : [...items, character + right[index]], []);
  return differences.length === 1 && confusions.has(differences[0]);
}

function recordPriority(records) {
  return Math.max(0, ...records.map(record => SOURCE_PRIORITY[record.entry.source] || 0));
}

function latinFormsFromGrammar(grammar = "") {
  const ignored = new Set(["adv", "prap", "konj", "pron", "dem", "poss", "refl", "gen", "dat", "akk", "abl", "sg", "pl", "mask", "fem", "neutr"]);
  return tokenizeLatinText(grammar)
    .map(token => token.raw)
    .filter(form => form.length > 1 && !ignored.has(normalizeLatinWord(form)));
}

function inferPartOfSpeech(headword = "", grammar = "") {
  const normalizedGrammar = normalizeLatinWord(grammar);
  const first = headwordVariants(headword)[0] || "";
  if (/Adv\./i.test(grammar)) return "adv";
  if (/Konj\./i.test(grammar)) return "conj";
  if (/Präp\./i.test(grammar)) return "prep";
  if (/Pron\./i.test(grammar)) return "pron";
  if (/\b[fm]\.|\bn\./i.test(grammar)) return "n";
  if (/(?:are|ere|ire)$/i.test(normalizeLatinWord(first))) return "v";
  if (/-(?:a|um)|\b(?:a|um)\b/i.test(grammar) || /(?:us|er|is)$/i.test(first) && /(?:a|um)/i.test(grammar)) return "adj";
  if (normalizedGrammar.endsWith("o") || latinFormsFromGrammar(grammar).some(form => /(?:o|eo|io)$/i.test(form))) return "v";
  return "x";
}

function generateSurfaceForms(entry) {
  const records = [];
  const add = (form, morphology = {}) => { if (form) records.push({ form, morphology }); };
  entry.forms.forEach(form => {
    if (tokenizeLatinText(form).length === 1) add(form, { part: entry.pos, citation: true });
  });
  if (entry.pos === "n") generateNounForms(entry, add);
  if (entry.pos === "adj") generateAdjectiveForms(entry, add);
  if (entry.pos === "v") generateVerbForms(entry, add);
  return records;
}

function generateNounForms(entry, add) {
  const forms = entry.forms.map(normalizeLatinWord).filter(Boolean);
  const lemma = normalizeLatinWord(entry.lemma);
  const genitive = forms.find(form => form !== lemma && /(?:ae|i|is|us|ei)$/.test(form));
  if (!genitive) return;
  const paradigms = {
    ae: [["a", "nominative", "singular"], ["ae", "genitive/dative", "singular"], ["am", "accusative", "singular"], ["a", "ablative", "singular"], ["ae", "nominative", "plural"], ["arum", "genitive", "plural"], ["is", "dative/ablative", "plural"], ["as", "accusative", "plural"]],
    i: [["i", "genitive", "singular"], ["o", "dative/ablative", "singular"], ["um", "accusative", "singular"], ["i", "nominative", "plural"], ["orum", "genitive", "plural"], ["is", "dative/ablative", "plural"], ["os", "accusative", "plural"], ["a", "nominative/accusative", "plural"]],
    is: [["is", "genitive", "singular"], ["i", "dative", "singular"], ["em", "accusative", "singular"], ["e", "ablative", "singular"], ["es", "nominative/accusative", "plural"], ["um", "genitive", "plural"], ["ium", "genitive", "plural"], ["ibus", "dative/ablative", "plural"], ["a", "nominative/accusative", "plural"], ["ia", "nominative/accusative", "plural"]],
    us: [["us", "genitive", "singular"], ["ui", "dative", "singular"], ["um", "accusative", "singular"], ["u", "ablative", "singular"], ["us", "nominative/accusative", "plural"], ["uum", "genitive", "plural"], ["ibus", "dative/ablative", "plural"]],
    ei: [["ei", "genitive/dative", "singular"], ["em", "accusative", "singular"], ["e", "ablative", "singular"], ["es", "nominative/accusative", "plural"], ["erum", "genitive", "plural"], ["ebus", "dative/ablative", "plural"]]
  };
  const ending = ["ae", "ei", "is", "us", "i"].find(candidate => genitive.endsWith(candidate));
  if (!ending) return;
  const stem = genitive.slice(0, -ending.length);
  add(lemma, { part: "n", case: "nominative", number: "singular" });
  paradigms[ending].forEach(([suffix, grammaticalCase, number]) => add(stem + suffix, { part: "n", case: grammaticalCase, number }));
}

function generateAdjectiveForms(entry, add) {
  const forms = entry.forms.map(normalizeLatinWord).filter(Boolean);
  const feminine = forms.find(form => form.endsWith("a"));
  const neuter = forms.find(form => form.endsWith("um"));
  if (feminine && neuter) {
    const stem = feminine.slice(0, -1);
    ["us", "a", "um", "i", "ae", "o", "am", "os", "as", "orum", "arum", "is"].forEach(suffix => add(stem + suffix, { part: "adj" }));
    add(stem + "e", { part: "adv" });
  }
  const genitive = forms.find(form => form.endsWith("is"));
  if (genitive) {
    const stem = genitive.slice(0, -2);
    ["is", "i", "em", "e", "es", "ia", "ium", "ibus"].forEach(suffix => add(stem + suffix, { part: "adj" }));
  }
}

function generateVerbForms(entry, add) {
  const forms = entry.forms.map(normalizeLatinWord).filter(Boolean);
  const infinitive = forms.find(form => /(?:are|ere|ire)$/.test(form));
  const firstPerson = forms.find(form => /(?:o|eo|io)$/.test(form));
  if (!infinitive) return;
  add(infinitive, { part: "v", mood: "infinitive", tense: "present", voice: "active" });

  let participleStem;
  if (infinitive.endsWith("are")) {
    const presentStem = infinitive.slice(0, -2);
    participleStem = presentStem + "nt";
    const root = presentStem.slice(0, -1);
    [["o", 1, "singular"], ["as", 2, "singular"], ["at", 3, "singular"], ["amus", 1, "plural"], ["atis", 2, "plural"], ["ant", 3, "plural"]].forEach(([suffix, person, number]) => add(root + suffix, { part: "v", mood: "indicative", tense: "present", voice: "active", person, number }));
  } else if (infinitive.endsWith("ire")) {
    const root = infinitive.slice(0, -3);
    participleStem = root + "ient";
    [["io", 1, "singular"], ["is", 2, "singular"], ["it", 3, "singular"], ["imus", 1, "plural"], ["itis", 2, "plural"], ["iunt", 3, "plural"]].forEach(([suffix, person, number]) => add(root + suffix, { part: "v", mood: "indicative", tense: "present", voice: "active", person, number }));
  } else {
    const root = firstPerson?.endsWith("eo") ? firstPerson.slice(0, -2) : firstPerson?.endsWith("io") ? firstPerson.slice(0, -2) : infinitive.slice(0, -3);
    const endings = firstPerson?.endsWith("eo")
      ? [["eo", 1, "singular"], ["es", 2, "singular"], ["et", 3, "singular"], ["emus", 1, "plural"], ["etis", 2, "plural"], ["ent", 3, "plural"]]
      : firstPerson?.endsWith("io")
        ? [["io", 1, "singular"], ["is", 2, "singular"], ["it", 3, "singular"], ["imus", 1, "plural"], ["itis", 2, "plural"], ["iunt", 3, "plural"]]
        : [["o", 1, "singular"], ["is", 2, "singular"], ["it", 3, "singular"], ["imus", 1, "plural"], ["itis", 2, "plural"], ["unt", 3, "plural"]];
    endings.forEach(([suffix, person, number]) => add(root + suffix, { part: "v", mood: "indicative", tense: "present", voice: "active", person, number }));
    participleStem = root + (firstPerson?.endsWith("io") ? "ient" : "ent");
  }
  const ppaNominative = participleStem.slice(0, -1) + "s";
  add(ppaNominative, { part: "ppa", case: "nominative", number: "singular", tense: "present", voice: "active" });
  [["is", "genitive", "singular"], ["i", "dative", "singular"], ["em", "accusative", "singular"], ["e", "ablative", "singular"], ["es", "nominative/accusative", "plural"], ["ia", "nominative/accusative", "plural"], ["ium", "genitive", "plural"], ["ibus", "dative/ablative", "plural"]].forEach(([suffix, grammaticalCase, number]) => add(participleStem + suffix, { part: "ppa", case: grammaticalCase, number, tense: "present", voice: "active" }));
}

function hasAblativeAbsolute(matches) {
  const ppaIndex = matches.findIndex(match => hasMorphology(match, morphology => morphology.part === "ppa" && morphology.case?.includes("ablative") && morphology.number === "plural"));
  if (ppaIndex < 0) return false;
  return matches.some((match, index) => index !== ppaIndex && hasMorphology(match, morphology => morphology.part === "n" && morphology.case?.includes("ablative") && morphology.number === "plural"));
}

function translateLatinLine(matches) {
  if (!matches.length) return "";
  const ppaIndex = matches.findIndex(match => hasMorphology(match, morphology => morphology.part === "ppa" && morphology.case?.includes("ablative") && morphology.number === "plural"));
  const subjectIndex = matches.findIndex((match, index) => index !== ppaIndex && hasMorphology(match, morphology => morphology.part === "n" && morphology.case?.includes("ablative") && morphology.number === "plural"));
  if (ppaIndex >= 0 && subjectIndex >= 0) {
    const subject = germanNominativePlural(matches[subjectIndex].entries[0]);
    const mainVerb = chooseGermanVerb(matches[ppaIndex].entries, subject);
    const infinitiveIndex = matches.findIndex((match, index) => index !== ppaIndex && hasMorphology(match, morphology => morphology.part === "v" && morphology.mood === "infinitive"));
    const objectIndex = infinitiveIndex >= 0
      ? matches.findIndex((match, index) => index !== subjectIndex && index !== ppaIndex && index < infinitiveIndex && hasMorphology(match, morphology => morphology.part === "n"))
      : -1;
    const adverbMatches = matches.filter((match, index) => ![subjectIndex, ppaIndex, infinitiveIndex, objectIndex].includes(index) && (hasMorphology(match, morphology => morphology.part === "adv") || match.entries[0]?.pos === "adv" || /iterum.*iterumque/i.test(match.token)));
    const adverbText = repeatedAdverbPhrase(adverbMatches) || adverbMatches.map(match => firstMeaning(match.entries[0])).join(" ");
    const complement = infinitiveIndex >= 0 ? translateInfinitiveComplement(matches[infinitiveIndex], objectIndex >= 0 ? matches[objectIndex] : null) : "";
    const predicate = [adverbText, complement, mainVerb].filter(Boolean).join(" ");
    return `${capitalize(`Während ${subject} ${predicate}`)}.`;
  }

  const finiteClause = translateFiniteClause(matches);
  if (finiteClause) return `${capitalize(finiteClause)}.`;

  const words = matches.map(match => {
    if (!RESOLVED_STATUSES.has(match.status) || !match.entries.length) return `[${match.token}]`;
    const meaning = firstMeaning(match.entries[0]);
    return match.morphology.some(item => item.enclitic === "que") ? `und ${meaning}` : meaning;
  });
  return `${capitalize(words.join(" ").replace(/\s+/g, " ").trim())}.`;
}

function translateFiniteClause(matches) {
  const verbIndex = matches.findIndex(match => hasMorphology(match, morphology => morphology.part === "v" && morphology.mood === "indicative" && morphology.person));
  if (verbIndex < 0) return "";
  const verbMorphology = matches[verbIndex].morphology.find(morphology => morphology.part === "v" && morphology.mood === "indicative" && morphology.person);
  const subjectIndex = matches.findIndex((match, index) => index !== verbIndex && hasMorphology(match, morphology => morphology.part === "n" && morphology.case?.includes("nominative") && morphology.number === verbMorphology.number));
  if (subjectIndex < 0) return "";

  const subjectMorphology = matches[subjectIndex].morphology.find(morphology => morphology.part === "n" && morphology.case?.includes("nominative") && morphology.number === verbMorphology.number);
  const subject = germanNominative(matches[subjectIndex].entries[0], subjectMorphology);
  const verb = germanFiniteVerb(matches[verbIndex].entries, verbMorphology);
  if (!subject || !verb) return "";

  const complements = matches
    .map((match, index) => ({ match, index }))
    .filter(({ index }) => ![subjectIndex, verbIndex].includes(index))
    .map(({ match }) => {
      if (!RESOLVED_STATUSES.has(match.status) || !match.entries.length) return `[${match.token}]`;
      if (hasMorphology(match, morphology => morphology.part === "n" && morphology.case?.includes("accusative"))) return germanAccusative(match.entries[0]);
      if (hasMorphology(match, morphology => morphology.part === "adv") || match.entries[0]?.pos === "adv") return firstMeaning(match.entries[0]);
      return firstMeaning(match.entries[0]);
    })
    .filter(Boolean);
  return [subject, verb, ...complements].join(" ");
}

function hasMorphology(match, predicate) {
  return match.morphology?.some(predicate) === true;
}

function translateInfinitiveComplement(verbMatch, objectMatch) {
  const lemma = normalizeLatinWord(verbMatch.entries[0]?.lemma || verbMatch.entries[0]?.latein);
  if (lemma === "pergere" && objectMatch) return `${germanAccusative(objectMatch.entries[0])} fortsetzen`;
  const verb = chooseGermanVerb(verbMatch.entries);
  return objectMatch ? `${germanAccusative(objectMatch.entries[0])} ${verb}` : verb;
}

function chooseGermanVerb(entries, subject = "") {
  const entry = entries[0];
  const lemma = normalizeLatinWord(entry?.lemma || entry?.latein);
  const meanings = entries.flatMap(item => item.meanings || [item.deutsch]).flatMap(splitMeanings);
  if (["cupere", "cupio"].includes(lemma)) return meanings.find(meaning => /wollen/i.test(meaning)) || "wollen";
  if (["instare", "insto"].includes(lemma) && /Gefahr/i.test(subject)) return "drohen";
  if (["cantare", "canto"].includes(lemma)) return "singen";
  if (["amare", "amo"].includes(lemma)) return meanings.find(meaning => /lieben/i.test(meaning)) || "lieben";
  return cleanGermanVerb(meanings[0] || firstMeaning(entry));
}

function germanFiniteVerb(entries, morphology) {
  const infinitive = chooseGermanVerb(entries);
  const person = Number(morphology.person);
  const number = morphology.number;
  const irregular = {
    sein: [["bin", "bist", "ist"], ["sind", "seid", "sind"]],
    haben: [["habe", "hast", "hat"], ["haben", "habt", "haben"]],
    werden: [["werde", "wirst", "wird"], ["werden", "werdet", "werden"]],
    wollen: [["will", "willst", "will"], ["wollen", "wollt", "wollen"]],
    können: [["kann", "kannst", "kann"], ["können", "könnt", "können"]],
    müssen: [["muss", "musst", "muss"], ["müssen", "müsst", "müssen"]],
    dürfen: [["darf", "darfst", "darf"], ["dürfen", "dürft", "dürfen"]],
    sollen: [["soll", "sollst", "soll"], ["sollen", "sollt", "sollen"]],
    mögen: [["mag", "magst", "mag"], ["mögen", "mögt", "mögen"]],
    wissen: [["weiß", "weißt", "weiß"], ["wissen", "wisst", "wissen"]]
  };
  const forms = irregular[infinitive];
  if (forms && person >= 1 && person <= 3) return forms[number === "plural" ? 1 : 0][person - 1];
  if (!/(?:en|n)$/.test(infinitive) || person < 1 || person > 3) return infinitive;
  const stem = infinitive.endsWith("en") ? infinitive.slice(0, -2) : infinitive.slice(0, -1);
  const needsExtraE = /[dt]$/.test(stem);
  const endings = number === "plural"
    ? ["en", needsExtraE ? "et" : "t", "en"]
    : ["e", /[sxzß]$/.test(stem) ? "t" : needsExtraE ? "est" : "st", needsExtraE ? "et" : "t"];
  return stem + endings[person - 1];
}

function cleanGermanVerb(value) {
  return String(value)
    .replace(/^\([^)]*\)\s*/, "")
    .replace(/^(?:sich|etwas|jdn\.?|jdm\.?)\s+/i, "")
    .trim();
}

function repeatedAdverbPhrase(matches) {
  if (matches.some(match => /iterum.*iterumque/i.test(match.token))) return "immer wieder";
  if (matches.length < 2) return "";
  const lemmas = matches.map(match => normalizeLatinWord(match.entries[0]?.lemma || match.entries[0]?.latein).replace(/que$/, ""));
  return new Set(lemmas).size === 1 && matches.some(match => match.morphology.some(item => item.enclitic === "que")) ? "immer wieder" : "";
}

function germanNominativePlural(entry) {
  const phrase = firstMeaning(entry);
  const noun = phrase.replace(/^(?:der|die|das|ein|eine)\s+/i, "").trim();
  let plural = noun;
  if (/e$/i.test(noun)) plural = `${noun}n`;
  else if (/(?:er|el|en)$/i.test(noun)) plural = noun;
  else if (/(?:heit|keit|ung|schaft|gefahr)$/i.test(noun)) plural = `${noun}en`;
  else if (!/n$/i.test(noun)) plural = `${noun}e`;
  return `die ${plural}`;
}

function germanNominative(entry, morphology = {}) {
  if (morphology.number === "plural") return germanNominativePlural(entry);
  const phrase = firstMeaning(entry);
  if (/^(?:der|die|das|ein|eine)\s+/i.test(phrase)) return phrase;
  const noun = phrase.trim();
  const normalizedNoun = noun.toLocaleLowerCase("de");
  const lemma = normalizeLatinWord(entry?.lemma || entry?.latein);
  const article = /(?:chen|lein)$/.test(normalizedNoun) ? "das"
    : /(?:ung|heit|keit|schaft|tät|ion|ik|ie|anz|enz|ur|ei|in)$/.test(normalizedNoun) || lemma.endsWith("a") ? "die"
      : "der";
  return `${article} ${noun}`;
}

function germanAccusative(entry) {
  const phrase = firstMeaning(entry);
  if (/^der\s+/i.test(phrase)) return phrase.replace(/^der\s+/i, "den ");
  if (/^(?:die|das)\s+/i.test(phrase)) return phrase;
  const nominative = germanNominative(entry);
  return nominative.replace(/^der\s+/i, "den ");
}

function firstMeaning(entry) {
  return splitMeanings(entry?.deutsch || entry?.meanings?.[0] || "")[0] || "";
}

function splitMeanings(value) {
  return String(value).split(/[;,]/).map(item => item.trim()).filter(Boolean);
}

function capitalize(value) {
  return value ? value[0].toLocaleUpperCase("de") + value.slice(1) : value;
}

function addGrammarRule(results, grammarSections, titlePart, reason, useBookRule = true) {
  const index = useBookRule ? grammarSections.findIndex(section => section.titel.includes(titlePart)) : -1;
  const title = index >= 0 ? grammarSections[index].titel : titlePart;
  if (results.some(rule => index >= 0 ? rule.index === index : rule.generated && rule.title === title)) return;
  results.push(index >= 0 ? { index, title, reason } : { index: null, title, reason, generated: true });
}

function conservativeSuggestions(token, entries) {
  if (token.length < 4) return [];
  const ranked = [];
  const seen = new Set();

  for (const candidate of entries) {
    if (seen.has(candidate.entry)) continue;
    const distance = levenshtein(token, candidate.word);
    const prefix = commonPrefixLength(token, candidate.word);
    const shortLength = Math.min(token.length, candidate.word.length);
    const looksLikeOcrVariant = distance <= 1 && shortLength >= 4;
    const looksLikeInflection = shortLength >= 5 && prefix >= Math.max(4, shortLength - 3);
    if (!looksLikeOcrVariant && !looksLikeInflection) continue;
    seen.add(candidate.entry);
    ranked.push({ entry: candidate.entry, score: looksLikeOcrVariant ? 2 : 1, distance, prefix });
  }

  return ranked
    .sort((a, b) => b.score - a.score || a.distance - b.distance || b.prefix - a.prefix || a.entry.lektion - b.entry.lektion)
    .slice(0, 3)
    .map(item => item.entry);
}

function detectGrammarRules(tokens, grammarSections) {
  const normalizedTokens = tokens.map(token => token.normalized);
  const results = [];
  const seen = new Set();

  const addByTitle = (titlePart, reason) => {
    const index = grammarSections.findIndex(section => section.titel.includes(titlePart));
    const key = index >= 0 ? `book:${index}` : `generated:${titlePart}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(index >= 0
      ? { index, title: grammarSections[index].titel, reason }
      : { index: null, title: titlePart, reason, generated: true });
  };

  const exactFormHits = grammarFormHits(normalizedTokens, grammarSections);
  for (const hit of exactFormHits.slice(0, 4)) {
    const key = `book:${hit.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(hit);
  }

  if (normalizedTokens.some(word => /(?:bam|bas|bat|bamus|batis|bant)$/.test(word))) {
    addByTitle("Imperfekt Aktiv", "Eine Form mit dem Imperfektzeichen -ba- wurde erkannt.");
  }
  if (normalizedTokens.some(word => /(?:bo|bis|bit|bimus|bitis|bunt)$/.test(word))) {
    addByTitle("Futur I Aktiv", "Eine typische Futur-I-Endung wurde erkannt.");
  }
  if (normalizedTokens.some(word => /(?:or|ris|tur|mur|mini|ntur)$/.test(word))) {
    addByTitle("Passiv: Präsens", "Eine mögliche Passivendung wurde erkannt.");
  }
  if (normalizedTokens.some(word => /(?:ndus|nda|ndum|ndi|ndo|ndae|ndam|ndos|ndas|ndorum|ndarum)$/.test(word))) {
    addByTitle("Gerundium und Gerundivum", "Eine mögliche nd-Form wurde erkannt.");
  }
  if (normalizedTokens.some(word => /(?:ns|ntis|ntes|ntia|ntibus)$/.test(word))) {
    addByTitle("PPA und seine Übersetzung", "Eine mögliche Form des Partizip Präsens Aktiv wurde erkannt.");
  }

  const hasInfinitive = normalizedTokens.some(word => /(?:are|ere|ire)$/.test(word));
  const hasAccusativePronoun = normalizedTokens.some(word => ["me", "te", "se", "eum", "eam", "eos", "eas", "nos", "vos"].includes(word));
  if (hasInfinitive && hasAccusativePronoun) {
    addByTitle("AcI und NcI", "Akkusativpronomen und Infinitiv können auf einen AcI hinweisen.");
  }

  return results.slice(0, 6);
}

function grammarFormHits(tokens, grammarSections) {
  const tokenSet = new Set(tokens);
  const hits = [];
  grammarSections.forEach((section, index) => {
    const forms = new Set();
    collectGrammarForms(section, null, forms);
    const matched = [...forms].find(form => tokenSet.has(form));
    if (matched) hits.push({ index, title: section.titel, reason: `Die Form „${matched}“ steht in dieser Buchregel.` });
  });
  return hits;
}

function collectGrammarForms(value, key, forms) {
  if (typeof value === "string") {
    if (["esse", "posse", "ire", "latein", "formen"].includes(key)) {
      tokenizeLatinText(value).forEach(token => forms.add(token.normalized));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectGrammarForms(item, key, forms));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([childKey, childValue]) => collectGrammarForms(childValue, childKey, forms));
}

function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function commonPrefixLength(left, right) {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
  return length;
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}
