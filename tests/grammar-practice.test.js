import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGrammarPractice, buildGrammarQuestionBank, grammarIntroductionLesson } from "../grammar-practice.js";

const grammar = JSON.parse(readFileSync(new URL("../data/grammar.json", import.meta.url), "utf8")).abschnitte;

test("grammar data creates a substantial practice bank", () => {
  const bank = buildGrammarQuestionBank(grammar);
  assert.ok(bank.length >= 150, `only ${bank.length} questions generated`);
  assert.ok(bank.every(question => question.prompt && question.answer));
  assert.ok(bank.every(question => question.options.includes(question.answer)));
  assert.ok(bank.every(question => question.options.length >= 3));
});

test("a grammar round is short and can be limited to one category", () => {
  const round = buildGrammarPractice(grammar, { category: "konjugationen", limit: 10, random: () => .42 });
  assert.equal(round.length, 10);
  assert.ok(round.every(question => question.category === "konjugationen"));
});

test("esse, posse and ire forms are practiced in their ordered tables", () => {
  const bank = buildGrammarQuestionBank(grammar);
  assert.ok(bank.some(question => /Form von posse/.test(question.prompt) && question.answer === "possum"));
  assert.ok(bank.some(question => /Form von ire/.test(question.prompt) && question.answer === "ibant"));
});

test("grammar practice never includes topics introduced after the selected lesson", () => {
  const round = buildGrammarPractice(grammar, { maxLesson: 15, limit: 500, random: () => .42 });
  assert.ok(round.length > 20);
  assert.ok(round.every(question => question.lesson <= 15));
  assert.ok(round.some(question => question.sectionTitle === "PPP Bildung und Verwendung"));
  assert.ok(!round.some(question => question.sectionTitle === "AcI und NcI"));
  assert.ok(!round.some(question => question.sectionTitle === "Ablativus absolutus"));
});

test("overview questions unlock PPP, PPA and PFA at their own lesson boundaries", () => {
  const overviewAt = maxLesson => buildGrammarPractice(grammar, { maxLesson, limit: 1000, random: () => .42 })
    .filter(question => question.sectionTitle === "Partizipien Überblick");

  const at15 = overviewAt(15);
  const ppaContent = ["laudans", "lobend", "gleichzeitig"];
  const pfaContent = ["laudaturus", "nachzeitig", "im Begriff zu loben"];
  assert.ok(at15.some(question => question.answer === "laudatus" && question.lesson === 14));
  assert.ok(at15.some(question => question.answer === "vorzeitig" && question.lesson === 14));
  assert.ok(at15.every(question => question.options.every(option => ![...ppaContent, ...pfaContent].includes(option))));

  const at20 = overviewAt(20);
  assert.ok(at20.some(question => question.answer === "laudans" && question.lesson === 20));
  assert.ok(at20.some(question => question.answer === "gleichzeitig" && question.lesson === 20));
  assert.ok(at20.every(question => question.options.every(option => !pfaContent.includes(option))));

  const at29 = overviewAt(29);
  assert.ok(at29.some(question => question.answer === "laudaturus" && question.lesson === 29));
  assert.ok(at29.some(question => question.answer === "nachzeitig" && question.lesson === 29));
});

test("every lesson boundary excludes questions that unlock later", () => {
  for (let maxLesson = 1; maxLesson <= 31; maxLesson += 1) {
    const round = buildGrammarPractice(grammar, { maxLesson, limit: 1000, random: () => .42 });
    assert.ok(round.every(question => question.lesson <= maxLesson), `lesson ${maxLesson} contains a later question`);
  }
});

test("an unavailable category remains empty instead of falling back to mixed grammar", () => {
  const round = buildGrammarPractice(grammar, { category: "partizipien", maxLesson: 1, limit: 10, random: () => .42 });
  assert.deepEqual(round, []);
});

test("all grammar sections have an introduction lesson", () => {
  assert.ok(grammar.every(section => Number.isInteger(grammarIntroductionLesson(section))));
  assert.equal(grammarIntroductionLesson(grammar.find(section => section.titel === "AcI und NcI")), 20);
  assert.equal(grammarIntroductionLesson(grammar.find(section => section.titel === "Gerundium und Gerundivum")), 29);
});
