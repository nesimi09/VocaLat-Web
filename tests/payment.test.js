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
const readySandboxConfig = {
  ...committedConfig,
  enabled: true,
  clientId: "SandboxPublicClient_1234567890",
  planId: "P-0123456789ABCDEFGHIJ"
};

test("committed subscription is 4.99 EUR every month", () => {
  assert.equal(committedConfig.amount, "4.99");
  assert.equal(committedConfig.currency, "EUR");
  assert.equal(committedConfig.billingInterval, "MONTH");
  assert.equal(committedConfig.billingIntervalCount, 1);
  assert.equal(formatMonthlyPrice(committedConfig), "4,99 € monatlich");
});

test("the GitHub Pages prototype is disabled and fails closed by default", () => {
  const validation = validatePaymentConfig(committedConfig);
  assert.equal(validation.valid, true);
  assert.equal(validation.ready, false);
  assert.equal(isSandboxSubscriptionReady(committedConfig), false);
  assert.equal(buildPayPalSdkUrl(committedConfig), null);
  assert.equal(paymentConfigStatus(committedConfig).state, "disabled");
  assert.equal(buildPayPalSdkUrl({ ...readySandboxConfig, environment: "production" }), null);
  assert.equal(buildPayPalSdkUrl({ ...readySandboxConfig, planId: "" }), null);
});

test("an enabled sandbox configuration builds a subscription-only SDK URL", () => {
  assert.equal(validatePaymentConfig(readySandboxConfig).ready, true);
  const url = new URL(buildPayPalSdkUrl(readySandboxConfig));
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
    "planId",
    "schemaVersion"
  ]);
  assert.equal(committedConfig.enabled, false);
  assert.equal(committedConfig.environment, "sandbox");
  assert.equal(committedConfig.clientId, "");
  assert.equal(committedConfig.planId, "");
  assert.doesNotMatch(committedSource, /@|email|secret|password|client[_-]?secret|merchant|payer|customer|webhook/i);

  const unsafeConfig = { ...readySandboxConfig, clientSecret: "do-not-commit" };
  assert.equal(validatePaymentConfig(unsafeConfig).valid, false);
  assert.equal(buildPayPalSdkUrl(unsafeConfig), null);

  for (const file of ["app.js", "README.md", "index.html", "data/payment.json"]) {
    const source = readFileSync(resolve(root, file), "utf8");
    assert.doesNotMatch(source, /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i, `${file} darf keine PayPal-Adresse veröffentlichen`);
  }
});
