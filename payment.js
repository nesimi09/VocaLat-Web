const PAYPAL_SDK_ENDPOINT = "https://www.paypal.com/sdk/js";
const EXPECTED_KEYS = new Set([
  "schemaVersion",
  "enabled",
  "environment",
  "currency",
  "amount",
  "billingInterval",
  "billingIntervalCount",
  "clientId",
  "planId",
  "expiresAt"
]);

const PUBLIC_CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;
const PLAN_ID_PATTERN = /^P-[A-Z0-9]{10,64}$/;
const EXPIRY_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const SENSITIVE_KEY_PATTERN = /(?:secret|password|private|token|webhook|merchant|payer|customer|email)/i;

/**
 * Validate the public, static configuration for the PayPal sandbox prototype.
 *
 * This module deliberately supports sandbox subscriptions only. It must never
 * receive a client secret, an email address or other personal/payment data.
 */
export function validatePaymentConfig(config, now = Date.now()) {
  const errors = [];

  if (!isPlainObject(config)) {
    return { valid: false, ready: false, errors: ["Die Zahlungskonfiguration fehlt oder ist ungültig."] };
  }

  if (containsSensitiveMaterial(config)) {
    errors.push("Die öffentliche Konfiguration darf keine geheimen oder personenbezogenen Daten enthalten.");
  }

  const keys = Object.keys(config);
  const unknownKeys = keys.filter(key => !EXPECTED_KEYS.has(key));
  const missingKeys = [...EXPECTED_KEYS].filter(key => !Object.hasOwn(config, key));
  if (unknownKeys.length) errors.push("Die Zahlungskonfiguration enthält nicht erlaubte Felder.");
  if (missingKeys.length) errors.push("Die Zahlungskonfiguration ist unvollständig.");

  if (config.schemaVersion !== 1) errors.push("Die Version der Zahlungskonfiguration wird nicht unterstützt.");
  if (typeof config.enabled !== "boolean") errors.push("Der Aktivierungsstatus ist ungültig.");
  if (config.environment !== "sandbox") errors.push("Dieser Prototyp erlaubt ausschließlich die PayPal-Sandbox.");
  if (config.currency !== "EUR") errors.push("Der Prototyp unterstützt ausschließlich EUR.");
  if (config.amount !== "4.99") errors.push("Der Monatspreis muss 4,99 EUR betragen.");
  if (config.billingInterval !== "MONTH" || config.billingIntervalCount !== 1) {
    errors.push("Das Abrechnungsintervall muss genau ein Monat sein.");
  }

  const clientIdValid = config.clientId === "" || (
    typeof config.clientId === "string" &&
    config.clientId === config.clientId.trim() &&
    PUBLIC_CLIENT_ID_PATTERN.test(config.clientId)
  );
  const planIdValid = config.planId === "" || (
    typeof config.planId === "string" &&
    config.planId === config.planId.trim() &&
    PLAN_ID_PATTERN.test(config.planId)
  );
  if (!clientIdValid) errors.push("Die öffentliche Sandbox-Client-ID ist ungültig.");
  if (!planIdValid) errors.push("Die öffentliche Sandbox-Plan-ID ist ungültig.");

  const expiresAt = typeof config.expiresAt === "string" && EXPIRY_PATTERN.test(config.expiresAt)
    ? Date.parse(config.expiresAt)
    : Number.NaN;
  const expiresAtValid = config.expiresAt === "" || Number.isFinite(expiresAt);
  if (!expiresAtValid) errors.push("Der Ablaufzeitpunkt des Sandbox-Tests ist ungültig.");

  if (config.enabled === true && (!config.clientId || !config.planId || !config.expiresAt)) {
    errors.push("Für einen aktivierten Sandbox-Test fehlen Client-ID, Plan-ID oder Ablaufzeitpunkt.");
  }

  const valid = errors.length === 0;
  const expired = valid && config.enabled === true && expiresAt <= Number(now);
  return {
    valid,
    ready: valid && config.enabled === true && !expired,
    expired,
    errors
  };
}

/** Return true only for an explicitly enabled and fully valid sandbox setup. */
export function isSandboxSubscriptionReady(config, now = Date.now()) {
  return validatePaymentConfig(config, now).ready;
}

/**
 * Build the public JavaScript SDK URL without making a network request.
 * Returns null for disabled or malformed configurations (fail closed).
 */
export function buildPayPalSdkUrl(config, now = Date.now()) {
  if (!isSandboxSubscriptionReady(config, now)) return null;

  const url = new URL(PAYPAL_SDK_ENDPOINT);
  url.searchParams.set("client-id", config.clientId);
  url.searchParams.set("components", "buttons");
  url.searchParams.set("vault", "true");
  url.searchParams.set("intent", "subscription");
  url.searchParams.set("currency", "EUR");
  return url.toString();
}

/** A small UI-safe status summary; it never echoes credentials. */
export function paymentConfigStatus(config, now = Date.now()) {
  const validation = validatePaymentConfig(config, now);
  if (!validation.valid) {
    return {
      state: "invalid",
      ready: false,
      label: "Sandbox-Konfiguration prüfen",
      errors: validation.errors
    };
  }
  if (validation.expired) {
    return {
      state: "expired",
      ready: false,
      label: "PayPal-Test automatisch beendet",
      errors: []
    };
  }
  if (!validation.ready) {
    return {
      state: "disabled",
      ready: false,
      label: "PayPal-Test noch nicht aktiviert",
      errors: []
    };
  }
  return {
    state: "sandbox-ready",
    ready: true,
    label: "PayPal-Sandbox bereit",
    errors: []
  };
}

export function formatMonthlyPrice(config) {
  const validation = validatePaymentConfig(config);
  if (!validation.valid) return "";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(4.99) + " monatlich";
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function containsSensitiveMaterial(value) {
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, entry]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) return true;
    if (typeof entry === "string" && EMAIL_PATTERN.test(entry)) return true;
    return isPlainObject(entry) && containsSensitiveMaterial(entry);
  });
}
