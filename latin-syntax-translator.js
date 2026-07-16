/**
 * Small, deterministic Latin → German surface realiser.
 *
 * It consumes the token matches produced by `learning-engine.js`.  Dictionary
 * lookup and OCR correction deliberately stay outside this module; this file
 * turns their lexical and morphological result into German clauses.  No model,
 * network request or browser API is used here.
 */

const RESOLVED = new Set(["exact", "book-form", "fallback", "contextual", "proper", "corrected", "ambiguous"]);
const SOURCE_PRIORITY = { book: 50, glossary: 40, "proper-context": 35, fallback: 30, proper: 20 };
const FINITE_MOODS = new Set(["indicative", "subjunctive", "imperative"]);

const COORDINATORS = {
  et: "und",
  atque: "und",
  ac: "und",
  sed: "aber",
  at: "aber",
  autem: "aber",
  aut: "oder",
  vel: "oder",
  nam: "denn"
};

const SUBORDINATORS = {
  cum: "als",
  dum: "während",
  postquam: "nachdem",
  quia: "weil",
  quoniam: "weil",
  quod: "weil",
  si: "wenn",
  nisi: "wenn nicht",
  ut: "dass",
  ne: "damit nicht"
};

const PREPOSITIONS = {
  a: { german: "von", grammaticalCase: "dative" },
  ab: { german: "von", grammaticalCase: "dative" },
  ad: { german: "zu", grammaticalCase: "dative" },
  ante: { german: "vor", grammaticalCase: "dative" },
  apud: { german: "bei", grammaticalCase: "dative" },
  contra: { german: "gegen", grammaticalCase: "accusative" },
  cum: { german: "mit", grammaticalCase: "dative" },
  de: { german: "von", grammaticalCase: "dative" },
  e: { german: "aus", grammaticalCase: "dative" },
  ex: { german: "aus", grammaticalCase: "dative" },
  in: { german: "in", grammaticalCase: null },
  inter: { german: "zwischen", grammaticalCase: "accusative" },
  ob: { german: "wegen", grammaticalCase: "genitive" },
  per: { german: "durch", grammaticalCase: "accusative" },
  post: { german: "nach", grammaticalCase: "dative" },
  pro: { german: "für", grammaticalCase: "accusative" },
  propter: { german: "wegen", grammaticalCase: "genitive" },
  sine: { german: "ohne", grammaticalCase: "accusative" },
  sub: { german: "unter", grammaticalCase: null },
  super: { german: "über", grammaticalCase: "accusative" },
  trans: { german: "über", grammaticalCase: "accusative" }
};

const PRONOUNS = {
  ego: { nominative: "ich", accusative: "mich", dative: "mir" },
  tu: { nominative: "du", accusative: "dich", dative: "dir" },
  nos: { nominative: "wir", accusative: "uns", dative: "uns" },
  vos: { nominative: "ihr", accusative: "euch", dative: "euch" },
  se: { accusative: "sich", dative: "sich" },
  sui: { genitive: "seiner" },
  sibi: { dative: "sich" },
  me: { accusative: "mich", dative: "mir" },
  te: { accusative: "dich", dative: "dir" }
};

const IRREGULAR_PRESENT = {
  sein: [["bin", "bist", "ist"], ["sind", "seid", "sind"]],
  haben: [["habe", "hast", "hat"], ["haben", "habt", "haben"]],
  werden: [["werde", "wirst", "wird"], ["werden", "werdet", "werden"]],
  wollen: [["will", "willst", "will"], ["wollen", "wollt", "wollen"]],
  können: [["kann", "kannst", "kann"], ["können", "könnt", "können"]],
  müssen: [["muss", "musst", "muss"], ["müssen", "müsst", "müssen"]],
  mögen: [["mag", "magst", "mag"], ["mögen", "mögt", "mögen"]],
  dürfen: [["darf", "darfst", "darf"], ["dürfen", "dürft", "dürfen"]],
  sollen: [["soll", "sollst", "soll"], ["sollen", "sollt", "sollen"]],
  wissen: [["weiß", "weißt", "weiß"], ["wissen", "wisst", "wissen"]],
  gehen: [["gehe", "gehst", "geht"], ["gehen", "geht", "gehen"]],
  laufen: [["laufe", "läufst", "läuft"], ["laufen", "lauft", "laufen"]],
  sehen: [["sehe", "siehst", "sieht"], ["sehen", "seht", "sehen"]],
  geben: [["gebe", "gibst", "gibt"], ["geben", "gebt", "geben"]],
  nehmen: [["nehme", "nimmst", "nimmt"], ["nehmen", "nehmt", "nehmen"]],
  sprechen: [["spreche", "sprichst", "spricht"], ["sprechen", "sprecht", "sprechen"]],
  lesen: [["lese", "liest", "liest"], ["lesen", "lest", "lesen"]]
};

const IRREGULAR_PAST = {
  sein: [["war", "warst", "war"], ["waren", "wart", "waren"]],
  haben: [["hatte", "hattest", "hatte"], ["hatten", "hattet", "hatten"]],
  werden: [["wurde", "wurdest", "wurde"], ["wurden", "wurdet", "wurden"]],
  kommen: [["kam", "kamst", "kam"], ["kamen", "kamt", "kamen"]],
  gehen: [["ging", "gingst", "ging"], ["gingen", "gingt", "gingen"]],
  sehen: [["sah", "sahst", "sah"], ["sahen", "saht", "sahen"]],
  geben: [["gab", "gabst", "gab"], ["gaben", "gabt", "gaben"]],
  nehmen: [["nahm", "nahmst", "nahm"], ["nahmen", "nahmt", "nahmen"]],
  wissen: [["wusste", "wusstest", "wusste"], ["wussten", "wusstet", "wussten"]],
  wollen: [["wollte", "wolltest", "wollte"], ["wollten", "wolltet", "wollten"]],
  können: [["konnte", "konntest", "konnte"], ["konnten", "konntet", "konnten"]],
  müssen: [["musste", "musstest", "musste"], ["mussten", "musstet", "mussten"]],
  dürfen: [["durfte", "durftest", "durfte"], ["durften", "durftet", "durften"]],
  sollen: [["sollte", "solltest", "sollte"], ["sollten", "solltet", "sollten"]],
  tun: [["tat", "tatest", "tat"], ["taten", "tatet", "taten"]],
  bringen: [["brachte", "brachtest", "brachte"], ["brachten", "brachtet", "brachten"]],
  finden: [["fand", "fandest", "fand"], ["fanden", "fandet", "fanden"]],
  sprechen: [["sprach", "sprachst", "sprach"], ["sprachen", "spracht", "sprachen"]],
  schreiben: [["schrieb", "schriebst", "schrieb"], ["schrieben", "schriebt", "schrieben"]],
  lesen: [["las", "last", "las"], ["lasen", "last", "lasen"]],
  rufen: [["rief", "riefst", "rief"], ["riefen", "rieft", "riefen"]],
  hinüberbringen: [["brachte hinüber", "brachtest hinüber", "brachte hinüber"], ["brachten hinüber", "brachtet hinüber", "brachten hinüber"]],
  laufen: [["lief", "liefst", "lief"], ["liefen", "lieft", "liefen"]]
};

const KNOWN_PLURALS = {
  "das kind": "die Kinder",
  "der mann": "die Männer",
  "die frau": "die Frauen",
  "das mädchen": "die Mädchen",
  "der sklave": "die Sklaven",
  "die sklavin": "die Sklavinnen",
  "der begleiter": "die Begleiter",
  "die sirene": "die Sirenen",
  "die gefahr": "die Gefahren",
  "der freund": "die Freunde",
  "der feind": "die Feinde",
  "der soldat": "die Soldaten",
  "der gott": "die Götter",
  "der sohn": "die Söhne",
  "die tochter": "die Töchter"
};

const SUBSTANTIVIZED_ADJECTIVES = {
  romanus: "der Römer",
  graecus: "der Grieche",
  troianus: "der Trojaner"
};

const KNOWN_ARTICLES = {
  buch: "das",
  mädchen: "das",
  zentaur: "der"
};

const PROPER_GERMAN_NAMES = {
  gallia: "Gallien"
};

const KNOWN_PERFECT_FORMS = {
  dedit: "do",
  veni: "venire",
  vici: "vincere",
  vidi: "video"
};

/**
 * Selects one sense without discarding the alternatives.  Book vocabulary is
 * always preferred; a glossary can only win if no book entry exists, and the
 * bundled fallback dictionary is used only after both.
 */
export function selectPreferredLexeme(entries = [], morphology = {}) {
  const compatible = entries.filter(entry => partMatches(entry?.pos, morphology?.part));
  const pool = compatible.length ? compatible : entries;
  return [...pool].sort((left, right) => lexicalScore(right, morphology) - lexicalScore(left, morphology))[0] || null;
}

/**
 * Translate one already analysed Latin sentence.
 *
 * The returned text is intentionally useful even when a word is missing.  In
 * that case the uncertain Latin form remains in square brackets and
 * `reliable` is false instead of silently inventing a meaning.
 */
export function translateLatinSyntax(matches = [], options = {}) {
  const words = matches.flatMap((match, matchIndex) => expandMatch(match, matchIndex));
  if (!words.length) return { text: "", reliable: false, confidence: 0, unresolved: [], diagnostics: ["empty"] };

  augmentMorphologyCandidates(words);
  chooseContextualMorphology(words);
  const unresolved = words.filter(word => !word.entry || !RESOLVED.has(word.status)).map(word => word.token);
  const diagnostics = [];
  if (unresolved.length) diagnostics.push("unresolved-lexeme");
  const rendered = renderSentence(words, { ...options, diagnostics });
  if (!rendered) diagnostics.push("syntax-incomplete");
  assessSyntaxReliability(words, diagnostics, rendered);
  const resolvedRatio = (words.length - unresolved.length) / Math.max(words.length, 1);
  const syntaxPenalty = diagnostics.some(diagnostic => diagnostic !== "unresolved-lexeme") ? .25 : 0;
  const confidence = Math.max(0, Math.min(1, resolvedRatio - syntaxPenalty));

  return {
    text: finishSentence(rendered || lexicalDraft(words)),
    reliable: unresolved.length === 0 && diagnostics.length === 0,
    confidence,
    unresolved,
    diagnostics: [...new Set(diagnostics)],
    lexicalSources: words.filter(word => word.entry).map(word => ({ token: word.token, lemma: word.entry.lemma || word.entry.latein, source: word.entry.source || "fallback" }))
  };
}

/** Translate several analysed sentences while keeping per-sentence evidence. */
export function translateLatinPassage(lines = [], options = {}) {
  const results = lines.map(line => translateLatinSyntax(Array.isArray(line) ? line : line.matches || [], options));
  return {
    text: results.map(result => result.text).filter(Boolean).join("\n"),
    reliable: results.length > 0 && results.every(result => result.reliable),
    confidence: results.length ? results.reduce((sum, result) => sum + result.confidence, 0) / results.length : 0,
    sentences: results
  };
}

function expandMatch(match, matchIndex) {
  const tokenParts = String(match?.token || "").split(/\s+/).filter(Boolean);
  if (tokenParts.length <= 1) return [wordRecord(match, matchIndex, 0, match?.token || "")];
  return tokenParts.map((token, partIndex) => wordRecord(match, matchIndex, partIndex, token));
}

function wordRecord(match, matchIndex, partIndex, token) {
  const morphologies = Array.isArray(match?.morphology) ? match.morphology.filter(Boolean) : [];
  const morphologyCandidates = Array.isArray(match?.morphologyCandidates)
    ? match.morphologyCandidates.filter(candidate => candidate?.morphology)
    : morphologies.map(morphology => ({ entry: null, morphology }));
  const provisional = morphologies[0] || {};
  const entry = selectPreferredLexeme(match?.entries || [], provisional);
  return {
    token,
    normalized: normalizeLatin(token),
    status: match?.status || "unknown",
    entries: match?.entries || [],
    entry,
    morphologies,
    morphologyCandidates,
    morphology: provisional,
    matchIndex,
    partIndex,
    used: false
  };
}

function augmentMorphologyCandidates(words) {
  for (const word of words) {
    const inferred = inferPrincipalPartMorphology(word);
    if (!inferred) continue;
    const key = JSON.stringify(inferred.morphology);
    if (!word.morphologyCandidates.some(candidate => JSON.stringify(candidate.morphology) === key && candidate.entry === inferred.entry)) {
      word.morphologyCandidates.push(inferred);
      word.morphologies.push(inferred.morphology);
    }
  }
}

function inferPrincipalPartMorphology(word) {
  if (word.morphologies.some(morphology => morphology.part === "v" && FINITE_MOODS.has(morphology.mood) && morphology.person)) return null;
  for (const entry of word.entries) {
    if (entry?.pos !== "v") continue;
    const principalParts = String(entry.grammatik || "").split(",").map(part => normalizeLatin(part)).filter(Boolean);
    if (principalParts[1] !== word.normalized) continue;
    return {
      entry,
      morphology: { part: "v", person: 1, number: "singular", tense: "perfect", voice: "active", mood: "indicative", inferred: "principal-part" }
    };
  }
  return null;
}

function chooseContextualMorphology(words) {
  const finiteCandidates = words.flatMap((word, index) => {
    const candidate = word.morphologyCandidates
      .filter(item => item.morphology.part === "v" && FINITE_MOODS.has(item.morphology.mood) && item.morphology.person)
      .sort((left, right) => finiteCandidateStrength(word, right.morphology, right.entry) - finiteCandidateStrength(word, left.morphology, left.entry))[0];
    return candidate ? [{ index, morphology: candidate.morphology, entry: candidate.entry, strength: finiteCandidateStrength(word, candidate.morphology, candidate.entry) }] : [];
  });
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const finiteContext = nearestFiniteContext(finiteCandidates, index);
    const finiteIndex = finiteContext?.index ?? -1;
    const finiteMorphology = finiteContext?.morphology || null;
    if (!word.morphologies.length) {
      word.morphology = inferredMorphology(word);
      word.entry = selectPreferredLexeme(word.entries, word.morphology);
      continue;
    }
    const previous = words[index - 1];
    const precedingPreposition = PREPOSITIONS[previous?.normalized];
    const governedCase = precedingPreposition?.grammaticalCase || (precedingPreposition ? "prepositional" : null);
    const candidates = word.morphologyCandidates.length
      ? word.morphologyCandidates
      : word.morphologies.map(morphology => ({ entry: null, morphology }));
    const selected = [...candidates].sort((left, right) => (
      morphologyCandidateScore(right, word, index, finiteIndex, finiteMorphology, governedCase, words)
      - morphologyCandidateScore(left, word, index, finiteIndex, finiteMorphology, governedCase, words)
    ))[0];
    word.morphology = selected.morphology;
    word.entry = selected.entry || selectPreferredLexeme(word.entries, word.morphology);
    word.morphology = enrichMorphology(word, index, finiteIndex, finiteMorphology, governedCase, words);
  }
}

function finiteCandidateStrength(word, morphology, entry = null) {
  const verbEntries = word.entries.filter(entry => entry?.pos === "v").length;
  const knownFinite = new Set(["sum", "es", "est", "sumus", "estis", "sunt", "eram", "eras", "erat", "eramus", "eratis", "erant"]);
  let score = verbEntries && verbEntries === word.entries.length ? 4 : verbEntries ? 1 : 0;
  if (knownFinite.has(word.normalized)) score += 5;
  if (morphology.mood === "indicative" || morphology.mood === "subjunctive") score += 2;
  if (KNOWN_PERFECT_FORMS[word.normalized] === normalizeLatin(entry?.lemma || entry?.latein) && morphology.tense === "perfect") score += 20;
  if (morphology.inferred === "principal-part") score += 4;
  return score;
}

function morphologyCandidateScore(candidate, word, index, finiteIndex, finiteMorphology, governedCase, words) {
  const morphology = candidate.morphology;
  let score = morphologyScore(morphology, word, index, finiteIndex, finiteMorphology, governedCase, words);
  if (candidate.entry) score += (SOURCE_PRIORITY[candidate.entry.source] || 0) / 10;
  if (KNOWN_PERFECT_FORMS[word.normalized] === normalizeLatin(candidate.entry?.lemma || candidate.entry?.latein) && morphology.tense === "perfect") score += 30;
  if (morphology.inferred === "principal-part") score += 6;
  return score;
}

function nearestFiniteContext(candidates, index) {
  const toRight = candidates.filter(candidate => candidate.index >= index).sort((left, right) => left.index - right.index);
  const self = toRight.find(candidate => candidate.index === index);
  const strongerRight = toRight.find(candidate => candidate.index > index && candidate.strength > (self?.strength || 0));
  if (self && !strongerRight) return self;
  return strongerRight || toRight[0] || [...candidates].sort((left, right) => Math.abs(left.index - index) - Math.abs(right.index - index))[0] || null;
}

function morphologyScore(morphology, word, index, finiteIndex, finiteMorphology, governedCase, words) {
  let score = partMatches(word.entry?.pos, morphology.part) ? 4 : 0;
  if (morphology.part === "v" && FINITE_MOODS.has(morphology.mood) && morphology.person) score += index === finiteIndex ? 14 : -12;
  if (morphology.citation && !morphology.case && !morphology.mood) score -= 2;
  if (morphology.case) score += 1;
  if (["m", "f", "n"].includes(morphology.gender)) score += 1;
  if (governedCase === "prepositional" && (caseIncludes(morphology, "accusative") || caseIncludes(morphology, "ablative"))) score += 20;
  else if (governedCase && caseIncludes(morphology, governedCase)) score += 20;
  if (isNominalPart(morphology.part)) {
    const agreesWithFinite = !morphology.number || !finiteMorphology?.number || morphology.number === finiteMorphology.number;
    if (finiteIndex >= 0 && index < finiteIndex && caseIncludes(morphology, "nominative") && agreesWithFinite) score += 7;
    const earlierSubject = words.slice(0, index).some(candidate => candidate.morphologies.some(item => isNominalPart(item.part) && caseIncludes(item, "nominative")));
    if (earlierSubject && caseIncludes(morphology, "accusative")) score += 3;
  }
  if (morphology.part === "adj" && /^\p{Lu}/u.test(word.token) && finiteIndex >= 0 && index < finiteIndex && caseIncludes(morphology, "nominative") && (!morphology.number || morphology.number === finiteMorphology?.number)) score += 9;
  if (morphology.part === "adj") {
    const agreeingNoun = words.some((candidate, candidateIndex) => {
      if (candidate === word || Math.abs(candidateIndex - index) > 3 || !isNominal(candidate)) return false;
      const nominalMorphology = candidate.morphology || candidate.morphologies.find(item => isNominalPart(item.part) && item.case);
      if (!nominalMorphology?.case || !morphology.case) return false;
      const sameCase = firstCase(nominalMorphology) === firstCase(morphology);
      const sameNumber = !nominalMorphology.number || !morphology.number || nominalMorphology.number === morphology.number;
      const sameGender = !nominalMorphology.gender || !morphology.gender || morphology.gender === "c" || morphology.gender === "x" || nominalMorphology.gender === morphology.gender;
      return sameCase && sameNumber && sameGender;
    });
    if (agreeingNoun) score += 12;
  }
  return score;
}

function enrichMorphology(word, index, finiteIndex, finiteMorphology, governedCase, words) {
  const morphology = { ...(word.morphology || {}) };
  if (PRONOUNS[word.normalized] && !morphology.case) {
    morphology.part = "pron";
    morphology.case = PRONOUNS[word.normalized].accusative ? "accusative" : PRONOUNS[word.normalized].dative ? "dative" : "nominative";
  }
  const part = morphology.part || word.entry?.pos;
  if (governedCase === "prepositional" && !morphology.case) morphology.case = "ablative";
  if (isNominalPart(part) && !morphology.case) {
    const grammar = String(word.entry?.grammatik || "");
    if (/\bPl\./i.test(grammar) || /^die\s+/i.test(cleanMeaning(word.entry)) && finiteMorphology?.number === "plural") {
      morphology.case = "nominative";
      morphology.number = "plural";
    } else if (isProper(word) && /um$/i.test(word.normalized)) {
      morphology.case = "accusative";
      morphology.number ||= "singular";
    } else if (finiteIndex >= 0 && index < finiteIndex) {
      morphology.case = "nominative";
      morphology.number ||= finiteMorphology?.number;
    }
  }
  const thirdDeclensionPlural = isNominalPart(part) && /es$/i.test(word.normalized) && /is$/i.test(normalizeLatin(word.entry?.lemma || word.entry?.latein));
  if (thirdDeclensionPlural && finiteIndex >= 0 && index < finiteIndex && finiteMorphology?.number === "plural") {
    morphology.case = "nominative/accusative";
    morphology.number = "plural";
  }
  if (String(morphology.case).includes("nominative") && String(morphology.case).includes("accusative")) {
    const earlierAgreementSubject = words.slice(0, index).some(candidate => candidate.morphologies.some(item => caseIncludes(item, "nominative") && (!finiteMorphology?.number || item.number === finiteMorphology.number)));
    if (earlierAgreementSubject && morphology.number !== finiteMorphology?.number) morphology.case = "accusative";
  }
  const nearbyReflexive = words.slice(Math.max(0, index - 2), index).some(candidate => candidate.normalized === "se");
  const followingRiverName = words[index + 1] && /um$/i.test(words[index + 1].normalized) && isProper(words[index + 1]);
  if (word.normalized === "flumen" && nearbyReflexive && followingRiverName) morphology.case = "accusative";
  return morphology;
}

function isNominalPart(part) {
  return ["n", "pron", "proper"].includes(part);
}

function inferredMorphology(word) {
  const pos = word.entry?.pos || lexicalPart(word.normalized);
  if (pos === "v") return { part: "v" };
  if (pos === "n" || pos === "proper") return { part: pos };
  return { part: pos || "x" };
}

function renderSentence(words, context) {
  words = [...words];
  const leading = [];
  while (["itaque", "igitur", "ergo", "tamen"].includes(words[0]?.normalized)) {
    const word = words.shift();
    leading.push(({ itaque: "deshalb", igitur: "also", ergo: "daher", tamen: "dennoch" })[word.normalized]);
  }

  const subordinate = renderSubordinateStructure(words, context);
  const asyndetic = subordinate ? "" : renderAsyndeticPerfectSeries(words);
  const body = subordinate || asyndetic || renderCoordinatedClause(words, context);
  if (!body) return "";
  return [leading.length ? `${capitalize(leading.join(" "))},` : "", body].filter(Boolean).join(" ");
}

function assessSyntaxReliability(words, diagnostics, rendered) {
  if (!rendered) return;
  const finiteWords = words.filter(isFinite);
  const hasAblativeAbsolute = words.some(word => partOf(word) === "ppa" && caseIncludes(word.morphology, "ablative"))
    && words.some(word => isNominal(word) && caseIncludes(word.morphology, "ablative"));
  if (!finiteWords.length && !hasAblativeAbsolute) diagnostics.push("syntax-incomplete");

  const uncertainVerb = words.some(word => {
    if (!word.entries.some(entry => entry?.pos === "v")) return false;
    return !isFinite(word) && !isInfinitive(word) && partOf(word) !== "ppa";
  });
  const uncertainNominal = words.some(word => isNominal(word) && !firstCase(word.morphology));
  const unknownPart = words.some(word => partOf(word) === "x" && !isStructural(word));
  if (uncertainVerb || uncertainNominal || unknownPart) diagnostics.push("uncertain-morphology");

  const finiteWordsUsedByPassive = words.some(word => partOf(word) === "ppa" && word.morphology?.tense === "perfect" && word.morphology?.voice === "passive")
    && words.some(isEsse);
  const unsupportedParticiple = words.some(word => partOf(word) === "ppa") && !hasAblativeAbsolute && !finiteWordsUsedByPassive;
  const unsupportedInfinitiveClause = words.some(word => isInfinitive(word) && (word.morphology?.tense && word.morphology.tense !== "present" || words.some(candidate => ["se", "sese"].includes(candidate.normalized))));
  const unsupportedProhibition = words.some(word => word.normalized === "ne") && finiteWords.length <= 1;
  if (unsupportedParticiple || unsupportedInfinitiveClause || unsupportedProhibition) diagnostics.push("unsupported-construction");

  if (finiteWords.length > 1 && !hasFiniteClauseLink(words) && !isAsyndeticPerfectSeries(words)) {
    diagnostics.push("unsupported-clause-structure");
  }
}

function hasFiniteClauseLink(words) {
  return words.some((word, index) => {
    if (!COORDINATORS[word.normalized] && !SUBORDINATORS[word.normalized]) return false;
    return words.slice(0, index).some(isFinite) && words.slice(index + 1).some(isFinite)
      || index === 0 && SUBORDINATORS[word.normalized] && words.slice(1).filter(isFinite).length >= 2;
  });
}

function renderAsyndeticPerfectSeries(words) {
  if (!isAsyndeticPerfectSeries(words)) return "";
  const finiteWords = words.filter(isFinite);
  const agreement = verbAgreement(finiteWords[0], null);
  const subjectWords = collectSubjectWords(words, words.indexOf(finiteWords[0]), agreement);
  const subject = subjectWords.length ? renderSubjectPhrase(words, subjectWords) : implicitSubject(agreement);
  const predicates = finiteWords.map(word => {
    word.used = true;
    return conjugate(contextualGermanInfinitive(word, words), agreement, "imperfect");
  });
  return [subject, joinPredicates(predicates)].filter(Boolean).join(" ");
}

function isAsyndeticPerfectSeries(words) {
  const finiteWords = words.filter(isFinite);
  if (finiteWords.length < 2 || finiteWords.some(word => word.morphology.tense !== "perfect")) return false;
  if (words.some(word => COORDINATORS[word.normalized] || SUBORDINATORS[word.normalized])) return false;
  const agreement = verbAgreement(finiteWords[0], null);
  if (finiteWords.some(word => word.morphology.person !== agreement.person || word.morphology.number !== agreement.number)) return false;
  return words.every(word => isFinite(word) || isNominal(word) && caseIncludes(word.morphology, "nominative"));
}

function joinPredicates(items) {
  if (items.length <= 1) return items[0] || "";
  return `${items.slice(0, -1).join(", ")} und ${items.at(-1)}`;
}

function renderSubordinateStructure(words, context) {
  const markerIndex = words.findIndex((word, index) => SUBORDINATORS[word.normalized] && !(word.normalized === "cum" && isPrepositionalCum(words, index)));
  if (markerIndex < 0) return "";
  const finiteIndexes = words.map((word, index) => isFinite(word) ? index : -1).filter(index => index >= 0);
  if (finiteIndexes.length < 2) return "";

  if (markerIndex === 0) {
    const firstFinite = finiteIndexes[0];
    const boundary = Math.min(firstFinite + 1, words.length);
    const dependent = words.slice(1, boundary);
    const main = words.slice(boundary);
    if (!main.some(isFinite)) return "";
    const conjunction = contextualSubordinator(words[0], dependent);
    const dependentText = renderSimpleClause(dependent, { ...context, subordinate: true });
    const mainText = renderCoordinatedClause(main, { ...context, inverted: true });
    return dependentText && mainText ? `${capitalize(conjunction)} ${lowerFirst(dependentText)}, ${lowerFirst(mainText)}` : "";
  }

  if (finiteIndexes.some(index => index < markerIndex) && finiteIndexes.some(index => index > markerIndex)) {
    const mainText = renderCoordinatedClause(words.slice(0, markerIndex), context);
    const conjunction = contextualSubordinator(words[markerIndex], words.slice(markerIndex + 1));
    const dependentText = renderSimpleClause(words.slice(markerIndex + 1), { ...context, subordinate: true });
    return mainText && dependentText ? `${mainText}, ${conjunction} ${lowerFirst(dependentText)}` : "";
  }
  return "";
}

function renderCoordinatedClause(words, context = {}) {
  const splitIndex = words.findIndex((word, index) => {
    if (!COORDINATORS[word.normalized]) return false;
    return words.slice(0, index).some(isFinite) && words.slice(index + 1).some(isFinite);
  });
  if (splitIndex < 0) return renderSimpleClause(words, context);

  const leftWords = words.slice(0, splitIndex);
  const rightWords = words.slice(splitIndex + 1);
  const leftSubject = subjectAgreement(leftWords);
  const left = renderSimpleClause(leftWords, context);
  const right = renderCoordinatedClause(rightWords, { ...context, inheritedSubject: leftSubject, omitInheritedSubject: true });
  let conjunction = COORDINATORS[words[splitIndex].normalized];
  if (["sed", "at", "autem"].includes(words[splitIndex].normalized) && leftWords.some(word => word.normalized === "non")) conjunction = "sondern";
  return left && right ? `${left}, ${conjunction} ${lowerFirst(right)}` : left || right;
}

function renderSimpleClause(words, context = {}) {
  if (!words.length) return "";
  const ablativeAbsolute = renderAblativeAbsolute(words, context);
  if (ablativeAbsolute) return ablativeAbsolute;

  const finiteIndex = words.findIndex(isFinite);
  if (finiteIndex < 0) {
    context.diagnostics?.push("syntax-incomplete");
    return lexicalDraft(words);
  }

  const finite = words[finiteIndex];
  finite.used = true;
  const agreement = verbAgreement(finite, context.inheritedSubject);
  const subjectWords = collectSubjectWords(words, finiteIndex, agreement);
  const subject = subjectWords.length
    ? renderSubjectPhrase(words, subjectWords)
    : context.omitInheritedSubject ? "" : implicitSubject(agreement);
  const perfectPassive = words.find(word => word !== finite && partOf(word) === "ppa" && word.morphology?.tense === "perfect" && word.morphology?.voice === "passive" && isEsse(finite));
  if (perfectPassive) perfectPassive.used = true;
  const verb = perfectPassive ? renderPerfectPassive(perfectPassive, finite, agreement, words) : renderFiniteVerb(finite, agreement, words);
  const infinitives = words.filter((word, index) => index !== finiteIndex && isInfinitive(word));
  infinitives.forEach(word => { word.used = true; });

  const prepositional = renderPrepositionalPhrases(words);
  const datives = collectCaseWords(words, "dative").map(word => renderNominal(words, word, "dative"));
  const transferAcrossRiver = ["transfero", "transferre"].includes(normalizeLatin(finite.entry?.lemma || finite.entry?.latein));
  const accusatives = collectCaseWords(words, "accusative").map(word => transferAcrossRiver && word.normalized === "flumen" ? `über ${renderNominal(words, word, "accusative")}` : renderNominal(words, word, "accusative"));
  const genitives = collectCaseWords(words, "genitive").map(word => renderNominal(words, word, "genitive"));
  const adverbs = words.filter(word => !word.used && isAdverb(word) && !isNegation(word)).map(word => {
    word.used = true;
    return renderAdverb(word);
  });
  const predicateAdjectives = words.filter(word => !word.used && partOf(word) === "adj").map(word => {
    word.used = true;
    return cleanMeaning(word.entry);
  });
  const negated = words.some(isNegation);
  words.filter(isNegation).forEach(word => { word.used = true; });
  const remaining = words.filter(word => !word.used && !isStructural(word)).map(renderLexeme).filter(Boolean);

  const complements = [...adverbs, ...datives, ...accusatives, ...genitives, ...prepositional, ...predicateAdjectives, ...remaining].filter(Boolean);
  const infinitiveText = infinitives.map(word => germanInfinitive(word.entry)).filter(Boolean).join(" und ");
  const negation = negated ? "nicht" : "";
  const verbParts = splitGermanVerbPhrase(verb);

  if (context.subordinate) {
    const ending = verbParts.separable && verbParts.tail ? `${verbParts.tail}${verbParts.head}` : [verbParts.tail, verbParts.head].filter(Boolean).join(" ");
    return [subject, verbParts.middle, ...complements, negation, infinitiveText, ending].filter(Boolean).join(" ");
  }
  if (context.inverted) {
    return [verbParts.head, subject, verbParts.middle, ...complements, negation, infinitiveText, verbParts.tail].filter(Boolean).join(" ");
  }
  return [subject, verbParts.head, verbParts.middle, ...complements, negation, infinitiveText, verbParts.tail].filter(Boolean).join(" ");
}

function splitGermanVerbPhrase(value) {
  const parts = String(value || "").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { head: parts[0] || "", middle: "", tail: "", separable: false };
  const reflexiveIndex = parts.findIndex((part, index) => index > 0 && ["mich", "dich", "sich", "uns", "euch"].includes(part));
  if (reflexiveIndex >= 0) return { head: parts[0], middle: parts[reflexiveIndex], tail: parts.filter((_, index) => index !== 0 && index !== reflexiveIndex).join(" "), separable: false };
  const particle = parts.at(-1);
  if (["fort", "hinüber", "weiter", "zurück"].includes(particle)) return { head: parts.slice(0, -1).join(" "), middle: "", tail: particle, separable: true };
  const auxiliaries = new Set(["bin", "bist", "ist", "sind", "seid", "war", "warst", "waren", "wart", "habe", "hast", "hat", "haben", "habt", "hatte", "hattest", "hatten", "hattet", "werde", "wirst", "wird", "werden", "werdet", "wurde", "wurdest", "wurden", "wurdet"]);
  if (auxiliaries.has(parts[0])) return { head: parts[0], middle: "", tail: parts.slice(1).join(" "), separable: false };
  return { head: value, middle: "", tail: "", separable: false };
}

function renderAblativeAbsolute(words, context) {
  const participle = words.find(word => partOf(word) === "ppa" && caseIncludes(word.morphology, "ablative"));
  if (!participle) return "";
  const noun = words.find(word => word !== participle && isNominal(word) && caseIncludes(word.morphology, "ablative") && sameNumber(word, participle));
  if (!noun) return "";
  noun.used = true;
  participle.used = true;
  const perfect = participle.morphology.tense === "perfect" || participle.morphology.voice === "passive";
  const conjunction = perfect ? "Nachdem" : "Während";
  const subject = renderNominal(words, noun, "nominative");
  const agreement = { person: 3, number: participle.morphology.number || noun.morphology.number || "singular" };
  const participleVerb = contextualGermanInfinitive(participle, words);
  const verb = perfect ? `${conjugate("haben", agreement, "present")} ${pastParticiple(participleVerb)}` : conjugate(participleVerb, agreement, "present");
  const infinitive = words.find(word => !word.used && isInfinitive(word));
  let infinitiveComplement = "";
  if (infinitive) {
    infinitive.used = true;
    const object = words.find(word => !word.used && isNominal(word) && (caseIncludes(word.morphology, "accusative") || normalizeLatin(word.entry?.lemma || word.entry?.latein) === "iter"));
    const infinitiveLemma = normalizeLatin(infinitive.entry?.lemma || infinitive.entry?.latein);
    const renderedObject = object ? renderNominal(words, object, "accusative") : "";
    infinitiveComplement = [renderedObject, infinitiveLemma === "pergere" && renderedObject ? "fortsetzen" : contextualGermanInfinitive(infinitive, words)].filter(Boolean).join(" ");
  }
  const adverbWords = words.filter(word => !word.used && isAdverb(word));
  const repeatedAdverb = adverbWords.length >= 2 && adverbWords.every(word => /^iterum(?:que)?$/.test(word.normalized));
  const adverbs = repeatedAdverb ? ["immer wieder"] : adverbWords.map(renderAdverb);
  adverbWords.forEach(word => { word.used = true; });
  const remaining = words.filter(word => !word.used && !isStructural(word)).map(renderLexeme).filter(Boolean);
  return [conjunction, subject, ...adverbs, ...remaining, infinitiveComplement, verb].filter(Boolean).join(" ");
}

function renderPrepositionalPhrases(words) {
  const phrases = [];
  for (let index = 0; index < words.length; index += 1) {
    const preposition = PREPOSITIONS[words[index].normalized];
    if (!preposition || words[index].used || (words[index].normalized === "cum" && !isPrepositionalCum(words, index))) continue;
    const nounIndex = words.findIndex((word, candidateIndex) => candidateIndex > index && candidateIndex <= index + 4 && !word.used && isNominal(word));
    if (nounIndex < 0) continue;
    const noun = words[nounIndex];
    const latinCase = firstCase(noun.morphology);
    const germanCase = preposition.grammaticalCase || (latinCase === "accusative" ? "accusative" : "dative");
    words[index].used = true;
    const nounText = renderNominal(words, noun, germanCase);
    phrases.push(contractPreposition(`${preposition.german} ${nounText}`));
  }
  return phrases;
}

function renderNominal(words, noun, grammaticalCase) {
  noun.used = true;
  const nounIndex = words.indexOf(noun);
  const modifiers = words.filter((word, index) => {
    if (word.used || !["adj", "num"].includes(partOf(word)) || Math.abs(index - nounIndex) > 2) return false;
    return partOf(word) === "num" || !word.morphology.case || !noun.morphology.case || firstCase(word.morphology) === firstCase(noun.morphology);
  });
  modifiers.forEach(word => { word.used = true; });
  const core = renderNoun(noun, grammaticalCase);
  if (!modifiers.length) return core;
  if (isProper(noun)) return [...modifiers.map(word => germanModifier(word)), core].filter(Boolean).join(" ");
  const { article, nounText, gender, number } = dissectNounPhrase(core, noun);
  const numerals = modifiers.filter(word => partOf(word) === "num").map(germanModifier);
  const adjectives = modifiers.filter(word => partOf(word) === "adj");
  const effectiveArticle = numerals.length ? "" : article;
  const adjectiveText = adjectives.map(word => inflectAdjective(germanModifier(word), grammaticalCase, gender, number, Boolean(effectiveArticle))).join(" ");
  return [effectiveArticle, ...numerals, adjectiveText, nounText].filter(Boolean).join(" ");
}

function germanModifier(word) {
  const fixed = { omnis: "ganz", tres: "drei" };
  return fixed[word.normalized] || cleanMeaning(word.entry);
}

function renderNoun(word, grammaticalCase) {
  if (isProper(word)) return properName(word);
  const pronoun = renderPronoun(word, grammaticalCase);
  if (pronoun) return pronoun;
  const meaning = cleanMeaning(word.entry) || `[${word.token}]`;
  const number = word.morphology.number || "singular";
  if (number === "plural") return declinePlural(meaning, grammaticalCase);
  const phrase = ensureArticle(meaning, word);
  return declineArticle(phrase, grammaticalCase);
}

function renderPronoun(word, grammaticalCase) {
  const forms = PRONOUNS[word.normalized];
  if (forms?.[grammaticalCase]) return forms[grammaticalCase];
  if (word.entry?.pos !== "pron") return "";
  const meaning = cleanMeaning(word.entry);
  return meaning.split("/")[0].trim();
}

function renderFiniteVerb(word, agreement, words = []) {
  const infinitive = contextualGermanInfinitive(word, words);
  if (!infinitive) return `[${word.token}]`;
  const morphology = word.morphology || {};
  const tense = morphology.tense || "present";
  if (word.normalized === "dedit" && tense === "perfect") return conjugate("geben", agreement, "imperfect");
  if (morphology.voice === "passive") return `${conjugate("werden", agreement, tense === "present" ? "present" : "imperfect")} ${pastParticiple(infinitive)}`;
  if (tense === "perfect" || tense === "pluperfect") {
    const auxiliary = movementVerb(infinitive) ? "sein" : "haben";
    const auxiliaryTense = tense === "perfect" ? "present" : "imperfect";
    return `${conjugate(auxiliary, agreement, auxiliaryTense)} ${pastParticiple(infinitive)}`;
  }
  if (tense === "future" || tense === "future-perfect") return `${conjugate("werden", agreement, "present")} ${infinitive}`;
  return conjugate(infinitive, agreement, tense);
}

function renderPerfectPassive(participle, esse, agreement, words = []) {
  const germanParticiple = pastParticiple(contextualGermanInfinitive(participle, words));
  const tense = esse.morphology?.tense || "present";
  if (tense === "imperfect" || tense === "pluperfect") return `${conjugate("sein", agreement, "imperfect")} ${germanParticiple} worden`;
  if (tense === "future" || tense === "future-perfect") return `${conjugate("werden", agreement, "present")} ${germanParticiple} worden sein`;
  return `${conjugate("werden", agreement, "imperfect")} ${germanParticiple}`;
}

function conjugate(infinitive, agreement, tense = "present") {
  const verb = String(infinitive || "").trim();
  const reflexive = verb.startsWith("sich ");
  const base = reflexive ? verb.slice(5) : verb;
  const prefix = base.includes(" ") ? `${base.slice(0, base.lastIndexOf(" ") + 1)}` : "";
  const core = base.slice(prefix.length);
  const person = Math.min(3, Math.max(1, Number(agreement.person) || 3));
  const plural = agreement.number === "plural";
  const table = tense === "imperfect" ? IRREGULAR_PAST[core] : IRREGULAR_PRESENT[core];
  let form;
  if (table) form = table[plural ? 1 : 0][person - 1];
  else if (!/(?:en|n)$/.test(core)) form = core;
  else {
    const stem = core.endsWith("en") ? core.slice(0, -2) : core.slice(0, -1);
    if (tense === "imperfect") {
      const suffix = plural ? (person === 2 ? "tet" : "ten") : (person === 1 || person === 3 ? "te" : "test");
      form = stem + suffix;
    } else {
      const needsE = /[dt]$/.test(stem);
      const endings = plural
        ? ["en", needsE ? "et" : "t", "en"]
        : ["e", /[sxzß]$/.test(stem) ? "t" : needsE ? "est" : "st", needsE ? "et" : "t"];
      form = stem + endings[person - 1];
    }
  }
  const reflexivePronoun = reflexive ? ({ 1: plural ? "uns" : "mich", 2: plural ? "euch" : "dich", 3: "sich" })[person] : "";
  return [prefix + form, reflexivePronoun].filter(Boolean).join(" ");
}

function pastParticiple(infinitive) {
  const verb = String(infinitive || "").replace(/^sich\s+/, "");
  const irregular = {
    sein: "gewesen", haben: "gehabt", werden: "geworden", kommen: "gekommen", gehen: "gegangen", sehen: "gesehen",
    geben: "gegeben", nehmen: "genommen", finden: "gefunden", sprechen: "gesprochen", schreiben: "geschrieben",
    lesen: "gelesen", rufen: "gerufen", laufen: "gelaufen", bringen: "gebracht", wissen: "gewusst", bitten: "gebeten",
    helfen: "geholfen", treffen: "getroffen", tragen: "getragen", halten: "gehalten", lassen: "gelassen",
    hinüberbringen: "hinübergebracht"
  };
  if (irregular[verb]) return irregular[verb];
  if (verb.startsWith("be") || verb.startsWith("er") || verb.startsWith("ver") || verb.endsWith("ieren")) return verb.replace(/en$/, "t");
  const stem = verb.endsWith("en") ? verb.slice(0, -2) : verb.replace(/n$/, "");
  return `ge${stem}${/[dt]$/.test(stem) ? "et" : "t"}`;
}

function germanInfinitive(entry) {
  let meaning = cleanMeaning(entry);
  meaning = meaning
    .replace(/^(?:jdn\.?|jdm\.?|jemanden|jemandem|etwas)\s+/i, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
  const alternatives = meaning.split(/\s*[/,;]\s*/).filter(Boolean);
  return alternatives.find(value => /(?:en|n)$/.test(value)) || alternatives[0] || "";
}

function contextualGermanInfinitive(word, words = []) {
  const lemma = normalizeLatin(word.entry?.lemma || word.entry?.latein);
  if (word.normalized === "dedit") return "geben";
  if (lemma === "amo") return "lieben";
  if (["rogo", "rogare"].includes(lemma) && (words.some(candidate => candidate.normalized === "ut") || word.morphology?.voice === "passive" && words.some(candidate => candidate.normalized === "ab"))) return "bitten";
  if (["insto", "instare"].includes(lemma) && words.some(candidate => /Gefahr/i.test(cleanMeaning(candidate.entry)))) return "drohen";
  if (["transfero", "transferre"].includes(lemma) && words.some(candidate => candidate.normalized === "flumen")) return "bringen";
  return germanInfinitive(word.entry);
}

function renderAdverb(word) {
  const fixed = {
    etiam: "auch", iam: "schon", iterum: "wieder", iterumque: "wieder", nunc: "jetzt", saepe: "oft", semper: "immer",
    subito: "plötzlich", tum: "dann", tunc: "damals", valde: "sehr", quoque: "auch", longe: "weit"
  };
  return fixed[word.normalized] || cleanMeaning(word.entry);
}

function renderLexeme(word) {
  if (!word.entry || !RESOLVED.has(word.status)) return `[${word.token}]`;
  if (isNominal(word)) return renderNoun(word, firstCase(word.morphology) || "nominative");
  if (isAdverb(word)) return renderAdverb(word);
  return cleanMeaning(word.entry);
}

function lexicalDraft(words) {
  return words.map(word => {
    if (isStructural(word)) return structuralMeaning(word);
    return renderLexeme(word);
  }).filter(Boolean).join(" ");
}

function structuralMeaning(word) {
  return COORDINATORS[word.normalized] || SUBORDINATORS[word.normalized] || PREPOSITIONS[word.normalized]?.german || (isNegation(word) ? "nicht" : cleanMeaning(word.entry));
}

function collectCaseWords(words, grammaticalCase, excludedIndex = -1) {
  return words.filter((word, index) => {
    if (index === excludedIndex || word.used || !isNominal(word)) return false;
    if (!caseIncludes(word.morphology, grammaticalCase)) return false;
    word.used = true;
    return true;
  });
}

function collectSubjectWords(words, finiteIndex, agreement) {
  const candidates = words.filter((word, index) => index !== finiteIndex && !word.used && isSubjectCandidate(word) && caseIncludes(word.morphology, "nominative"));
  if (!candidates.length) return [];
  const agreeing = candidates.filter(word => !word.morphology.number || word.morphology.number === agreement.number);
  const chosen = agreeing[0] || candidates[0];
  const result = [chosen];
  const chosenIndex = words.indexOf(chosen);
  const apposition = candidates.find(candidate => {
    if (candidate === chosen || Math.abs(words.indexOf(candidate) - chosenIndex) > 2) return false;
    if (candidate.morphology.number && chosen.morphology.number && candidate.morphology.number !== chosen.morphology.number) return false;
    return isProper(chosen) !== isProper(candidate);
  });
  if (apposition) result.push(apposition);
  else if (agreement.number === "plural") {
    const coordinated = candidates.find(candidate => candidate !== chosen && words.slice(Math.min(chosenIndex, words.indexOf(candidate)) + 1, Math.max(chosenIndex, words.indexOf(candidate))).some(word => word.normalized === "et"));
    if (coordinated) result.push(coordinated);
  }
  return result;
}

function renderSubjectPhrase(words, subjectWords) {
  const rendered = subjectWords.map(word => isSubstantivizedAdjective(word) ? renderSubstantivizedAdjective(word) : renderNominal(words, word, "nominative"));
  if (subjectWords.length === 2 && isProper(subjectWords[0]) !== isProper(subjectWords[1])) return `${rendered[0]}, ${rendered[1]},`;
  return joinNominals(rendered);
}

function isSubjectCandidate(word) {
  return isNominal(word) || isSubstantivizedAdjective(word);
}

function isSubstantivizedAdjective(word) {
  return partOf(word) === "adj" && /^\p{Lu}/u.test(word.token) && caseIncludes(word.morphology, "nominative");
}

function renderSubstantivizedAdjective(word) {
  word.used = true;
  const lemma = normalizeLatin(word.entry?.lemma || word.entry?.latein);
  const noun = SUBSTANTIVIZED_ADJECTIVES[lemma];
  if (noun) return word.morphology.number === "plural" ? declinePlural(noun, "nominative") : noun;
  const adjective = cleanMeaning(word.entry).replace(/e[rmns]?$/i, "");
  return word.morphology.number === "plural" ? `die ${capitalize(adjective)}en` : `der ${capitalize(adjective)}e`;
}

function subjectAgreement(words) {
  const subjects = words.filter(word => isNominal(word) && caseIncludes(word.morphology, "nominative"));
  const finite = words.find(isFinite);
  const inherited = verbAgreement(finite || {}, null);
  return { ...inherited, number: subjects.length > 1 ? "plural" : subjects[0]?.morphology.number || inherited.number };
}

function verbAgreement(word, inherited) {
  return {
    person: Number(word?.morphology?.person) || inherited?.person || 3,
    number: word?.morphology?.number || inherited?.number || "singular"
  };
}

function implicitSubject(agreement) {
  const person = Number(agreement.person) || 3;
  const plural = agreement.number === "plural";
  return plural ? (["wir", "ihr", "sie"][person - 1] || "sie") : (["ich", "du", "er/sie"][person - 1] || "er/sie");
}

function contextualSubordinator(marker, dependent) {
  if (marker.normalized === "cum") {
    const finite = dependent.find(isFinite);
    if (finite?.morphology?.tense === "pluperfect" || finite?.morphology?.tense === "perfect") return "nachdem";
  }
  return SUBORDINATORS[marker.normalized] || cleanMeaning(marker.entry);
}

function isEsse(word) {
  const lemma = normalizeLatin(word.entry?.lemma || word.entry?.latein);
  return ["esse", "sum"].includes(lemma) || germanInfinitive(word.entry) === "sein";
}

function isPrepositionalCum(words, index) {
  const following = words.slice(index + 1, index + 4);
  return following.some(word => isNominal(word) && caseIncludes(word.morphology, "ablative"));
}

function isFinite(word) {
  return partOf(word) === "v" && FINITE_MOODS.has(word.morphology?.mood) && Boolean(word.morphology?.person);
}

function isInfinitive(word) {
  return partOf(word) === "v" && word.morphology?.mood === "infinitive";
}

function isNominal(word) {
  return ["n", "pron", "proper"].includes(partOf(word)) || isProper(word) || Boolean(PRONOUNS[word.normalized]);
}

function isProper(word) {
  return ["proper", "proper-context"].includes(word.entry?.source) || word.entry?.pos === "proper";
}

function isAdverb(word) {
  return partOf(word) === "adv" || word.entry?.pos === "adv" || ["etiam", "iam", "iterum", "iterumque", "nunc", "saepe", "semper", "subito", "tum", "tunc", "valde", "quoque"].includes(word.normalized);
}

function isNegation(word) {
  return ["haud", "non"].includes(word.normalized);
}

function isStructural(word) {
  return Boolean(COORDINATORS[word.normalized] || SUBORDINATORS[word.normalized] || PREPOSITIONS[word.normalized] || isNegation(word));
}

function partOf(word) {
  return word.morphology?.part === "ppa" ? "ppa" : word.morphology?.part || word.entry?.pos || lexicalPart(word.normalized);
}

function lexicalPart(token) {
  if (COORDINATORS[token] || SUBORDINATORS[token]) return "conj";
  if (PREPOSITIONS[token]) return "prep";
  if (PRONOUNS[token]) return "pron";
  return "x";
}

function partMatches(entryPart, morphologyPart) {
  if (!entryPart || entryPart === "x" || !morphologyPart) return true;
  if (morphologyPart === "ppa") return entryPart === "v" || entryPart === "ppa";
  if (entryPart === "proper") return morphologyPart === "n" || morphologyPart === "proper";
  return entryPart === morphologyPart;
}

function lexicalScore(entry, morphology) {
  return (SOURCE_PRIORITY[entry?.source] || 0) + (partMatches(entry?.pos, morphology?.part) ? 5 : 0);
}

function caseIncludes(morphology, grammaticalCase) {
  if (!grammaticalCase) return false;
  return String(morphology?.case || "").split("/").includes(grammaticalCase);
}

function firstCase(morphology) {
  return String(morphology?.case || "").split("/")[0] || "";
}

function sameNumber(left, right) {
  return !left.morphology.number || !right.morphology.number || left.morphology.number === right.morphology.number;
}

function properName(word) {
  const value = cleanMeaning(word.entry) || word.entry?.lemma || word.token;
  const localized = PROPER_GERMAN_NAMES[normalizeLatin(value)];
  if (localized) return localized;
  return value[0]?.toLocaleUpperCase("de") + value.slice(1);
}

function cleanMeaning(entry) {
  const raw = entry?.deutsch || entry?.meanings?.[0] || "";
  return String(raw).split(/[;,]/)[0].trim().replace(/^\([^)]*\)\s*/, "");
}

function ensureArticle(meaning, word) {
  if (/^(?:der|die|das|ein|eine)\s+/i.test(meaning)) return meaning;
  const noun = meaning.trim();
  const gender = word.morphology.gender;
  const known = KNOWN_ARTICLES[noun.toLocaleLowerCase("de")];
  const article = known || (gender === "f" ? "die" : gender === "n" ? "das" : gender === "m" ? "der" : inferArticle(noun, word));
  return `${article} ${noun}`;
}

function inferArticle(noun, word) {
  const lower = noun.toLocaleLowerCase("de");
  if (/(?:chen|lein)$/.test(lower)) return "das";
  if (/(?:ung|heit|keit|schaft|tät|ion|ik|ie|anz|enz|ur|ei|in)$/.test(lower) || normalizeLatin(word.entry?.lemma || word.entry?.latein).endsWith("a")) return "die";
  return "der";
}

function declineArticle(phrase, grammaticalCase) {
  const match = phrase.match(/^(der|die|das|ein|eine)\s+(.+)$/i);
  if (!match) return phrase;
  const article = match[1].toLocaleLowerCase("de");
  const noun = match[2];
  const gender = article === "der" || article === "ein" ? "m" : article === "die" || article === "eine" ? "f" : "n";
  const tables = {
    nominative: { m: article.startsWith("ein") ? "ein" : "der", f: article.startsWith("ein") ? "eine" : "die", n: article.startsWith("ein") ? "ein" : "das" },
    accusative: { m: article.startsWith("ein") ? "einen" : "den", f: article.startsWith("ein") ? "eine" : "die", n: article.startsWith("ein") ? "ein" : "das" },
    dative: { m: article.startsWith("ein") ? "einem" : "dem", f: article.startsWith("ein") ? "einer" : "der", n: article.startsWith("ein") ? "einem" : "dem" },
    genitive: { m: article.startsWith("ein") ? "eines" : "des", f: article.startsWith("ein") ? "einer" : "der", n: article.startsWith("ein") ? "eines" : "des" }
  };
  return `${tables[grammaticalCase]?.[gender] || article} ${noun}`;
}

function declinePlural(meaning, grammaticalCase) {
  const normalized = meaning.toLocaleLowerCase("de");
  let phrase = KNOWN_PLURALS[normalized];
  if (!phrase) {
    const noun = meaning.replace(/^(?:der|die|das|ein|eine)\s+/i, "");
    const plural = /(?:er|en|el|chen|lein)$/i.test(noun) ? noun : /e$/i.test(noun) ? `${noun}n` : `${noun}e`;
    phrase = `die ${plural}`;
  }
  if (grammaticalCase === "dative") return phrase.replace(/^die\s+/i, "den ").replace(/(?<!n)$/i, "n");
  if (grammaticalCase === "genitive") return phrase.replace(/^die\s+/i, "der ");
  return phrase;
}

function dissectNounPhrase(phrase, word) {
  const match = phrase.match(/^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+(.+)$/i);
  const article = match?.[1] || "";
  const nounText = match?.[2] || phrase;
  const number = word.morphology.number || "singular";
  const gender = number === "plural" ? "plural" : ["der", "den", "dem", "des", "ein", "einen", "einem", "eines"].includes(article.toLocaleLowerCase("de")) ? "m" : article.toLocaleLowerCase("de") === "das" ? "n" : "f";
  return { article, nounText, gender, number };
}

function inflectAdjective(value, grammaticalCase, gender, number, hasArticle) {
  const adjective = String(value).replace(/e[rmns]?$/i, "").trim();
  if (!adjective || !hasArticle) return value;
  if (number === "plural" || grammaticalCase === "dative" || grammaticalCase === "genitive") return `${adjective}en`;
  if (grammaticalCase === "accusative" && gender === "m") return `${adjective}en`;
  return `${adjective}e`;
}

function joinNominals(items) {
  const values = items.filter(Boolean);
  if (values.length <= 1) return values[0] || "";
  return `${values.slice(0, -1).join(", ")} und ${values.at(-1)}`;
}

function contractPreposition(value) {
  return String(value)
    .replace(/^zu dem\b/i, "zum")
    .replace(/^zu der\b/i, "zur")
    .replace(/^in dem\b/i, "im")
    .replace(/^an dem\b/i, "am")
    .replace(/^von dem\b/i, "vom")
    .replace(/^bei dem\b/i, "beim");
}

function movementVerb(value) {
  return ["fahren", "fliegen", "gehen", "kommen", "laufen", "reisen", "sterben", "wachsen"].includes(value);
}

function normalizeLatin(value) {
  return String(value || "")
    .normalize("NFD")
    .toLocaleLowerCase("la")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("j", "i")
    .replace(/[^a-z]/g, "");
}

function finishSentence(value) {
  const text = String(value || "").replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  if (!text) return "";
  const capitalized = capitalize(text);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function capitalize(value) {
  return value ? value[0].toLocaleUpperCase("de") + value.slice(1) : value;
}

function lowerFirst(value) {
  return value ? value[0].toLocaleLowerCase("de") + value.slice(1) : value;
}
