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
  const lines = rawText
    .split(/\n+/)
    .map((line, index) => paragraphRecord(line, index, morphologyAnalyses))
    .filter(record => record.text);
  const paragraphGroup = bestLatinParagraphGroup(latinCandidates(paragraphs));
  const lineGroup = bestLatinParagraphGroup(latinCandidates(lines));
  const useLines = paragraphGroupWeight(lineGroup) > paragraphGroupWeight(paragraphGroup);
  const records = useLines ? lines : paragraphs;
  const mainGroup = useLines ? lineGroup : paragraphGroup;

  if (!mainGroup.length) {
    return { latinText: cleanLatinText(rawText), rawText, glossary, excludedParagraphs: 0, detected: false };
  }

  const selected = [...mainGroup];
  for (let index = selected.at(-1).index + 1; index < records.length; index += 1) {
    const paragraph = records.find(item => item.index === index);
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
    excludedParagraphs: Math.max(records.length - selected.length, 0),
    detected: selected.length < records.length
  };
}

function latinCandidates(records) {
  return records.filter(record => !record.glossary && record.tokenCount >= 4 && record.score >= .58 && record.germanCount === 0);
}

function bestLatinParagraphGroup(candidates) {
  const groups = [];
  for (const candidate of [...candidates].sort((left, right) => left.index - right.index)) {
    const group = groups.at(-1);
    if (!group || candidate.index - group.at(-1).index > 1) groups.push([candidate]);
    else group.push(candidate);
  }
  return groups.sort((left, right) => paragraphGroupWeight(right) - paragraphGroupWeight(left))[0] || [];
}

function paragraphGroupWeight(group) {
  return group.reduce((total, record) => total + record.tokenCount * record.score, 0);
}

export function extractGlossaryEntries(text) {
  const entries = [];
  const seen = new Set();
  for (const rawLine of String(text).split(/\n+/)) {
    const segments = rawLine.split(/;\s*(?=[\p{L}\p{M}]+(?:\s*,[^;]*)?\s+-\s+)/u);
    for (const segment of segments) {
      const line = segment.trim().replace(/^[^\p{L}]+/u, "");
      const match = line.match(/^([\p{L}\p{M}]+)((?:\s*,\s*(?:-?[\p{L}\p{M}]+))*)\s*(=|»|7|:|\s+-\s+)\s*(.+)$/iu);
      if (!match) continue;
      if (match[3] === ":" && /^\p{Lu}/u.test(line) && !/,\s*-/.test(line)) continue;
      const lemma = normalizeLatinWord(match[1]);
      const forms = [lemma, ...match[2].split(",").map(normalizeLatinWord).filter(form => form && !["m", "f", "n"].includes(form))];
      const meaning = cleanGlossaryMeaning(match[4]);
      if (!lemma || !meaning || seen.has(lemma)) continue;
      seen.add(lemma);
      entries.push({ lemma, forms: [...new Set(forms)], pos: inferGlossaryPart(line), meanings: [meaning], source: "glossary" });
    }
  }
  return entries;
}

function paragraphRecord(paragraph, index, morphologyAnalyses) {
  const text = candidateParagraphText(paragraph);
  const tokens = tokenizeLatinText(text);
  const normalized = tokens.map(token => token.normalized);
  const recognizedCount = normalized.filter(token => (morphologyAnalyses.get(token) || []).length > 0).length;
  const germanCount = normalized.filter(token => GERMAN_MARKERS.has(token)).length;
  const latinMarkerCount = normalized.filter(token => LATIN_MARKERS.has(token)).length;
  const tokenCount = tokens.length;
  const recognitionRatio = tokenCount ? recognizedCount / tokenCount : 0;
  const score = recognitionRatio + Math.min(latinMarkerCount / Math.max(tokenCount, 1), .2) - Math.min(germanCount / Math.max(tokenCount, 1) * 1.5, .8);
  return { index, text, tokenCount, recognizedCount, germanCount, score, glossary: !text && String(paragraph).trim().length > 0 };
}

function candidateParagraphText(value) {
  return String(value)
    .split(/\n+/)
    .map(line => cleanPageNoise(line))
    .filter(line => line && !looksLikeGlossary(line) && !looksLikeGermanFootnote(line))
    .join(" ")
    .trim();
}

function looksLikeGermanFootnote(value) {
  const line = String(value).trim();
  if (!/^["'!²³\d*]/u.test(line)) return false;
  const normalized = tokenizeLatinText(line).map(token => token.normalized);
  return normalized.filter(token => GERMAN_MARKERS.has(token)).length > 0;
}

function cleanPageNoise(value) {
  return String(value)
    .replace(/\(\s*\d+\s+W[\p{L}\p{M}]+\s*\)/giu, "")
    .replace(/^\s*(?:\d+(?:\^?\s*A)?|[nNsS](?=\s+\p{Lu}))\s+/u, "")
    .replace(/^\s*[:;|]+\s*(?=\p{Lu})/u, "")
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
  const match = line.match(/^["'!²³\d]*\s*[\p{L}\p{M}]+(?:\s*,\s*[-\p{L}\p{M}]+)*(?:\s*,\s*[mfn])?\s*(=|»|7|:|\s+-\s+)/iu);
  if (!match) return false;
  return match[1] !== ":" || !/^\s*["'!²³\d]*\s*\p{Lu}/u.test(line) || /,\s*-/.test(line);
}

function cleanGlossaryMeaning(value) {
  return String(value)
    .replace(/^[\s»=:\-]+/, "")
    .trim();
}

function inferGlossaryPart(line) {
  if (/\b[mfn]\b/i.test(line)) return "n";
  if (/(?:are|ere|ire)\b/i.test(line)) return "v";
  return "x";
}
