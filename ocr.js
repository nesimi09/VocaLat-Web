const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const GENERIC_IMAGE_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);
const HEIC_FILE_NAME = /\.(?:heic|heif)$/i;

let workerPromise = null;
let progressListener = () => {};

export function validateOcrImage(file) {
  if (!(file instanceof File)) throw new Error("Bitte wähle ein Bild aus.");
  const type = String(file.type || "").toLocaleLowerCase("en");
  const supportedHeicName = HEIC_FILE_NAME.test(String(file.name || "")) && GENERIC_IMAGE_TYPES.has(type);
  if (!SUPPORTED_IMAGE_TYPES.has(type) && !supportedHeicName) throw new Error("Unterstützt werden JPEG-, PNG-, WebP- und HEIC-Bilder.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Das Bild darf höchstens 12 MB groß sein.");
}

export async function recognizeLatinText(file, onProgress = () => {}) {
  validateOcrImage(file);
  progressListener = onProgress;
  const worker = await getWorker();
  const source = await prepareOcrSource(file);
  const result = await worker.recognize(source, { rotateAuto: true });
  return {
    text: cleanOcrText(result.data.text),
    confidence: Number.isFinite(result.data.confidence) ? Math.round(result.data.confidence) : null
  };
}

async function prepareOcrSource(file) {
  if (typeof globalThis.createImageBitmap !== "function" || typeof document === "undefined") return file;
  let bitmap;
  try {
    bitmap = await globalThis.createImageBitmap(file);
    const maxEdge = 2800;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
    if (!context) return file;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.filter = "grayscale(1) contrast(1.24)";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
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
      preserve_interword_spaces: "1",
      user_defined_dpi: "300"
    });
    return worker;
  }).catch(error => {
    workerPromise = null;
    throw error;
  });

  return workerPromise;
}
