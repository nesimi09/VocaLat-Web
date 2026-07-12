const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

let workerPromise = null;
let progressListener = () => {};

export function validateOcrImage(file) {
  if (!(file instanceof File)) throw new Error("Bitte wähle ein Bild aus.");
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error("Unterstützt werden JPEG-, PNG- und WebP-Bilder.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Das Bild darf höchstens 12 MB groß sein.");
}

export async function recognizeLatinText(file, onProgress = () => {}) {
  validateOcrImage(file);
  progressListener = onProgress;
  const worker = await getWorker();
  const result = await worker.recognize(file, { rotateAuto: true });
  return {
    text: cleanOcrText(result.data.text),
    confidence: Number.isFinite(result.data.confidence) ? Math.round(result.data.confidence) : null
  };
}

export function cleanOcrText(value = "") {
  return String(value)
    .replace(/-\s*\n\s*/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function getWorker() {
  if (workerPromise) return workerPromise;
  if (!globalThis.Tesseract?.createWorker) {
    throw new Error("Das lokale OCR-Modul konnte nicht geladen werden.");
  }

  const assetUrl = path => new URL(path, document.baseURI).href;
  workerPromise = globalThis.Tesseract.createWorker("lat", globalThis.Tesseract.OEM.LSTM_ONLY, {
    workerPath: assetUrl("vendor/tesseract/worker.min.js"),
    corePath: assetUrl("vendor/tesseract/tesseract-core-lstm.wasm.js"),
    langPath: assetUrl("vendor/tesseract/lang-data"),
    logger: message => progressListener(message)
  }).then(async worker => {
    await worker.setParameters({
      tessedit_pageseg_mode: globalThis.Tesseract.PSM.AUTO,
      preserve_interword_spaces: "1"
    });
    return worker;
  }).catch(error => {
    workerPromise = null;
    throw error;
  });

  return workerPromise;
}
