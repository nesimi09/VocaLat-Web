import test from "node:test";
import assert from "node:assert/strict";
import {
  annotateMorphologyConfidence,
  buildLatinSyntaxTree,
  summarizeAnalysisConfidence
} from "../latin-syntax-tree.js";

const token = (index, raw, part, morphology = {}) => ({
  index,
  raw,
  normalized: raw.toLocaleLowerCase("la"),
  lemma: morphology.dictionaryLemma || raw.toLocaleLowerCase("la"),
  morphology: { part, ...morphology },
  punctuationAfter: []
});

test("morphological alternatives keep normalized probabilities and the chosen reading", () => {
  const nominative = { dictionaryLemma: "puella", part: "n", case: "nominative", number: "singular" };
  const accusative = { dictionaryLemma: "puella", part: "n", case: "accusative", number: "singular" };
  const [word] = annotateMorphologyConfidence([{
    ...token(0, "puella", "n", nominative),
    candidates: [
      { morphology: nominative, score: 5 },
      { morphology: accusative, score: 3 }
    ],
    selected: { morphology: nominative, score: 5 }
  }]);

  assert.equal(word.analysisAlternatives.length, 2);
  assert.ok(word.analysisConfidence > .8);
  assert.ok(Math.abs(word.analysisAlternatives.reduce((sum, item) => sum + item.probability, 0) - 1) < .002);
  assert.equal(word.analysisAlternatives[0].morphology.case, "nominative");
});

test("the syntax tree nests objects and attributes below an independent predicate root", () => {
  const words = annotateMorphologyConfidence([
    token(0, "Puella", "n", { case: "nominative", number: "singular" }),
    token(1, "pulchram", "adj", { case: "accusative", number: "singular", gender: "f" }),
    token(2, "rosam", "n", { case: "accusative", number: "singular", gender: "f" }),
    token(3, "portat", "v", { mood: "indicative", person: 3, number: "singular" })
  ]);
  const roles = { subject: [0], directObject: [2], indirectObject: [], genitive: [], ablative: [], prepositional: [], predicates: [3], adverbial: [], vocative: [] };
  const dependencies = [
    { type: "subject", headIndex: 3, dependentIndex: 0 },
    { type: "direct-object", headIndex: 3, dependentIndex: 2 },
    { type: "attribute", headIndex: 2, dependentIndex: 1 }
  ];
  const tree = buildLatinSyntaxTree({
    type: "sentence",
    words,
    clauses: [{ id: "c0", type: "main", headIndex: 3, tokenIndexes: [0, 1, 2, 3], roles, dependencies }],
    dependencies,
    rootClauseId: "c0"
  });

  assert.equal(tree.clauses[0].tokens[0].index, 3);
  const object = tree.clauses[0].tokens[0].children.find(child => child.relation === "direct-object");
  assert.equal(object.index, 2);
  assert.equal(object.children[0].relation, "attribute");
  assert.equal(object.children[0].index, 1);
  assert.deepEqual(tree.unattachedTokenIndexes, []);
});

test("relative clauses attach to the clause containing their antecedent", () => {
  const words = [
    token(0, "Puella", "n", { case: "nominative" }),
    token(1, "quam", "pron", { case: "accusative" }),
    token(2, "vides", "v", { mood: "indicative" }),
    token(3, "venit", "v", { mood: "indicative" })
  ];
  const emptyRoles = { subject: [], directObject: [], indirectObject: [], genitive: [], ablative: [], prepositional: [], predicates: [], adverbial: [], vocative: [] };
  const clauses = [
    { id: "c0", type: "main", headIndex: 3, tokenIndexes: [0, 3], roles: { ...emptyRoles, subject: [0] }, dependencies: [{ type: "subject", headIndex: 3, dependentIndex: 0 }] },
    { id: "c1", type: "relative", headIndex: 2, markerIndex: 1, antecedentIndex: 0, tokenIndexes: [1, 2], roles: emptyRoles, dependencies: [] }
  ];
  const tree = buildLatinSyntaxTree({ words, clauses, dependencies: [], rootClauseId: "c0" });

  assert.equal(tree.clauses.length, 1);
  assert.equal(tree.clauses[0].clauses[0].id, "c1");
  assert.equal(tree.clauses[0].clauses[0].relation, "relative-modifier");
});

test("parenthetical spans are represented without removing their tokens", () => {
  const words = [
    { ...token(0, "Caesar", "proper"), punctuationAfter: [",", "("] },
    token(1, "ut", "conj"),
    { ...token(2, "puto", "v", { mood: "indicative" }), punctuationAfter: [")", ","] },
    token(3, "venit", "v", { mood: "indicative" })
  ];
  const tree = buildLatinSyntaxTree({
    words,
    clauses: [{ id: "c0", type: "main", headIndex: 3, tokenIndexes: [0, 1, 2, 3], roles: {}, dependencies: [] }],
    dependencies: [],
    rootClauseId: "c0"
  });

  assert.deepEqual(tree.parentheticals[0].tokenIndexes, [1, 2]);
  assert.deepEqual(tree.flatClauses[0].tokenIndexes, [0, 1, 2, 3]);
});

test("confidence reports alternatives internally while selecting one interpretation", () => {
  const words = annotateMorphologyConfidence([{
    ...token(0, "legit", "v", { dictionaryLemma: "lego", mood: "indicative" }),
    candidates: [
      { morphology: { dictionaryLemma: "lego", part: "v", mood: "indicative", tense: "present" }, score: 4 },
      { morphology: { dictionaryLemma: "lego", part: "v", mood: "indicative", tense: "perfect" }, score: 3.8 }
    ],
    selected: { morphology: { dictionaryLemma: "lego", part: "v", mood: "indicative", tense: "present" }, score: 4 }
  }]);
  const summary = summarizeAnalysisConfidence(words, { confidence: .73 });

  assert.equal(summary.selectedInterpretationOnly, true);
  assert.equal(summary.ambiguous.length, 1);
  assert.equal(summary.ambiguous[0].alternatives.length, 2);
  assert.equal(summary.confidence, .73);
});
