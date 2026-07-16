import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPayPalSdkUrl,
  formatMonthlyPrice,
  isSandboxSubscriptionReady,
  paymentConfigStatus,
  validatePaymentConfig
} from "../payment.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const committedSource = readFileSync(resolve(root, "data/payment.json"), "utf8");
const committedConfig = JSON.parse(committedSource);
const activeAt = Date.parse("2030-01-01T00:00:00Z");
const readySandboxConfig = {
  ...committedConfig,
  enabled: true,
  clientId: "SandboxPublicClient_1234567890",
  planId: "P-0123456789ABCDEFGHIJ",
  expiresAt: "2030-01-01T01:00:00Z"
};

test("committed subscription is 4.99 EUR every month", () => {
  assert.equal(committedConfig.amount, "4.99");
  assert.equal(committedConfig.currency, "EUR");
  assert.equal(committedConfig.billingInterval, "MONTH");
  assert.equal(committedConfig.billingIntervalCount, 1);
  assert.equal(formatMonthlyPrice(committedConfig), "4,99 € monatlich");
});

test("the sandbox stays enabled without an expiry and optional expiry fails closed", () => {
  const validation = validatePaymentConfig(committedConfig, activeAt);
  assert.equal(validation.valid, true);
  assert.equal(validation.ready, true);
  assert.equal(validation.expired, false);
  assert.equal(isSandboxSubscriptionReady(committedConfig, activeAt), true);

  const beforeExpiry = Date.parse(readySandboxConfig.expiresAt) - 1;
  const afterExpiry = Date.parse(readySandboxConfig.expiresAt) + 1;
  assert.equal(isSandboxSubscriptionReady(readySandboxConfig, beforeExpiry), true);
  assert.equal(isSandboxSubscriptionReady(readySandboxConfig, afterExpiry), false);
  assert.equal(buildPayPalSdkUrl(readySandboxConfig, afterExpiry), null);
  assert.equal(paymentConfigStatus(readySandboxConfig, afterExpiry).state, "expired");
  assert.equal(buildPayPalSdkUrl({ ...readySandboxConfig, environment: "production" }, activeAt), null);
  assert.equal(buildPayPalSdkUrl({ ...readySandboxConfig, planId: "" }, activeAt), null);
});

test("an enabled sandbox configuration builds a subscription-only SDK URL", () => {
  assert.equal(validatePaymentConfig(readySandboxConfig, activeAt).ready, true);
  const url = new URL(buildPayPalSdkUrl(readySandboxConfig, activeAt));
  assert.equal(url.origin, "https://www.paypal.com");
  assert.equal(url.pathname, "/sdk/js");
  assert.equal(url.searchParams.get("client-id"), readySandboxConfig.clientId);
  assert.equal(url.searchParams.get("components"), "buttons");
  assert.equal(url.searchParams.get("vault"), "true");
  assert.equal(url.searchParams.get("intent"), "subscription");
  assert.equal(url.searchParams.get("currency"), "EUR");
});

test("the public config contains no email, secret or personal PayPal value", () => {
  assert.deepEqual(Object.keys(committedConfig).sort(), [
    "amount",
    "billingInterval",
    "billingIntervalCount",
    "clientId",
    "currency",
    "enabled",
    "environment",
    "expiresAt",
    "planId",
    "schemaVersion"
  ]);
  assert.equal(committedConfig.enabled, true);
  assert.equal(committedConfig.environment, "sandbox");
  assert.match(committedConfig.clientId, /^[A-Za-z0-9_-]{20,256}$/);
  assert.match(committedConfig.planId, /^P-[A-Z0-9]{10,64}$/);
  assert.equal(committedConfig.expiresAt, "");
  assert.doesNotMatch(committedSource, /@|email|secret|password|client[_-]?secret|merchant|payer|customer|webhook/i);

  const unsafeConfig = { ...readySandboxConfig, clientSecret: "do-not-commit" };
  assert.equal(validatePaymentConfig(unsafeConfig, activeAt).valid, false);
  assert.equal(buildPayPalSdkUrl(unsafeConfig, activeAt), null);

  for (const file of ["app.js", "README.md", "index.html", "data/payment.json"]) {
    const source = readFileSync(resolve(root, file), "utf8");
    assert.doesNotMatch(source, /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i, `${file} darf keine PayPal-Adresse veröffentlichen`);
  }
});
