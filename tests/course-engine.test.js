import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCourseRound,
  calculateCourseResult,
  moduleSessionStatus,
  nextRetryIndex,
  vocabularyForModule,
  vocabularyPacks
} from "../course-engine.js";

const course = readJson("../data/course.json");
const vocabulary = readJson("../data/vocabulary.json");
const grammar = readJson("../data/grammar.json");

const usableVocabulary = vocabulary.filter(entry =>
  entry.latein?.trim()
  && entry.deutsch?.trim()
  && !entry.grammatik?.toLocaleLowerCase("de").includes("unsicher")
);

test("course defines ten complete, stable modules and skips lesson 7", () => {
  assert.equal(course.modules.length, 10);
  assert.equal(new Set(course.modules.map(module => module.id)).size, 10);
  assert.deepEqual(
    course.modules.flatMap(module => module.lessons),
    [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]
  );

  for (const module of course.modules) {
    assert.match(module.id, /^m\d{2}-[a-z0-9-]+$/);
    assert.equal(typeof module.title, "string");
    assert.ok(module.title.length > 0);
    assert.ok(module.story.length > 20);
    assert.ok(Number.isInteger(module.difficulty));
    assert.ok(module.difficulty >= 1 && module.difficulty <= 5);
    assert.ok(module.objectives.length >= 3);
    assert.deepEqual(Object.keys(module.concept).sort(), ["commonMistake", "example", "explanation", "rule"]);
    assert.equal(module.challenge.optional, true);
    assert.ok(module.questions.length >= 4);
  }
});

test("module lesson ranges cover every usable textbook entry exactly once", () => {
  const mapped = course.modules.flatMap(module => vocabularyForModule(vocabulary, module));
  assert.equal(usableVocabulary.length, 611);
  assert.equal(mapped.length, usableVocabulary.length);
  assert.equal(new Set(mapped).size, usableVocabulary.length);
  assert.equal(mapped.some(entry => Number(entry.lektion) === 7), false);

  const counts = course.modules.map(module => vocabularyForModule(vocabulary, module).length);
  assert.deepEqual(counts, [54, 59, 68, 81, 58, 62, 54, 60, 59, 56]);
});

test("vocabularyForModule rejects the unreadable lesson 7 placeholder", () => {
  const entries = vocabularyForModule(vocabulary, { lessons: [6, 7, 8] });
  assert.ok(entries.length > 0);
  assert.equal(entries.some(entry => Number(entry.lektion) === 7), false);
  assert.ok(entries.every(entry => entry.latein.trim() && entry.deutsch.trim()));
});

test("all course grammar links resolve to real grammar titles", () => {
  const grammarTitles = new Set(grammar.abschnitte.map(section => section.titel));
  for (const module of course.modules) {
    for (const title of module.grammarTitles) assert.ok(grammarTitles.has(title), `${module.id}: ${title}`);
  }
});

test("curated questions are complete and choice options are unique", () => {
  for (const module of course.modules) {
    const questionIds = new Set();
    for (const question of module.questions) {
      assert.ok(!questionIds.has(question.id), `${module.id} repeats ${question.id}`);
      questionIds.add(question.id);
      assert.ok(question.skill);
      assert.ok(question.answer);
      assert.ok(question.prompt);
      assert.ok(question.explanation);
      assert.ok(["choice", "typed"].includes(question.type));
      assert.ok(Array.isArray(question.options));
      if (question.type === "choice") {
        assert.equal(new Set(question.options).size, question.options.length);
        assert.equal(question.options.filter(option => option === question.answer).length, 1);
        assert.ok(question.options.length >= 4);
      } else {
        assert.deepEqual(question.options, []);
      }
    }
  }
});

test("vocabulary packs retain book order, cover the module, and never exceed eight words", () => {
  for (const module of course.modules) {
    const expected = vocabularyForModule(vocabulary, module);
    const packs = vocabularyPacks(vocabulary, module);
    assert.ok(packs.length > 0);
    assert.ok(packs.every(pack => pack.length >= 1 && pack.length <= 8));
    assert.deepEqual(packs.flat(), expected);
  }
  assert.throws(() => vocabularyPacks(vocabulary, course.modules[0], 0), RangeError);
});

test("a course round asks each new word once, adds two reviews and three curated questions", () => {
  const module = course.modules[0];
  const moduleVocabulary = vocabularyForModule(vocabulary, module);
  const pack = moduleVocabulary.slice(0, 8);
  const reviewVocabulary = moduleVocabulary.slice(8, 12);
  const round = buildCourseRound({ module, pack, reviewVocabulary, moduleVocabulary, random: () => 0.42 });
  const newItems = round.filter(item => item.kind === "vocabulary" && item.new);
  const reviewItems = round.filter(item => item.kind === "vocabulary" && item.review);
  const curatedItems = round.filter(item => item.kind === "curated");

  assert.equal(round.length, pack.length + 2 + 3);
  assert.equal(newItems.length, pack.length);
  assert.deepEqual(new Set(newItems.map(item => item.vocabulary)), new Set(pack));
  assert.equal(reviewItems.length, 2);
  assert.equal(curatedItems.length, 3);
  assert.ok(round.every(item => typeof item.skill === "string" && typeof item.new === "boolean" && typeof item.review === "boolean"));
  assert.ok(round.some(item => item.type === "choice"));
  assert.ok(round.some(item => item.type === "typed"));
});

test("round vocabulary choices are unique and contain the answer exactly once", () => {
  const module = course.modules[3];
  const moduleVocabulary = vocabularyForModule(vocabulary, module);
  const round = buildCourseRound({
    module,
    pack: moduleVocabulary.slice(0, 8),
    reviewVocabulary: moduleVocabulary.slice(8, 11),
    moduleVocabulary,
    random: seededRandom(17)
  });

  for (const item of round.filter(item => item.type === "choice")) {
    assert.equal(new Set(item.options).size, item.options.length, item.id);
    assert.equal(item.options.filter(option => option === item.answer).length, 1, item.id);
  }
});

test("curated checks preserve every distinct non-vocabulary skill in a module", () => {
  for (const module of course.modules) {
    const moduleVocabulary = vocabularyForModule(vocabulary, module);
    const round = buildCourseRound({
      module,
      pack: moduleVocabulary.slice(0, 8),
      moduleVocabulary,
      random: seededRandom(module.id.length)
    });
    const expectedSkills = new Set(module.questions.filter(question => question.skill !== "vocabulary").map(question => question.skill));
    const actualSkills = new Set(round.filter(item => item.kind === "curated").map(item => item.skill));
    for (const skill of expectedSkills) assert.equal(actualSkills.has(skill), true, `${module.id} misses ${skill}`);
  }
});

test("reviews already present in a new pack are not duplicated", () => {
  const module = course.modules[1];
  const moduleVocabulary = vocabularyForModule(vocabulary, module);
  const pack = moduleVocabulary.slice(0, 4);
  const round = buildCourseRound({
    module,
    pack,
    reviewVocabulary: [pack[0], pack[1], moduleVocabulary[4]],
    moduleVocabulary,
    random: () => 0.1
  });

  assert.equal(round.filter(item => item.review).length, 1);
  assert.equal(round.filter(item => item.new).length, 4);
});

test("calculateCourseResult passes at 80 percent after every first-attempt mistake is corrected", () => {
  const attempts = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `v-${index}`, skill: "vocabulary", correct: true })),
    { id: "v-missed", skill: "vocabulary", correct: false },
    ...Array.from({ length: 3 }, (_, index) => ({ id: `g-${index}`, skill: "grammar", correct: true })),
    { id: "g-missed", skill: "grammar", correct: false },
    { id: "v-missed", skill: "vocabulary", correct: true, retry: true },
    { id: "g-missed", skill: "grammar", correct: true, retry: true },
    { skill: "challenge", correct: false, optional: true }
  ];
  const result = calculateCourseResult(attempts);

  assert.equal(result.total, 10);
  assert.equal(result.correct, 8);
  assert.equal(result.score, 80);
  assert.equal(result.passed, true);
  assert.equal(result.allMistakesCorrected, true);
  assert.equal(result.correctedMistakes, 2);
  assert.deepEqual(result.weakSkills, []);
});

test("calculateCourseResult fails below the total threshold or below a skill floor", () => {
  const belowTotal = calculateCourseResult([
    ...Array.from({ length: 7 }, () => ({ skill: "vocabulary", correct: true })),
    ...Array.from({ length: 3 }, () => ({ skill: "vocabulary", correct: false }))
  ]);
  assert.equal(belowTotal.score, 70);
  assert.equal(belowTotal.passed, false);

  const weakSkill = calculateCourseResult([
    ...Array.from({ length: 7 }, () => ({ skill: "vocabulary", correct: true })),
    { skill: "vocabulary", correct: false },
    { skill: "grammar", correct: true },
    { skill: "grammar", correct: false }
  ]);
  assert.equal(weakSkill.score, 80);
  assert.deepEqual(weakSkill.weakSkills, ["grammar"]);
  assert.equal(weakSkill.passed, false);
  assert.equal(calculateCourseResult([]).passed, false);
});

test("uncorrected or assisted answers prevent mastery even when the visible answer is right", () => {
  const attempts = [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `secure-${index}`, skill: "vocabulary", correct: true })),
    { id: "assisted", skill: "vocabulary", correct: true, assisted: true },
    { id: "missed", skill: "vocabulary", correct: false },
    { id: "missed", skill: "vocabulary", correct: true, retry: true }
  ];
  const unresolved = calculateCourseResult(attempts);
  assert.equal(unresolved.score, 80);
  assert.equal(unresolved.assistedCount, 1);
  assert.equal(unresolved.initialMistakes, 2);
  assert.equal(unresolved.correctedMistakes, 1);
  assert.equal(unresolved.passed, false);

  const resolved = calculateCourseResult([
    ...attempts,
    { id: "assisted", skill: "vocabulary", correct: true, retry: true }
  ]);
  assert.equal(resolved.allMistakesCorrected, true);
  assert.equal(resolved.passed, true);
});

test("moduleSessionStatus reports not-started, in-progress, and complete states", () => {
  assert.deepEqual(moduleSessionStatus([], 2), {
    status: "not-started",
    totalPacks: 2,
    attemptedPacks: 0,
    completedPacks: 0,
    remainingPacks: 2,
    progress: 0,
    nextPackIndex: 0
  });

  const active = moduleSessionStatus([{ passed: true }, { attempted: true, score: 75 }, true], 3);
  assert.equal(active.status, "in-progress");
  assert.equal(active.attemptedPacks, 3);
  assert.equal(active.completedPacks, 2);
  assert.equal(active.progress, 67);
  assert.equal(active.nextPackIndex, 1);

  const complete = moduleSessionStatus([true, 80, { status: "mastered" }], 3);
  assert.equal(complete.status, "complete");
  assert.equal(complete.progress, 100);
  assert.equal(complete.nextPackIndex, null);
});

test("failed questions return after two intervening questions without exceeding the queue", () => {
  assert.equal(nextRetryIndex(0, 10), 3);
  assert.equal(nextRetryIndex(4, 10), 7);
  assert.equal(nextRetryIndex(9, 10), 10);
  assert.throws(() => nextRetryIndex(-1, 10), RangeError);
  assert.throws(() => nextRetryIndex(1, -1), RangeError);
});

function readJson(relativeUrl) {
  return JSON.parse(readFileSync(new URL(relativeUrl, import.meta.url), "utf8"));
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}
