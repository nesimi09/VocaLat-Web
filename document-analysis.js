import { normalizeLatinWord, tokenizeLatinText } from "./learning-engine.js";

const GERMAN_MARKERS = new Set([
  "aber", "alle", "als", "anderem", "auf", "aus", "bekannt", "berichtet", "das", "den", "der", "des", "die", "dieser", "diese",
  "eigenen", "einer", "einen", "er", "es", "flus", "fluss", "fur", "für", "griechische", "ist", "kraft", "mit", "muss", "nicht",
  "oder", "schafft", "schreibt", "seinen", "seiner", "sich", "sind", "uber", "über", "und", "unter", "von", "wahrend", "während",
  "welche", "wenig", "wird", "wollen", "worter", "wörter", "zuruckgreifen", "zurückgreifen"
]);

const LATIN_MARKERS = new Set([
  "ab", "ad", "cum", "de", "eius", "est", "et", "ex", "hoc", "id", "ille", "in", "ne", "non", "per", "quam", "qui", "se", "sed", "si", "sunt", "suum", "ut"
]);

export function extractLatinDocument(text, morphologyAnalyses = new Map()) {
  const rawText = String(text).trim();
  const glossary = extractGlossaryEntries(rawText);
  const paragraphs = rawText
    .split(/\n\s*\n+/)
    .map((paragraph, index) => paragraphRecord(paragraph, index, morphologyAnalyses))
    .filter(record => record.text);
  const candidates = paragraphs.filter(record => !record.glossary && record.tokenCount >= 4 && record.score >= .58 && record.germanCount === 0);
  const main = candidates.sort((left, right) => right.tokenCount * right.score - left.tokenCount * left.score)[0];

  if (!main) {
    return { latinText: cleanLatinText(rawText), rawText, glossary, excludedParagraphs: 0, detected: false };
  }

  const selected = [main];
  for (let index = main.index + 1; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs.find(item => item.index === index);
    if (!paragraph || paragraph.glossary) break;
    const previous = selected.at(-1);
    const continuation = !/[.!?;:]\s*$/.test(previous.text) && paragraph.recognizedCount > 0 && paragraph.germanCount === 0;
    const anotherLatinParagraph = paragraph.tokenCount >= 4 && paragraph.score >= .58 && paragraph.germanCount === 0;
    if (!continuation && !anotherLatinParagraph) break;
    selected.push(paragraph);
  }

  return {
    latinText: cleanLatinText(selected.map(record => record.text).join("\n")),
    rawText,
    glossary,
    excludedParagraphs: Math.max(paragraphs.length - selected.length, 0),
    detected: selected.length < paragraphs.length
  };
}

export function extractGlossaryEntries(text) {
  const entries = [];
  const seen = new Set();
  for (const rawLine of String(text).split(/\n+/)) {
    const line = rawLine.trim().replace(/^[^\p{L}]+/u, "");
    const match = line.match(/^([\p{L}\p{M}]+)(?:\s*,\s*-[\p{L}\p{M}]+)?(?:\s*,\s*[mfn])?\s*(=|»|7|:)\s*(.+)$/iu);
    if (!match) continue;
    if (match[2] === ":" && /^\p{Lu}/u.test(line) && !/,\s*-/.test(line)) continue;
    const lemma = normalizeLatinWord(match[1]);
    const meaning = cleanGlossaryMeaning(match[3]);
    if (!lemma || !meaning || seen.has(lemma)) continue;
    seen.add(lemma);
    entries.push({ lemma, forms: [lemma], pos: inferGlossaryPart(line), meanings: [meaning], source: "glossary" });
  }
  return entries;
}

function paragraphRecord(paragraph, index, morphologyAnalyses) {
  const text = cleanPageNoise(paragraph);
  const tokens = tokenizeLatinText(text);
  const normalized = tokens.map(token => token.normalized);
  const recognizedCount = normalized.filter(token => (morphologyAnalyses.get(token) || []).length > 0).length;
  const germanCount = normalized.filter(token => GERMAN_MARKERS.has(token)).length;
  const latinMarkerCount = normalized.filter(token => LATIN_MARKERS.has(token)).length;
  const tokenCount = tokens.length;
  const recognitionRatio = tokenCount ? recognizedCount / tokenCount : 0;
  const score = recognitionRatio + Math.min(latinMarkerCount / Math.max(tokenCount, 1), .2) - Math.min(germanCount / Math.max(tokenCount, 1) * 1.5, .8);
  return { index, text, tokenCount, recognizedCount, germanCount, score, glossary: looksLikeGlossary(paragraph) };
}

function cleanPageNoise(value) {
  return String(value)
    .replace(/\(\s*\d+\s+W[\p{L}\p{M}]+\s*\)/giu, "")
    .replace(/^\s*["'!]+/, "")
    .trim();
}

function cleanLatinText(value) {
  return cleanPageNoise(value)
    .replace(/([\p{Ll}]{3,})[!?](?=\s*[,;:]?\s+\p{Ll})/gu, "$1")
    .replace(/([\p{L}\p{M}])\d+(?=\s|$)/gu, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function looksLikeGlossary(value) {
  const line = String(value).trim();
  const match = line.match(/^["'!²³\d]*\s*[\p{L}\p{M}]+(?:\s*,\s*-[\p{L}\p{M}]+)?(?:\s*,\s*[mfn])?\s*(=|»|7|:)/iu);
  if (!match) return false;
  return match[1] !== ":" || !/^\s*["'!²³\d]*\s*\p{Lu}/u.test(line) || /,\s*-/.test(line);
}

function cleanGlossaryMeaning(value) {
  const cleaned = String(value).replace(/^[\s»=:\-]+/, "").trim();
  const corrections = new Map([["verschmiühen", "verschmähen"], ["verschmahen", "verschmähen"]]);
  return corrections.get(cleaned.toLocaleLowerCase("de")) || cleaned;
}

function inferGlossaryPart(line) {
  if (/\b[mfn]\b/i.test(line)) return "n";
  if (/(?:are|ere|ire)\b/i.test(line)) return "v";
  return "x";
}
