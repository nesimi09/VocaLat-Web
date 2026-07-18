const MAX_HINTS = 180;

export function bookVocabularyHints(analysis) {
  const seen = new Set();
  const hints = [];
  const candidates = (analysis?.matches || [])
    .flatMap((match, matchIndex) => preferredHintEntries(match.entries).map(entry => ({ match, matchIndex, entry })))
    .sort((left, right) => hintPriority(left.entry) - hintPriority(right.entry) || left.matchIndex - right.matchIndex);
  for (const { match, entry } of candidates) {
    const latin = String(entry.latein || entry.lemma || match.token || "").trim();
    const meanings = entry.deutsch ? [entry.deutsch] : entry.meanings || [];
    for (const meaning of meanings) {
      const german = String(meaning || "").trim();
      const key = `${latin.toLocaleLowerCase("la")}|${german.toLocaleLowerCase("de")}`;
      if (!latin || !german || seen.has(key)) continue;
      seen.add(key);
      hints.push({
        token: String(match.token || "").trim(),
        latin,
        german,
        grammar: String(entry.grammatik || "").trim(),
        source: entry.source === "book"
          ? `Buch Lektion ${entry.lektion || "?"}`
          : entry.source === "glossary" ? "Bildfußnote" : "Lokales Wörterbuch"
      });
      if (hints.length >= MAX_HINTS) return hints;
    }
  }
  return hints;
}

function preferredHintEntries(entries = []) {
  const usable = entries.filter(entry => entry && !["proper", "proper-context"].includes(entry.source));
  const textbook = usable.filter(entry => entry.source === "book");
  if (textbook.length) return textbook;
  const glossary = usable.filter(entry => entry.source === "glossary");
  return glossary.length ? glossary : usable;
}

function hintPriority(entry) {
  return entry.source === "book" ? 0 : entry.source === "glossary" ? 1 : 2;
}

export async function requestLocalModelTranslation({ latinText, rawOcrText = "", imageFile = null, imageDataUrl = "", analysis, signal, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function" || (!String(latinText || "").trim() && !imageFile && !imageDataUrl)) return null;
  try {
    let image = imageDataUrl;
    if (!image && imageFile) {
      try { image = await imageForLocalModel(imageFile); }
      catch { image = ""; }
    }
    const response = await fetchImpl("./api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        latinText: String(latinText).trim(),
        rawOcrText: String(rawOcrText || "").trim(),
        ...(image ? { image } : {}),
        bookVocabulary: bookVocabularyHints(analysis)
      }),
      signal
    });
    // A static GitHub Pages deployment intentionally has no API route.
    if ([404, 405, 501].includes(response.status)) return null;
    if (!response.ok) return null;
    const payload = await response.json();
    const translation = String(payload?.translation || "").trim();
    if (!translation) return null;
    return {
      translation,
      normalizedLatin: String(payload.normalizedLatin || "").trim(),
      confidence: clampConfidence(payload.confidence),
      warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String).filter(Boolean).slice(0, 8) : [],
      model: String(payload.model || "lokales Modell")
    };
  } catch {
    return null;
  }
}

export async function imageForLocalModel(file) {
  if (!file || typeof document === "undefined") return "";
  const bitmap = await decodeBrowserImage(file);
  try {
    const maxEdge = 2200;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return "";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .94));
    return blob ? blobToDataUrl(blob) : "";
  } finally {
    bitmap.close?.();
  }
}

async function decodeBrowserImage(file) {
  if (typeof globalThis.createImageBitmap === "function") {
    try { return await globalThis.createImageBitmap(file); }
    catch { /* Safari can decode some HEIC files through an image element instead. */ }
  }
  if (typeof globalThis.Image !== "function" || typeof globalThis.URL?.createObjectURL !== "function") throw new Error("Bildformat kann in diesem Browser nicht gelesen werden.");
  const url = globalThis.URL.createObjectURL(file);
  const image = new globalThis.Image();
  try {
    image.src = url;
    await image.decode();
    image.width = image.naturalWidth;
    image.height = image.naturalHeight;
    image.close = () => globalThis.URL.revokeObjectURL(url);
    return image;
  } catch (error) {
    globalThis.URL.revokeObjectURL(url);
    throw error;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("Bild konnte nicht vorbereitet werden.")), { once: true });
    reader.readAsDataURL(blob);
  });
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return .75;
  return Math.max(0, Math.min(1, number));
}
