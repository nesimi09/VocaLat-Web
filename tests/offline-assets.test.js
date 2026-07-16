import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(resolve(root, "app.js"), "utf8");
const serviceWorkerSource = readFileSync(resolve(root, "service-worker.js"), "utf8");
const assetsBlock = serviceWorkerSource.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1] || "";
const shellAssets = [...assetsBlock.matchAll(/"\.\/([^"\n]*)"/g)].map(match => match[1]).filter(Boolean);
const largeRuntimeAssets = [
  "vendor/tesseract/worker.min.js",
  "vendor/tesseract/tesseract-core-lstm.wasm.js",
  "vendor/tesseract/lang-data/lat.traineddata.gz",
  "vendor/whitakers/data/DICTLINE.GEN.gz",
  "vendor/whitakers/data/DICTLINE.SUP",
  "vendor/whitakers/data/INFLECTS.LAT",
  "vendor/whitakers/data/ADDONS.LAT",
  "vendor/whitakers/data/UNIQUES.LAT"
];

test("every service-worker shell asset exists", () => {
  assert.ok(shellAssets.length >= 10);
  for (const asset of shellAssets) assert.ok(statSync(resolve(root, asset)).isFile(), `${asset} fehlt`);
  for (const courseAsset of ["course-engine.js", "course-access.js", "grammar-order.js", "payment.js", "data/course.json"]) {
    assert.equal(shellAssets.includes(courseAsset), true, `${courseAsset} muss zum Offline-App-Rahmen gehören`);
  }
});

test("the revocable access manifest is always fetched from the network and fails closed", () => {
  assert.equal(shellAssets.includes("data/course-access.json"), false);
  assert.match(serviceWorkerSource, /pathname\.endsWith\("\/data\/course-access\.json"\)/);
  assert.match(serviceWorkerSource, /cache:\s*"no-store"/);
  assert.match(serviceWorkerSource, /status:\s*503/);
});

test("the PayPal sandbox config is never served from an offline cache", () => {
  assert.equal(shellAssets.includes("data/payment.json"), false);
  assert.match(appSource, /fetch\("data\/payment\.json", \{ cache: "no-store" \}\)/);
  assert.match(serviceWorkerSource, /pathname\.endsWith\("\/data\/payment\.json"\)/);
  assert.match(serviceWorkerSource, /statusText:\s*"Payment config unavailable"/);
});

test("large local OCR and morphology assets use the lazy runtime cache", () => {
  assert.match(serviceWorkerSource, /const RUNTIME_CACHE = "vocalat-web-runtime-v\d+"/);
  assert.match(serviceWorkerSource, /caches\.open\(RUNTIME_CACHE\).*cache\.put\(event\.request/s);
  assert.match(serviceWorkerSource, /requestUrl\.origin !== self\.location\.origin/);

  for (const asset of largeRuntimeAssets) {
    assert.ok(statSync(resolve(root, asset)).isFile(), `${asset} fehlt`);
    assert.equal(shellAssets.includes(asset), false, `${asset} darf nicht beim Service-Worker-Install vorgeladen werden`);
  }

  const shellBytes = shellAssets.reduce((total, asset) => total + statSync(resolve(root, asset)).size, 0);
  const runtimeBytes = largeRuntimeAssets.reduce((total, asset) => total + statSync(resolve(root, asset)).size, 0);
  assert.ok(shellBytes < 2 * 1024 * 1024, `App-Shell ist mit ${shellBytes} Bytes zu groß`);
  assert.ok(runtimeBytes > 6 * 1024 * 1024, "Die erwarteten großen lokalen Laufzeitdateien fehlen");
});

test("OCR configuration uses only same-origin asset paths", () => {
  const source = readFileSync(resolve(root, "ocr.js"), "utf8");
  assert.equal(source.includes("https://"), false);
  assert.match(source, /vendor\/tesseract\/worker\.min\.js/);
  assert.match(source, /vendor\/tesseract\/lang-data/);
});

test("the bundled German fallback dictionary is attributed and substantial", () => {
  const dictionary = JSON.parse(readFileSync(resolve(root, "data/fallback-lexicon.json"), "utf8"));
  assert.equal(dictionary.source.name, "FreeDict Lateinisch-Deutsch");
  assert.equal(dictionary.source.license, "GPL-3.0-or-later");
  assert.ok(dictionary.entries.length >= 5_000);
  const license = readFileSync(resolve(root, "vendor/freedict/COPYING"), "utf8");
  assert.match(license, /GNU GENERAL PUBLIC LICENSE\s+Version 3/);
  assert.match(readFileSync(resolve(root, "scripts/build-fallback-lexicon.rb"), "utf8"), /"license" => "GPL-3\.0-or-later"/);
});

test("web progress is session-only and legacy permanent data is removed", () => {
  const source = readFileSync(resolve(root, "app.js"), "utf8");
  assert.match(source, /sessionStorage\.getItem\("vocalat-session-progress"\)/);
  assert.match(source, /sessionStorage\.setItem\("vocalat-session-progress"/);
  assert.match(source, /localStorage\.removeItem\("vocalat-progress"\)/);
  assert.match(source, /sessionStorage\.getItem\(COURSE_PROGRESS_KEY\)/);
  assert.match(source, /sessionStorage\.setItem\(COURSE_PROGRESS_KEY/);
  assert.match(source, /sessionStorage\.getItem\(COURSE_ACCESS_KEY\)/);
  assert.match(source, /sessionStorage\.setItem\(COURSE_ACCESS_KEY/);
  assert.doesNotMatch(source, /localStorage\.setItem/);
});

test("practice feedback keeps correct, wrong and neutral choices visually distinct", () => {
  const styles = readFileSync(resolve(root, "styles.css"), "utf8");
  assert.match(styles, /\.choice\.correct[^}]*background:\s*rgba\(62,138,79,\.18\)/s);
  assert.match(styles, /\.choice\.wrong[^}]*background:\s*rgba\(140,20,20,\.16\)/s);
  assert.doesNotMatch(styles, /\.choice\.idle\s*\{/);
});
