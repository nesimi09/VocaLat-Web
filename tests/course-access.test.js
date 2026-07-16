import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createCourseAccessSession,
  normalizeCourseAccessCode,
  verifyCourseAccessCode,
  verifyCourseAccessSession
} from "../course-access.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_ONLY_CODE = "VL1-23456-789AB-2222-2222-2222-2222-2222-2222-2222-2222";
const TEST_NORMALIZED_CODE = "VL123456789AB22222222222222222222222222222222";
const ACCESS_DIGEST_NAMESPACE = "VocaLat/course-access/access-digest/v1";
const SESSION_PROOF_NAMESPACE = "VocaLat/course-access/session-proof/v1";
const SESSION_VERIFIER_NAMESPACE = "VocaLat/course-access/session-verifier/v1";

const testRecord = makeRecord(TEST_NORMALIZED_CODE, "course-0001", 7);
const testManifest = { schemaVersion: 1, revision: 7, active: true, records: [testRecord] };

test("course-code normalization is stable and rejects malformed input", () => {
  assert.equal(normalizeCourseAccessCode(TEST_ONLY_CODE), TEST_NORMALIZED_CODE);
  assert.equal(normalizeCourseAccessCode(`  vl1 23456 789ab ${"2222 ".repeat(8)} `), TEST_NORMALIZED_CODE);
  assert.equal(normalizeCourseAccessCode(TEST_ONLY_CODE.replace(/2/g, "O")), TEST_NORMALIZED_CODE.replace(/2/g, "0"));
  assert.equal(normalizeCourseAccessCode("VL1-too-short"), "");
  assert.equal(normalizeCourseAccessCode(`VL1-${"A".repeat(200)}`), "");
  assert.equal(normalizeCourseAccessCode(null), "");
});

test("a fixed valid vector succeeds and a wrong code fails", async () => {
  assert.equal(testRecord.accessDigest, "50d220a9412dc1548e3e898248d4d3207138013756c9fa3a2dd90a9384f01478");
  assert.equal(testRecord.sessionVerifier, "5324843b97177c36e3ead4c8330c70aa556a4261f3776b4b06d4a5c9f3b372ac");
  assert.equal(await verifyCourseAccessCode(TEST_ONLY_CODE, testManifest, webcrypto), testRecord);
  const wrongCode = TEST_ONLY_CODE.replace(/2222$/, "2223");
  assert.equal(await verifyCourseAccessCode(wrongCode, testManifest, webcrypto), null);
  assert.equal(await verifyCourseAccessCode(TEST_ONLY_CODE, { ...testManifest, active: false }, webcrypto), null);
});

test("session proof survives reload validation and public values cannot forge it", async () => {
  const session = await createCourseAccessSession(TEST_ONLY_CODE, testRecord, webcrypto);
  assert.ok(session);
  assert.equal(Object.hasOwn(session, "code"), false);
  assert.equal(await verifyCourseAccessSession(JSON.parse(JSON.stringify(session)), testManifest, webcrypto), testRecord);

  assert.equal(await verifyCourseAccessSession({ ...session, proof: testRecord.sessionVerifier }, testManifest, webcrypto), null);
  assert.equal(await verifyCourseAccessSession({ ...session, proof: testRecord.accessDigest }, testManifest, webcrypto), null);
  assert.equal(await verifyCourseAccessSession({ ...session, proof: "0".repeat(64) }, testManifest, webcrypto), null);
  assert.equal(await verifyCourseAccessSession({ ...session, recordRevision: 8 }, testManifest, webcrypto), null);
  assert.equal(await createCourseAccessSession(TEST_ONLY_CODE.replace(/2222$/, "2223"), testRecord, webcrypto), null);
});

test("the committed manifest is generic, active and contains no plaintext code or identity", () => {
  const source = readFileSync(resolve(root, "data/course-access.json"), "utf8");
  const manifest = JSON.parse(source);
  assert.deepEqual(Object.keys(manifest).sort(), ["active", "records", "revision", "schemaVersion"]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.active, true);
  assert.ok(Number.isSafeInteger(manifest.revision) && manifest.revision > 0);
  assert.equal(manifest.records.length, 6);
  assert.doesNotMatch(source, /VL1-[0-9A-Z-]{32,}/);
  assert.doesNotMatch(source, /email|customer|kunde|name|label|plaintext/i);

  const ids = new Set();
  const digests = new Set();
  for (const record of manifest.records) {
    assert.deepEqual(Object.keys(record).sort(), ["accessDigest", "active", "id", "revision", "sessionVerifier"]);
    assert.match(record.id, /^course-\d{4}$/);
    assert.match(record.accessDigest, /^[0-9a-f]{64}$/);
    assert.match(record.sessionVerifier, /^[0-9a-f]{64}$/);
    assert.equal(record.active, true);
    assert.ok(Number.isSafeInteger(record.revision) && record.revision > 0);
    ids.add(record.id);
    digests.add(record.accessDigest);
  }
  assert.equal(ids.size, 6);
  assert.equal(digests.size, 6);
});

test("generator refuses private output anywhere inside the workspace", () => {
  const generatorSource = readFileSync(resolve(root, "scripts/generate-course-codes.mjs"), "utf8");
  assert.match(generatorSource, /randomBytes\(20\)/);
  assert.doesNotMatch(generatorSource, /Math\.random|console\.(?:log|info)/);
  assert.match(generatorSource, /"Library", "Application Support", "VocaLat", "private", "access-codes\.csv"/);
  assert.match(generatorSource, /0o700/);
  assert.match(generatorSource, /0o600/);

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vocalat-course-code-safety-"));
  const unsafePrivatePath = resolve(root, "tests", "should-never-exist-course-codes.csv");
  const publicPath = join(temporaryDirectory, "course-access.json");
  try {
    const result = spawnSync(process.execPath, [
      resolve(root, "scripts/generate-course-codes.mjs"),
      "--count", "1",
      "--private-out", unsafePrivatePath,
      "--public-out", publicPath
    ], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the repository and workspace/);
    assert.equal(existsSync(unsafePrivatePath), false);
    assert.equal(existsSync(publicPath), false);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /VL1-[0-9A-Z-]{32,}/);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    rmSync(unsafePrivatePath, { force: true });
  }
});

function makeRecord(normalizedCode, id, revision) {
  const proof = sha256(Buffer.from(`${SESSION_PROOF_NAMESPACE}\0${normalizedCode}`, "utf8"));
  return {
    id,
    accessDigest: sha256(Buffer.from(`${ACCESS_DIGEST_NAMESPACE}\0${normalizedCode}`, "utf8")).toString("hex"),
    sessionVerifier: sha256(Buffer.concat([Buffer.from(`${SESSION_VERIFIER_NAMESPACE}\0`, "utf8"), proof])).toString("hex"),
    active: true,
    revision
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}
