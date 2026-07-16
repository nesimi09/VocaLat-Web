import { grammarCategory } from "./grammar-order.js";

const PERSONS = ["1. Person Singular", "2. Person Singular", "3. Person Singular", "1. Person Plural", "2. Person Plural", "3. Person Plural"];
const DESCRIPTOR_KEYS = ["person", "kasus", "form", "stufe", "partizip", "verb"];
const GENDERS = ["Maskulinum", "Femininum", "Neutrum"];

export function buildGrammarPractice(sections, { category = null, limit = 10, random = Math.random } = {}) {
  const allowed = Array.isArray(sections)
    ? sections.filter(section => !category || grammarCategory(section) === category)
    : [];
  const bank = buildGrammarQuestionBank(allowed);
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
    const pool = unique(rows.map(row => scalar(row[key])).filter(Boolean));
    if (pool.length < 3) continue;
    for (const [rowIndex, row] of rows.entries()) {
      const answer = scalar(row[key]);
      const descriptor = scalar(row[descriptorKey]);
      if (!answer || !descriptor) continue;
      questions.push(makeQuestion({
        id: `${sectionIndex}-forms-${key}-${rowIndex}`,
        section,
        prompt: rowPrompt(section.titel, descriptorKey, descriptor, key),
        answer,
        pool,
        explanation: `${answer} gehört bei „${section.titel}“ zu ${descriptor}.`
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
        questions.push(makeQuestion({
          id: `${sectionIndex}-nested-${number}-${grammaticalCase}-${genderIndex}`,
          section,
          prompt: `Welche Form steht bei „${section.titel}“ im ${capitalize(grammaticalCase)} ${capitalize(number)} (${GENDERS[genderIndex] || `${genderIndex + 1}. Form`})?`,
          answer,
          pool,
          explanation: `${answer} ist die passende Form im ${capitalize(grammaticalCase)} ${capitalize(number)}.`
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
      prompt: `Wie lautet bei „${section.titel}“ die ${PERSONS[index] || `${index + 1}. Form`} im ${tenseLabel(key)}?`,
      answer,
      pool: forms,
      explanation: `${answer} ist die ${PERSONS[index] || `${index + 1}. Form`} im ${tenseLabel(key)}.`
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
        prompt: `Welche Form von ${row.verb || "diesem Verb"} gehört zur ${PERSONS[formIndex] || `${formIndex + 1}. Form`}?`,
        answer,
        pool,
        explanation: `${answer} ist hier die ${PERSONS[formIndex] || `${formIndex + 1}. Form`}.`
      }));
    });
  }
  return questions;
}

function questionsFromRules(sections) {
  const ruleKeys = ["bildung", "bildung_aktiv", "bildung_passiv", "hinweis", "bedeutung"];
  const questions = [];
  for (const key of ruleKeys) {
    const records = sections.map((section, index) => ({ section, index, answer: scalar(section[key]) }))
      .filter(record => record.answer && record.answer.length <= 120);
    if (records.length < 3) continue;
    const pool = records.map(record => record.answer);
    for (const record of records) questions.push(makeQuestion({
      id: `${record.index}-rule-${key}`,
      section: record.section,
      prompt: `Welche Aussage gehört zu „${record.section.titel}“?`,
      answer: record.answer,
      pool,
      explanation: `Diese Aussage gehört zur Regel „${record.section.titel}“.`
    }));
  }
  return questions;
}

function makeQuestion({ id, section, prompt, answer, pool, explanation }) {
  const distractors = unique(pool).filter(value => value !== answer).slice(0, 3);
  return {
    id,
    category: grammarCategory(section),
    sectionTitle: section.titel,
    prompt,
    answer: scalar(answer),
    options: unique([scalar(answer), ...distractors]),
    explanation
  };
}

function rowPrompt(title, descriptorKey, descriptor, valueKey) {
  if (descriptorKey === "person") return `Welche Form von ${label(valueKey)} gehört bei „${title}“ zu ${descriptor}?`;
  if (descriptorKey === "kasus") return `Welche ${label(valueKey)}-Form steht bei „${title}“ im ${descriptor}?`;
  return `Welche Angabe gehört bei „${title}“ zu ${descriptor} (${label(valueKey)})?`;
}

function label(value) {
  return ({ esse: "esse", posse: "posse", ire: "ire", singular: "Singular", plural: "Plural", maskulin: "Maskulinum", feminin: "Femininum", neutrum: "Neutrum", deutsch: "Deutsch", beispiel: "Beispiel", ppp: "PPP", adjektiv: "Adjektiv", adverb: "Adverb" })[value] || String(value).replaceAll("_", " ");
}

function tenseLabel(value) {
  return ({ praesens: "Präsens", imperfekt: "Imperfekt", futur: "Futur", perfekt: "Perfekt", plusquamperfekt: "Plusquamperfekt", ppa: "PPA" })[value] || value;
}

function scalar(value) {
  return ["string", "number"].includes(typeof value) ? String(value).trim() : "";
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
