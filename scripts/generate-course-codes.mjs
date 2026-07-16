#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCourseAccessCode } from "../course-access.js";

const ACCESS_DIGEST_NAMESPACE = "VocaLat/course-access/access-digest/v1";
const SESSION_PROOF_NAMESPACE = "VocaLat/course-access/session-proof/v1";
const SESSION_VERIFIER_NAMESPACE = "VocaLat/course-access/session-verifier/v1";
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(repoRoot, "..");
const defaultPublicPath = join(repoRoot, "data", "course-access.json");
const defaultPrivatePath = join(homedir(), "Library", "Application Support", "VocaLat", "private", "access-codes.csv");

const options = parseArguments(process.argv.slice(2));
const publicPath = resolve(options.publicOut || defaultPublicPath);
const privatePath = resolve(options.privateOut || defaultPrivatePath);

try {
  assertPrivateOutputSafety(privatePath, publicPath);
  assertOutputAvailability(publicPath, privatePath, options.force);

  const records = [];
  const privateRows = [["id", "code", "active", "revision"]];
  const seenCodes = new Set();

  for (let index = 1; index <= options.count; index += 1) {
    let code;
    do code = generateCode(); while (seenCodes.has(code));
    seenCodes.add(code);

    const id = `course-${String(index).padStart(4, "0")}`;
    const normalized = normalizeCourseAccessCode(code);
    const proof = sha256Buffer(Buffer.from(`${SESSION_PROOF_NAMESPACE}\0${normalized}`, "utf8"));
    records.push({
      id,
      accessDigest: sha256Hex(Buffer.from(`${ACCESS_DIGEST_NAMESPACE}\0${normalized}`, "utf8")),
      sessionVerifier: sha256Hex(Buffer.concat([Buffer.from(`${SESSION_VERIFIER_NAMESPACE}\0`, "utf8"), proof])),
      active: true,
      revision: options.revision
    });
    privateRows.push([id, code, "true", String(options.revision)]);
  }

  const manifest = {
    schemaVersion: 1,
    revision: options.revision,
    active: true,
    records
  };

  writePrivateCsv(privatePath, privateRows, options.force);
  try {
    writePublicManifest(publicPath, manifest, options.force);
  } catch (error) {
    rmSync(privatePath, { force: true });
    throw error;
  }
} catch (error) {
  process.stderr.write(`Course-code generation failed: ${error.message}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const result = { count: 6, revision: 1, publicOut: "", privateOut: "", force: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--force") result.force = true;
    else if (["--count", "--revision", "--public-out", "--private-out"].includes(argument)) {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--count") result.count = parsePositiveInteger(value, "count", 1_000);
      if (argument === "--revision") result.revision = parsePositiveInteger(value, "revision", Number.MAX_SAFE_INTEGER);
      if (argument === "--public-out") result.publicOut = value;
      if (argument === "--private-out") result.privateOut = value;
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return result;
}

function parsePositiveInteger(value, label, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`${label} must be a positive integer no greater than ${maximum}`);
  return parsed;
}

function assertPrivateOutputSafety(candidate, publicOutput) {
  const canonicalPrivate = canonicalPotentialPath(candidate);
  const canonicalRepo = realpathSync(repoRoot);
  const canonicalWorkspace = realpathSync(workspaceRoot);
  if (inside(canonicalPrivate, canonicalRepo) || inside(canonicalPrivate, canonicalWorkspace)) {
    throw new Error("private output must be outside the repository and workspace");
  }
  if (canonicalPrivate === canonicalPotentialPath(publicOutput)) throw new Error("private and public output paths must differ");
}

function assertOutputAvailability(publicOutput, privateOutput, force) {
  if (!force && existsSync(publicOutput)) throw new Error("public output already exists; pass --force to replace it");
  if (!force && existsSync(privateOutput)) throw new Error("private output already exists; pass --force to replace it");
}

function canonicalPotentialPath(candidate) {
  const absolute = resolve(candidate);
  let ancestor = absolute;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const canonicalAncestor = existsSync(ancestor) ? realpathSync(ancestor) : ancestor;
  return resolve(canonicalAncestor, relative(ancestor, absolute));
}

function inside(candidate, parent) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

function generateCode() {
  const lookupId = encodeCrockford(randomBytes(7)).slice(0, 10);
  const secret = encodeCrockford(randomBytes(20));
  const groupedSecret = secret.match(/.{1,4}/g).join("-");
  return `VL1-${lookupId}-${groupedSecret}`;
}

function encodeCrockford(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= (1 << bits) - 1;
    }
  }
  if (bits) output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest();
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writePrivateCsv(path, rows, force) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const csv = `${rows.map(row => row.map(csvCell).join(",")).join("\n")}\n`;
  writeFileSync(path, csv, { encoding: "utf8", flag: force ? "w" : "wx", mode: 0o600 });
  chmodSync(path, 0o600);
  if ((statSync(path).mode & 0o777) !== 0o600) throw new Error("could not enforce private file mode 0600");
}

function writePublicManifest(path, manifest, force) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 });
    if (!force && existsSync(path)) throw new Error("public output already exists; pass --force to replace it");
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function csvCell(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
