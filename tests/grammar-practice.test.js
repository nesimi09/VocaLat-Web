import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildGrammarPractice,
  buildGrammarQuestionBank,
  grammarIntroductionLesson,
  grammarStageForLesson,
  grammarStagesForLessons
} from "../grammar-practice.js";

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
  assert.ok(bank.some(question => question.prompt === "Was ist die 1. Person Singular von posse im Präsens?" && question.answer === "possum"));
  assert.ok(bank.some(question => question.prompt === "Was ist die 3. Person Plural von ire im Imperfekt?" && question.answer === "ibant"));
});

test("form questions are short and never repeat a complete table title", () => {
  const bank = buildGrammarQuestionBank(grammar);
  const formQuestions = bank.filter(question => /-(?:forms|nested|conjugation|example)-/.test(question.id));
  assert.ok(formQuestions.length >= 140);
  assert.ok(formQuestions.every(question => !question.prompt.includes(`„${question.sectionTitle}“`)));
  assert.ok(formQuestions.every(question => !question.prompt.includes("Welche Form steht bei")));
  assert.ok(formQuestions.every(question => !/gehört bei|lautet bei/.test(question.prompt)));
  assert.ok(formQuestions.every(question => {
    if (!/^\p{L}+$/u.test(question.answer)) return true;
    const promptWords = question.prompt.toLocaleLowerCase("de").split(/[^\p{L}]+/u);
    return !promptWords.includes(question.answer.toLocaleLowerCase("de"));
  }));

  const question = (answer, sectionTitle) => bank.find(item => item.answer === answer && item.sectionTitle === sectionTitle)?.prompt;
  assert.equal(question("istos", "Demonstrativpronomen iste, ista, istud"), "Was ist der Akkusativ Plural Maskulinum von iste?");
  assert.equal(question("quarum", "Relativpronomen qui, quae, quod"), "Was ist der Genitiv Plural Femininum von quae?");
  assert.equal(question("servas", "a-Deklination – serva, servae f."), "Was ist der Akkusativ Plural von serva?");
  assert.equal(question("avos", "o-Deklination – avus und bellum"), "Was ist der Akkusativ Plural von avus?");
  assert.equal(question("rogabas", "Imperfekt Aktiv"), "Was ist die 2. Person Singular von rogare im Imperfekt Aktiv?");
  assert.equal(question("voluerant", "velle"), "Was ist die 3. Person Plural von velle im Plusquamperfekt?");
  assert.equal(question("missus, -a, -um", "PPP Bildung und Verwendung"), "Was ist das PPP von mittere?");
  assert.equal(question("gleichzeitig", "Partizipien Überblick"), "Welches Zeitverhältnis hat das PPA?");
  assert.equal(question("lobend", "Partizipien Überblick"), "Wie wird laudans übersetzt?");
  assert.equal(question("ad legendum", "Gerundium und Gerundivum"), "Was ist ein Beispiel für Gerundium mit ad?");
  assert.equal(question("clarior, clarius", "Steigerung von Adjektiven und Adverbien"), "Was ist der Komparativ von clarus als Adjektiv?");
});

test("rule questions ask for the exact grammar fact instead of a matching statement", () => {
  const bank = buildGrammarQuestionBank(grammar);
  const rules = bank.filter(question => /-rule-/.test(question.id));
  assert.ok(rules.length >= 10);
  assert.ok(rules.every(question => !/Welche (?:Aussage|Angabe) gehört/.test(question.prompt)));

  const aciHint = rules.find(question => question.sectionTitle === "AcI und NcI" && question.id.endsWith("-rule-hinweis"));
  assert.equal(aciHint?.prompt, "Was zeigt der Infinitiv im AcI oder NcI an?");
  assert.match(aciHint?.answer || "", /Zeitverhältnis/);
});

test("grammar practice never includes topics introduced after the selected lesson", () => {
  const round = buildGrammarPractice(grammar, { maxLesson: 15, limit: 500, random: () => .42 });
  assert.ok(round.length > 20);
  assert.ok(round.every(question => question.lesson <= 15));
  assert.ok(round.some(question => question.sectionTitle === "PPP Bildung und Verwendung"));
  assert.ok(!round.some(question => question.sectionTitle === "AcI und NcI"));
  assert.ok(!round.some(question => question.sectionTitle === "Ablativus absolutus"));
});

test("book lessons map to their ten grammar stages", () => {
  assert.deepEqual(
    Array.from({ length: 31 }, (_, index) => grammarStageForLesson(index + 1)),
    [1, 1, 1, 4, 4, 4, 4, 8, 8, 8, 11, 11, 11, 14, 14, 14, 17, 17, 17, 20, 20, 20, 23, 23, 23, 26, 26, 26, 29, 29, 29]
  );
  assert.equal(grammarStageForLesson(0), null);
  assert.equal(grammarStageForLesson(32), null);
  assert.equal(grammarStageForLesson("kein Wert"), null);
  assert.deepEqual(grammarStagesForLessons([15, 16, 30, 31, 15]), [14, 29]);
});

test("one selected book lesson produces only its grammar stage", () => {
  const round = buildGrammarPractice(grammar, { lessons: [15], limit: 1000, random: () => .42 });
  assert.ok(round.length > 10);
  assert.ok(round.every(question => grammarStageForLesson(question.lesson) === 14));
  assert.ok(round.some(question => question.sectionTitle === "PPP Bildung und Verwendung"));
  assert.ok(!round.some(question => question.lesson < 14));
  assert.ok(!round.some(question => question.lesson > 16));
});

test("multiple selected lessons include exactly their grammar stages", () => {
  const round = buildGrammarPractice(grammar, { selectedLessons: [15, 30], limit: 1000, random: () => .42 });
  const stages = new Set(round.map(question => grammarStageForLesson(question.lesson)));
  assert.deepEqual([...stages].sort((a, b) => a - b), [14, 29]);
  assert.ok(round.every(question => [14, 29].includes(grammarStageForLesson(question.lesson))));
  assert.ok(!round.some(question => grammarStageForLesson(question.lesson) === 20));
  assert.ok(!round.some(question => grammarStageForLesson(question.lesson) === 26));
});

test("an explicit empty lesson selection creates no questions", () => {
  assert.deepEqual(buildGrammarPractice(grammar, { lessons: [], limit: 1000, random: () => .42 }), []);
});

test("maxLesson keeps acting as a hard ceiling when lesson selections are used", () => {
  const round = buildGrammarPractice(grammar, { lessons: [15, 30], maxLesson: 15, limit: 1000, random: () => .42 });
  assert.ok(round.length > 0);
  assert.ok(round.every(question => grammarStageForLesson(question.lesson) === 14));
  assert.ok(round.every(question => question.lesson <= 15));
});

test("earlier-stage rule questions never expose answers from a later stage", () => {
  const sections = [
    { titel: "Regel A", lektion: 14, bildung: "frühe Bildung A" },
    { titel: "Regel B", lektion: 14, bildung: "frühe Bildung B" },
    { titel: "Regel C", lektion: 14, bildung: "frühe Bildung C" },
    { titel: "Späte Regel", lektion: 29, bildung: "späte Bildung" }
  ];
  const round = buildGrammarPractice(sections, { lessons: [15], limit: 100, random: () => .42 });
  assert.equal(round.length, 3);
  assert.ok(round.every(question => question.lesson === 14));
  assert.ok(round.every(question => !question.options.includes("späte Bildung")));
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
