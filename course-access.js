const ACCESS_DIGEST_NAMESPACE = "VocaLat/course-access/access-digest/v1";
const SESSION_PROOF_NAMESPACE = "VocaLat/course-access/session-proof/v1";
const SESSION_VERIFIER_NAMESPACE = "VocaLat/course-access/session-verifier/v1";
const CODE_PREFIX = "VL1";
const CODE_ID_LENGTH = 10;
const CODE_SECRET_LENGTH = 32;
const CROCKFORD_PATTERN = /^[0-9A-HJKMNP-TV-Z]+$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

const encoder = new TextEncoder();

/**
 * Return the canonical form used by every digest operation.
 *
 * Display codes use hyphens for readability, while their canonical form is
 * `VL1` followed by a 10-character lookup id and a 32-character, 160-bit
 * Crockford-Base32 secret. Ambiguous Crockford aliases are accepted only in
 * the code body, never in the fixed prefix.
 */
export function normalizeCourseAccessCode(input) {
  if (typeof input !== "string" || input.length > 128) return "";

  const compact = input.normalize("NFKC").toUpperCase().replace(/[\s-]+/g, "");
  if (!compact.startsWith(CODE_PREFIX)) return "";

  const body = compact.slice(CODE_PREFIX.length).replace(/O/g, "0").replace(/[IL]/g, "1");
  if (body.length !== CODE_ID_LENGTH + CODE_SECRET_LENGTH || !CROCKFORD_PATTERN.test(body)) return "";
  return `${CODE_PREFIX}${body}`;
}

/**
 * Validate a plaintext code against the public manifest.
 * Returns the matching active record, or null for every invalid input.
 */
export async function verifyCourseAccessCode(input, manifest, cryptoImpl) {
  const normalized = normalizeCourseAccessCode(input);
  const records = activeManifestRecords(manifest);
  if (!normalized || !records.length) return null;

  const digest = await digestText(`${ACCESS_DIGEST_NAMESPACE}\0${normalized}`, cryptoImpl);
  const matches = records.filter(record => safeHexEqual(record.accessDigest, digest));
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Create the bearer proof kept in sessionStorage after a code was verified.
 * The proof is namespace-separated from the public access digest. Its hash,
 * not the proof itself, is present in the public manifest.
 */
export async function createCourseAccessSession(input, record, cryptoImpl) {
  const normalized = normalizeCourseAccessCode(input);
  if (!normalized || !validRecord(record) || record.active !== true) return null;

  const accessDigest = await digestText(`${ACCESS_DIGEST_NAMESPACE}\0${normalized}`, cryptoImpl);
  if (!safeHexEqual(record.accessDigest, accessDigest)) return null;

  const proofBytes = await digestBytes(encoder.encode(`${SESSION_PROOF_NAMESPACE}\0${normalized}`), cryptoImpl);
  const verifier = await digestNamespacedBytes(SESSION_VERIFIER_NAMESPACE, proofBytes, cryptoImpl);
  if (!safeHexEqual(record.sessionVerifier, bytesToHex(verifier))) return null;

  return {
    schemaVersion: 1,
    recordId: record.id,
    recordRevision: record.revision,
    proof: bytesToHex(proofBytes)
  };
}

/**
 * Revalidate a sessionStorage value without retaining the original code.
 * Returns the corresponding active manifest record, or null if the proof,
 * record id, revision, or manifest state is invalid.
 */
export async function verifyCourseAccessSession(session, manifest, cryptoImpl) {
  const records = activeManifestRecords(manifest);
  if (!validSession(session) || !records.length) return null;

  const matches = records.filter(record => record.id === session.recordId && record.revision === session.recordRevision);
  if (matches.length !== 1) return null;

  const proofBytes = hexToBytes(session.proof);
  if (!proofBytes) return null;

  const verifier = await digestNamespacedBytes(SESSION_VERIFIER_NAMESPACE, proofBytes, cryptoImpl);
  return safeHexEqual(matches[0].sessionVerifier, bytesToHex(verifier)) ? matches[0] : null;
}

function activeManifestRecords(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.active !== true || !positiveInteger(manifest.revision) || !Array.isArray(manifest.records)) return [];
  if (manifest.records.some(record => !validRecord(record))) return [];
  return manifest.records.filter(record => record.active === true);
}

function validRecord(record) {
  return Boolean(
    record &&
    typeof record.id === "string" &&
    /^course-\d{4}$/.test(record.id) &&
    SHA256_HEX_PATTERN.test(record.accessDigest || "") &&
    SHA256_HEX_PATTERN.test(record.sessionVerifier || "") &&
    typeof record.active === "boolean" &&
    positiveInteger(record.revision)
  );
}

function validSession(session) {
  return Boolean(
    session &&
    session.schemaVersion === 1 &&
    typeof session.recordId === "string" &&
    positiveInteger(session.recordRevision) &&
    SHA256_HEX_PATTERN.test(session.proof || "")
  );
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

async function digestText(value, cryptoImpl) {
  return bytesToHex(await digestBytes(encoder.encode(value), cryptoImpl));
}

async function digestNamespacedBytes(namespace, value, cryptoImpl) {
  const prefix = encoder.encode(`${namespace}\0`);
  const input = new Uint8Array(prefix.length + value.length);
  input.set(prefix);
  input.set(value, prefix.length);
  return digestBytes(input, cryptoImpl);
}

async function digestBytes(value, cryptoImpl) {
  const subtle = cryptoImpl?.subtle || cryptoImpl || globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") throw new Error("Web Crypto ist in diesem Browser nicht verfügbar.");
  return new Uint8Array(await subtle.digest("SHA-256", value));
}

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value) {
  if (!SHA256_HEX_PATTERN.test(value || "")) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function safeHexEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
