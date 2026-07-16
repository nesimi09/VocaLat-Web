const DEFAULT_PACK_SIZE = 8;
const REVIEW_LIMIT = 2;
const CURATED_QUESTION_COUNT = 3;
const MINIMUM_SKILL_SCORE = 60;

/**
 * Returns the usable textbook vocabulary assigned to one course module.
 * Lesson 7 is deliberately excluded because its source row is an unreadable
 * placeholder rather than a vocabulary entry.
 */
export function vocabularyForModule(vocabulary, module) {
  if (!Array.isArray(vocabulary)) return [];
  const lessons = new Set((module?.lessons || []).map(Number).filter(lesson => Number.isInteger(lesson) && lesson !== 7));

  return vocabulary.filter(entry => {
    const lesson = Number(entry?.lektion);
    return lessons.has(lesson)
      && lesson !== 7
      && Boolean(String(entry?.latein || "").trim())
      && Boolean(String(entry?.deutsch || "").trim())
      && !String(entry?.grammatik || "").toLocaleLowerCase("de").includes("unsicher");
  });
}

/** Splits a module's vocabulary into stable, book-ordered learning packs. */
export function vocabularyPacks(vocabulary, module, packSize = DEFAULT_PACK_SIZE) {
  if (!Number.isInteger(packSize) || packSize < 1) {
    throw new RangeError("packSize must be a positive integer");
  }

  const entries = vocabularyForModule(vocabulary, module);
  const packs = [];
  for (let index = 0; index < entries.length; index += packSize) {
    packs.push(entries.slice(index, index + packSize));
  }
  return packs;
}

/**
 * Builds one mixed learning round.
 *
 * The returned items expose both `new`/`review` and `isNew`/`isReview` so the
 * UI can use readable fields while remaining straightforward to serialize.
 */
export function buildCourseRound({
  module,
  pack = [],
  reviewVocabulary = [],
  moduleVocabulary = [],
  random = Math.random
} = {}) {
  if (!module || typeof module !== "object") throw new TypeError("module is required");
  if (!Array.isArray(pack)) throw new TypeError("pack must be an array");
  if (!Array.isArray(reviewVocabulary)) throw new TypeError("reviewVocabulary must be an array");
  if (!Array.isArray(moduleVocabulary)) throw new TypeError("moduleVocabulary must be an array");
  if (typeof random !== "function") throw new TypeError("random must be a function");

  const newVocabulary = uniqueVocabulary(pack);
  const newKeys = new Set(newVocabulary.map(vocabularyKey));
  const reviews = shuffle(
    uniqueVocabulary(reviewVocabulary).filter(entry => !newKeys.has(vocabularyKey(entry))),
    random
  ).slice(0, REVIEW_LIMIT);

  const vocabularyPool = uniqueVocabulary([...moduleVocabulary, ...newVocabulary, ...reviews]);
  const vocabularyItems = [
    ...newVocabulary.map((entry, index) => vocabularyQuestion(entry, vocabularyPool, index, true, false, random)),
    ...reviews.map((entry, index) => vocabularyQuestion(entry, vocabularyPool, newVocabulary.length + index, false, true, random))
  ];

  const curated = Array.isArray(module.questions) ? module.questions : [];
  if (curated.length < CURATED_QUESTION_COUNT) {
    throw new RangeError(`module ${module.id || "unknown"} needs at least ${CURATED_QUESTION_COUNT} curated questions`);
  }
  const curatedItems = chooseCuratedQuestions(curated, CURATED_QUESTION_COUNT, random)
    .map(question => curatedQuestion(question, module));

  return shuffle([...vocabularyItems, ...curatedItems], random);
}

/**
 * Calculates the result of a mixed course check.
 * Optional challenge attempts do not affect the required course result.
 */
export function calculateCourseResult(attempts, requiredScore = 80) {
  if (!Array.isArray(attempts)) throw new TypeError("attempts must be an array");
  if (!Number.isFinite(requiredScore) || requiredScore < 0 || requiredScore > 100) {
    throw new RangeError("requiredScore must be between 0 and 100");
  }

  const requiredAttempts = attempts
    .filter(attempt => attempt?.optional !== true)
    .map((attempt, index) => ({ ...attempt, resultKey: String(attempt?.id || `attempt-${index}`) }));
  const firstAttempts = requiredAttempts.filter(attempt => attempt.retry !== true);
  const secureCorrect = attempt => attempt.correct === true && attempt.assisted !== true;
  const total = firstAttempts.length;
  const correct = firstAttempts.filter(secureCorrect).length;
  const score = percentage(correct, total);
  const grouped = new Map();

  for (const attempt of firstAttempts) {
    const skill = String(attempt?.skill || "allgemein");
    const current = grouped.get(skill) || { correct: 0, total: 0 };
    current.total += 1;
    if (secureCorrect(attempt)) current.correct += 1;
    grouped.set(skill, current);
  }

  const skillScores = Object.fromEntries([...grouped].map(([skill, value]) => [skill, {
    ...value,
    score: percentage(value.correct, value.total)
  }]));
  const weakSkills = Object.entries(skillScores)
    .filter(([, value]) => value.score < MINIMUM_SKILL_SCORE)
    .map(([skill]) => skill);
  const mistakes = firstAttempts.filter(attempt => !secureCorrect(attempt));
  const correctedMistakeKeys = new Set(
    requiredAttempts
      .filter(attempt => attempt.retry === true && secureCorrect(attempt))
      .map(attempt => attempt.resultKey)
  );
  const correctedMistakes = mistakes.filter(attempt => correctedMistakeKeys.has(attempt.resultKey)).length;
  const allMistakesCorrected = correctedMistakes === mistakes.length;
  const passed = total > 0 && score >= requiredScore && weakSkills.length === 0 && allMistakesCorrected;

  return {
    total,
    correct,
    score,
    requiredScore,
    minimumSkillScore: MINIMUM_SKILL_SCORE,
    skillScores,
    weakSkills,
    initialMistakes: mistakes.length,
    correctedMistakes,
    allMistakesCorrected,
    assistedCount: firstAttempts.filter(attempt => attempt.assisted === true).length,
    passed,
    needsReview: !passed
  };
}

/** Summarizes module progress for the current (non-persistent) session. */
export function moduleSessionStatus(packProgress, totalPacks) {
  if (!Number.isInteger(totalPacks) || totalPacks < 0) {
    throw new RangeError("totalPacks must be a non-negative integer");
  }

  const records = normalizePackProgress(packProgress, totalPacks);
  const attemptedPacks = records.filter(record => record.attempted).length;
  const completedPacks = records.filter(record => record.completed).length;
  const progress = percentage(completedPacks, totalPacks);
  const nextPackIndex = records.findIndex(record => !record.completed);
  const status = totalPacks === 0
    ? "unavailable"
    : completedPacks >= totalPacks
      ? "complete"
      : attemptedPacks > 0
        ? "in-progress"
        : "not-started";

  return {
    status,
    totalPacks,
    attemptedPacks,
    completedPacks,
    remainingPacks: Math.max(totalPacks - completedPacks, 0),
    progress,
    nextPackIndex: nextPackIndex < 0 ? null : nextPackIndex
  };
}

/** Returns the insertion index after two intervening questions. */
export function nextRetryIndex(currentIndex, queueLength) {
  if (!Number.isInteger(currentIndex) || currentIndex < 0) {
    throw new RangeError("currentIndex must be a non-negative integer");
  }
  if (!Number.isInteger(queueLength) || queueLength < 0) {
    throw new RangeError("queueLength must be a non-negative integer");
  }
  return Math.min(currentIndex + 3, queueLength);
}

function vocabularyQuestion(entry, vocabularyPool, index, isNew, isReview, random) {
  const type = index % 2 === 0 ? "choice" : "typed";
  const answer = String(entry.deutsch).trim();
  const options = type === "choice" ? vocabularyOptions(entry, vocabularyPool, random) : [];
  return {
    id: `vocab-${isReview ? "review" : "new"}-${vocabularyKey(entry)}`,
    kind: "vocabulary",
    type,
    skill: "vocabulary",
    prompt: `Was bedeutet „${String(entry.latein).trim()}“?`,
    answer,
    options,
    explanation: entry.grammatik ? `${entry.grammatik} · Lektion ${entry.lektion}` : `Lektion ${entry.lektion}`,
    vocabulary: entry,
    new: isNew,
    review: isReview,
    isNew,
    isReview
  };
}

function curatedQuestion(question, module) {
  const type = question.type === "typed" ? "typed" : "choice";
  const options = type === "choice" ? uniqueStrings(question.options || []) : [];
  if (type === "choice" && !options.includes(question.answer)) options.unshift(question.answer);
  return {
    ...question,
    id: `${module.id}-${question.id}`,
    kind: "curated",
    type,
    options,
    new: false,
    review: false,
    isNew: false,
    isReview: false
  };
}

function vocabularyOptions(entry, vocabularyPool, random) {
  const answer = String(entry.deutsch).trim();
  const distractors = uniqueStrings(
    shuffle(vocabularyPool, random)
      .filter(candidate => vocabularyKey(candidate) !== vocabularyKey(entry))
      .map(candidate => String(candidate?.deutsch || "").trim())
      .filter(Boolean)
  ).filter(meaning => meaning !== answer).slice(0, 3);
  return shuffle([answer, ...distractors], random);
}

function chooseCuratedQuestions(questions, count, random) {
  const pool = shuffle(questions, random);
  const chosen = [];
  const skills = new Set();

  for (const question of pool) {
    if (chosen.length >= count) break;
    if (question.skill !== "vocabulary" && !skills.has(question.skill)) {
      chosen.push(question);
      skills.add(question.skill);
    }
  }
  for (const question of pool) {
    if (chosen.length >= count) break;
    if (!chosen.includes(question)) chosen.push(question);
  }

  const types = new Set(chosen.map(question => question.type));
  if (types.size > 1) return chosen;
  const replacement = pool.find(question => question.type !== chosen[0]?.type && !chosen.includes(question));
  if (replacement) chosen[chosen.length - 1] = replacement;
  return chosen;
}

function normalizePackProgress(packProgress, totalPacks) {
  if (typeof packProgress === "number") {
    const completed = Math.min(Math.max(Math.floor(packProgress), 0), totalPacks);
    return Array.from({ length: totalPacks }, (_, index) => ({ attempted: index < completed, completed: index < completed }));
  }

  const source = Array.isArray(packProgress)
    ? packProgress
    : packProgress && typeof packProgress === "object"
      ? Object.values(packProgress)
      : [];

  return Array.from({ length: totalPacks }, (_, index) => {
    const value = source[index];
    const completed = value === true
      || (typeof value === "number" && value >= 80)
      || value?.passed === true
      || value?.completed === true
      || ["complete", "mastered"].includes(value?.status);
    const attempted = completed
      || value === false
      || typeof value === "number"
      || value?.attempted === true
      || Number(value?.attempts || 0) > 0;
    return { attempted, completed };
  });
}

function uniqueVocabulary(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    if (!entry || !String(entry.latein || "").trim() || !String(entry.deutsch || "").trim()) return false;
    const key = vocabularyKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function vocabularyKey(entry) {
  return `${Number(entry?.lektion) || 0}-${slug(entry?.latein)}-${slug(entry?.deutsch)}`;
}

function slug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueStrings(values) {
  return [...new Set(values.map(value => String(value).trim()).filter(Boolean))];
}

function percentage(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const candidate = Math.floor(normalizedRandom(random) * (index + 1));
    [result[index], result[candidate]] = [result[candidate], result[index]];
  }
  return result;
}

function normalizedRandom(random) {
  const value = Number(random());
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 0.9999999999999999);
}
