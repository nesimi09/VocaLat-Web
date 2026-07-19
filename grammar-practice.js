import { grammarCategory } from "./grammar-order.js";

const PERSONS = ["1. Person Singular", "2. Person Singular", "3. Person Singular", "1. Person Plural", "2. Person Plural", "3. Person Plural"];
const DESCRIPTOR_KEYS = ["person", "kasus", "form", "stufe", "partizip", "verb"];
const GENDERS = ["Maskulinum", "Femininum", "Neutrum"];

export const GRAMMAR_STAGE_STARTS = Object.freeze([1, 4, 8, 11, 14, 17, 20, 23, 26, 29]);

// Earliest lesson in which each topic is used by the guided course. Keeping
// this beside the generator makes the limit apply to every practice entry.
const INTRODUCTION_LESSONS = new Map([
  ["Präsens von esse, posse und ire", 1],
  ["Imperfekt Aktiv", 4],
  ["Imperfekt von esse, posse und ire", 4],
  ["Futur I Aktiv", 11],
  ["Futur I von esse, posse und ire", 11],
  ["Perfekt von esse, posse und ire", 11],
  ["Plusquamperfekt von esse, posse und ire", 14],
  ["Futur II von esse, posse und ire", 14],
  ["Perfekt, Plusquamperfekt und Futur II Aktiv", 8],
  ["Passiv: Präsens, Imperfekt und Futur I", 17],
  ["Passiv: Perfekt, Plusquamperfekt und Futur II", 14],
  ["Relativpronomen qui, quae, quod", 23],
  ["Demonstrativpronomen iste, ista, istud", 11],
  ["Adverbien der i-Deklination", 17],
  ["PPA und seine Übersetzung", 20],
  ["PPP Bildung und Verwendung", 14],
  ["Partizipien Überblick", 14],
  ["PFA und Infinitiv Futur Aktiv", 29],
  ["e-Deklination – res, rei f.", 11],
  ["velle", 17],
  ["Konjunktiv Imperfekt Aktiv und Passiv", 17],
  ["Konjunktiv Präsens Aktiv und Passiv", 26],
  ["Konjunktiv Perfekt Aktiv und Passiv", 26],
  ["Konjunktiv Plusquamperfekt Passiv", 29],
  ["Konjunktiv Plusquamperfekt Aktiv", 29],
  ["AcI und NcI", 20],
  ["Ablativus absolutus", 29],
  ["Gerundium und Gerundivum", 29],
  ["Steigerung von Adjektiven und Adverbien", 23],
  ["u-Deklination – exercitus, manus und cornu", 26],
  ["a-Deklination – serva, servae f.", 1],
  ["o-Deklination – avus und bellum", 1],
  ["Konsonantische Deklination – clamor, mater und litus", 1],
  ["i-Deklination – civis, navis und mare", 8]
]);

// Some overview sections contain material that is introduced across several
// lessons. These overrides keep the gate attached to the individual question
// instead of treating every row as if it began with the section itself.
const ROW_INTRODUCTION_LESSONS = new Map([
  ["Partizipien Überblick", new Map([
    ["PPA", 20],
    ["PPP", 14],
    ["PFA", 29]
  ])]
]);

const ROW_SAFE_DISTRACTORS = new Map([
  ["Partizipien Überblick", new Map([
    ["zeitverhaeltnis", ["ohne festes Zeitverhältnis", "wiederholt"]],
    ["genus_verbi", ["reflexiv", "unpersönlich"]],
    ["beispiel", ["laudare", "laudat"]],
    ["deutsch", ["loben", "er lobt"]]
  ])]
]);

export function grammarIntroductionLesson(section) {
  const explicit = Number(section?.lektion ?? section?.lesson);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return INTRODUCTION_LESSONS.get(section?.titel) || 31;
}

export function grammarStageForLesson(lesson) {
  const numericLesson = Math.trunc(Number(lesson));
  if (!Number.isFinite(numericLesson) || numericLesson < 1 || numericLesson > 31) return null;
  for (let index = GRAMMAR_STAGE_STARTS.length - 1; index >= 0; index -= 1) {
    if (GRAMMAR_STAGE_STARTS[index] <= numericLesson) return GRAMMAR_STAGE_STARTS[index];
  }
  return null;
}

export function grammarStagesForLessons(lessons) {
  const values = Array.isArray(lessons) ? lessons : [lessons];
  return [...new Set(values.map(grammarStageForLesson).filter(Number.isInteger))];
}

export function buildGrammarPractice(sections, {
  category = null,
  maxLesson = 31,
  lessons = null,
  selectedLessons = lessons,
  limit = 10,
  random = Math.random
} = {}) {
  const lessonLimit = Number(maxLesson);
  const effectiveLessonLimit = Number.isFinite(lessonLimit) ? lessonLimit : 31;
  const selectedStages = selectedLessons === null || selectedLessons === undefined
    ? null
    : new Set(grammarStagesForLessons(selectedLessons));
  const allowed = Array.isArray(sections)
    ? sections.filter(section =>
      (!category || grammarCategory(section) === category)
      && grammarIntroductionLesson(section) <= effectiveLessonLimit
    )
    : [];
  const bank = buildGrammarQuestionBank(allowed)
    .filter(question =>
      question.lesson <= effectiveLessonLimit
      && (!selectedStages || selectedStages.has(grammarStageForLesson(question.lesson)))
    );
  return shuffle(bank, random).slice(0, Math.max(1, limit)).map(question => ({
    ...question,
    options: shuffle(question.options, random)
  }));
}

export function buildGrammarQuestionBank(sections) {
  const questions = [];
  for (const [sectionIndex, section] of sections.entries()) {
    questions.push(...questionsFromRows(section, sectionIndex));
    questions.push(...questionsFromNestedForms(section, sectionIndex));
    questions.push(...questionsFromConjugationArrays(section, sectionIndex));
    questions.push(...questionsFromExampleRows(section, sectionIndex));
  }
  questions.push(...questionsFromRules(sections));
  return distinctQuestions(questions).filter(question => question.options.length >= 3);
}

function questionsFromRows(section, sectionIndex) {
  if (!Array.isArray(section.formen) || !section.formen.every(row => row && typeof row === "object" && !Array.isArray(row))) return [];
  const rows = section.formen;
  const descriptorKey = DESCRIPTOR_KEYS.find(key => rows.some(row => scalar(row[key])));
  if (!descriptorKey) return [];
  const valueKeys = [...new Set(rows.flatMap(row => Object.keys(row)))]
    .filter(key => key !== descriptorKey && rows.filter(row => scalar(row[key])).length >= 2);
  const questions = [];
  for (const key of valueKeys) {
    for (const [rowIndex, row] of rows.entries()) {
      const answer = scalar(row[key]);
      const descriptor = scalar(row[descriptorKey]);
      if (!answer || !descriptor) continue;
      if (descriptorKey === "kasus" && sameForm(answer, declensionHeadword(rows, key))) continue;
      const lesson = rowIntroductionLesson(section, row);
      const pool = rowAnswerPool(section, rows, key, lesson);
      if (pool.length < 3) continue;
      questions.push(makeQuestion({
        id: `${sectionIndex}-forms-${key}-${rowIndex}`,
        section,
        lesson,
        prompt: rowPrompt(section, rows, row, descriptorKey, descriptor, key),
        answer,
        pool,
        explanation: rowExplanation(section, rows, row, descriptorKey, descriptor, key, answer)
      }));
    }
  }
  return questions;
}

function questionsFromNestedForms(section, sectionIndex) {
  const forms = section.formen;
  if (!forms || Array.isArray(forms) || typeof forms !== "object") return [];
  const questions = [];
  for (const [number, cases] of Object.entries(forms)) {
    if (!cases || typeof cases !== "object" || Array.isArray(cases)) continue;
    const pool = unique(Object.values(cases).flatMap(value => Array.isArray(value) ? value : []));
    if (pool.length < 3) continue;
    for (const [grammaticalCase, values] of Object.entries(cases)) {
      if (!Array.isArray(values)) continue;
      values.forEach((answer, genderIndex) => {
        if (!scalar(answer)) return;
        const grammaticalForm = `${capitalize(grammaticalCase)} ${capitalize(number)} ${GENDERS[genderIndex] || `${genderIndex + 1}. Form`}`;
        const headword = pronounHeadword(forms, genderIndex, section.titel);
        if (sameForm(answer, headword)) return;
        questions.push(makeQuestion({
          id: `${sectionIndex}-nested-${number}-${grammaticalCase}-${genderIndex}`,
          section,
          prompt: `Was ist der ${grammaticalForm} von ${headword}?`,
          answer,
          pool,
          explanation: `${answer} ist der ${grammaticalForm} von ${headword}.`
        }));
      });
    }
  }
  return questions;
}

function questionsFromConjugationArrays(section, sectionIndex) {
  const keys = ["praesens", "imperfekt", "futur", "perfekt", "plusquamperfekt", "ppa"];
  const arrays = keys.map(key => [key, section[key]]).filter(([, value]) => Array.isArray(value) && value.length >= 3 && value.every(scalar));
  const questions = [];
  for (const [key, forms] of arrays) {
    forms.forEach((answer, index) => questions.push(makeQuestion({
      id: `${sectionIndex}-conjugation-${key}-${index}`,
      section,
      prompt: `Was ist die ${PERSONS[index] || `${index + 1}. Form`} von ${sectionHeadword(section.titel)} im ${tenseLabel(key)}?`,
      answer,
      pool: forms,
      explanation: `${answer} ist die ${PERSONS[index] || `${index + 1}. Form`} von ${sectionHeadword(section.titel)} im ${tenseLabel(key)}.`
    })));
  }
  return questions;
}

function questionsFromExampleRows(section, sectionIndex) {
  if (!Array.isArray(section.beispielreihen)) return [];
  const rows = section.beispielreihen.filter(row => Array.isArray(row?.formen) && row.formen.length >= 3);
  const questions = [];
  for (const [rowIndex, row] of rows.entries()) {
    row.formen.forEach((answer, formIndex) => {
      const pool = unique(rows.flatMap(candidate => candidate.formen[formIndex] || []).concat(row.formen));
      if (pool.length < 3) return;
      questions.push(makeQuestion({
        id: `${sectionIndex}-example-${rowIndex}-${formIndex}`,
        section,
        prompt: `Was ist die ${PERSONS[formIndex] || `${formIndex + 1}. Form`} von ${row.verb || "diesem Verb"} im ${tenseFromTitle(section.titel)}?`,
        answer,
        pool,
        explanation: `${answer} ist die ${PERSONS[formIndex] || `${formIndex + 1}. Form`} von ${row.verb || "diesem Verb"} im ${tenseFromTitle(section.titel)}.`
      }));
    });
  }
  return questions;
}

function questionsFromRules(sections) {
  const ruleKeys = ["bildung", "bildung_aktiv", "bildung_passiv", "hinweis", "bedeutung"];
  const questions = [];
  for (const key of ruleKeys) {
    const records = sections.map((section, index) => ({
      section,
      index,
      lesson: grammarIntroductionLesson(section),
      answer: scalar(section[key])
    }))
      .filter(record => record.answer && record.answer.length <= 120);
    if (records.length < 3) continue;
    for (const record of records) {
      const pool = records
        .filter(candidate => candidate.lesson <= record.lesson)
        .map(candidate => candidate.answer);
      questions.push(makeQuestion({
        id: `${record.index}-rule-${key}`,
        section: record.section,
        lesson: record.lesson,
        prompt: `Welche Aussage gehört zu „${record.section.titel}“?`,
        answer: record.answer,
        pool,
        explanation: `Diese Aussage gehört zur Regel „${record.section.titel}“.`
      }));
    }
  }
  return questions;
}

function makeQuestion({ id, section, lesson = grammarIntroductionLesson(section), prompt, answer, pool, explanation }) {
  const distractors = unique(pool).filter(value => value !== answer).slice(0, 3);
  return {
    id,
    category: grammarCategory(section),
    lesson,
    sectionTitle: section.titel,
    prompt,
    answer: scalar(answer),
    options: unique([scalar(answer), ...distractors]),
    explanation
  };
}

function rowIntroductionLesson(section, row) {
  const explicit = Number(row?.lektion ?? row?.lesson);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const subtopic = scalar(row?.partizip);
  return ROW_INTRODUCTION_LESSONS.get(section?.titel)?.get(subtopic)
    || grammarIntroductionLesson(section);
}

function rowAnswerPool(section, rows, key, lesson) {
  const eligibleAnswers = rows
    .filter(candidate => rowIntroductionLesson(section, candidate) <= lesson)
    .map(candidate => scalar(candidate[key]));
  const safeDistractors = ROW_SAFE_DISTRACTORS.get(section?.titel)?.get(key) || [];
  return unique([...eligibleAnswers, ...safeDistractors]);
}

function rowPrompt(section, rows, row, descriptorKey, descriptor, valueKey) {
  if (descriptorKey === "person") {
    return `Was ist die ${personLabel(descriptor)} von ${label(valueKey)} im ${tenseFromTitle(section.titel)}?`;
  }
  if (descriptorKey === "kasus") {
    return `Was ist der ${caseFormLabel(descriptor, valueKey)} von ${declensionHeadword(rows, valueKey)}?`;
  }
  if (descriptorKey === "verb") {
    return valueKey === "deutsch"
      ? `Wie wird das PPP von ${descriptor} übersetzt?`
      : `Was ist das PPP von ${descriptor}?`;
  }
  if (descriptorKey === "partizip") {
    return ({
      zeitverhaeltnis: `Welches Zeitverhältnis hat das ${descriptor}?`,
      genus_verbi: `Welches Genus Verbi hat das ${descriptor}?`,
      beispiel: `Was ist eine Beispielform für das ${descriptor}?`,
      deutsch: `Wie wird ${row.beispiel || descriptor} übersetzt?`
    })[valueKey] || `Was gehört zum ${descriptor}?`;
  }
  if (descriptorKey === "form") {
    return valueKey === "deutsch"
      ? `Wie wird ${row.beispiel || descriptor} übersetzt?`
      : `Was ist ein Beispiel für ${descriptor}?`;
  }
  if (descriptorKey === "stufe") return comparisonPrompt(rows, row, descriptor, valueKey);
  return `Was ist die passende Angabe zu ${descriptor}?`;
}

function rowExplanation(section, rows, row, descriptorKey, descriptor, valueKey, answer) {
  if (descriptorKey === "person") return `${answer} ist die ${personLabel(descriptor)} von ${label(valueKey)} im ${tenseFromTitle(section.titel)}.`;
  if (descriptorKey === "kasus") return `${answer} ist der ${caseFormLabel(descriptor, valueKey)} von ${declensionHeadword(rows, valueKey)}.`;
  if (descriptorKey === "verb" && valueKey === "ppp") return `${answer} ist das PPP von ${descriptor}.`;
  return `Richtig ist: ${answer}.`;
}

function comparisonPrompt(rows, row, degree, valueKey) {
  const positive = rows.find(candidate => scalar(candidate.stufe).toLocaleLowerCase("de") === "positiv") || rows[0] || {};
  if (degree === "Positiv") {
    if (valueKey === "adjektiv") return `Welche lateinische Adjektivform bedeutet „${row.deutsch}“?`;
    if (valueKey === "adverb") return `Was ist das Adverb zu ${row.adjektiv}?`;
    if (valueKey === "deutsch") return `Was bedeutet ${row.adjektiv}?`;
  }
  const headword = scalar(positive[valueKey === "deutsch" ? "adjektiv" : valueKey]) || scalar(positive.adjektiv);
  return valueKey === "deutsch"
    ? `Wie wird der ${degree} von ${headword} übersetzt?`
    : `Was ist der ${degree} von ${headword} als ${valueKey === "adverb" ? "Adverb" : "Adjektiv"}?`;
}

function declensionHeadword(rows, valueKey) {
  const nominative = rows.find(row => /^Nominativ(?:\s|$)/i.test(scalar(row.kasus))) || rows[0] || {};
  if (["singular", "plural"].includes(valueKey)) return scalar(nominative.singular) || scalar(nominative.plural) || "diesem Wort";
  return scalar(nominative[valueKey]) || label(valueKey);
}

function caseFormLabel(descriptor, valueKey) {
  const expanded = String(descriptor).replace(/\bSg\./g, "Singular").replace(/\bPl\./g, "Plural");
  if (/\b(?:Singular|Plural)\b/.test(expanded)) return expanded;
  return `${expanded} ${capitalize(label(valueKey))}`;
}

function personLabel(value) {
  return String(value)
    .replace(/^(\d)\.\s*Sg\.$/, "$1. Person Singular")
    .replace(/^(\d)\.\s*Pl\.$/, "$1. Person Plural");
}

function pronounHeadword(forms, genderIndex, title) {
  return scalar(forms?.singular?.nominativ?.[genderIndex])
    || String(title).match(/pronomen\s+([^,\s]+)/i)?.[1]
    || sectionHeadword(title);
}

function sectionHeadword(title) {
  return String(title).split(/[–—]/).at(-1).trim().split(/[\s,]/)[0] || "diesem Wort";
}

function tenseFromTitle(title) {
  const match = String(title).match(/^(Präsens|Imperfekt|Futur I|Perfekt|Plusquamperfekt|Futur II)(?:\s+(Aktiv|Passiv))?\b/);
  return match ? [match[1], match[2]].filter(Boolean).join(" ") : "angegebenen Tempus";
}

function label(value) {
  return ({ esse: "esse", posse: "posse", ire: "ire", singular: "Singular", plural: "Plural", maskulin: "Maskulinum", feminin: "Femininum", neutrum: "Neutrum", deutsch: "Deutsch", beispiel: "Beispiel", ppp: "PPP", adjektiv: "Adjektiv", adverb: "Adverb" })[value] || String(value).replaceAll("_", " ");
}

function tenseLabel(value) {
  return ({ praesens: "Präsens", imperfekt: "Imperfekt", futur: "Futur I", perfekt: "Perfekt", plusquamperfekt: "Plusquamperfekt", ppa: "PPA" })[value] || value;
}

function scalar(value) {
  return ["string", "number"].includes(typeof value) ? String(value).trim() : "";
}

function sameForm(left, right) {
  return scalar(left).toLocaleLowerCase("de") === scalar(right).toLocaleLowerCase("de");
}

function distinctQuestions(questions) {
  const seen = new Set();
  return questions.filter(question => {
    const key = `${question.prompt}|${question.answer}`;
    if (!question.answer || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values) {
  return [...new Set(values.map(scalar).filter(Boolean))];
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function capitalize(value) {
  const text = String(value);
  return text ? text[0].toLocaleUpperCase("de") + text.slice(1) : text;
}
