import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGrammarPractice, buildGrammarQuestionBank } from "../grammar-practice.js";

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
