import { analyzeBookText, answerMatches, answerOptionState, selectPracticeVocabulary, shuffledUniqueMeanings } from "./learning-engine.js";
import { buildCourseRound, calculateCourseResult, moduleSessionStatus, nextRetryIndex, vocabularyForModule, vocabularyPacks } from "./course-engine.js";
import { createCourseAccessSession, verifyCourseAccessCode, verifyCourseAccessSession } from "./course-access.js";
import { buildPayPalSdkUrl, formatMonthlyPrice, paymentConfigStatus } from "./payment.js";
import { grammarCategory, orderGrammarSections } from "./grammar-order.js";
import { buildGrammarPractice } from "./grammar-practice.js";
import { extractLatinDocument } from "./document-analysis.js";
import { analyzeLatinMorphology, prepareMorphology } from "./morphology.js";
import { recognizeLatinText, validateOcrImage } from "./ocr.js";

const NAV = [
  { id: "kurs", label: "Kurs", icon: "course" },
  { id: "vokabeln", label: "Vokabeln", icon: "book" },
  { id: "ueben", label: "Üben", icon: "cards" },
  { id: "uebersetzen", label: "Übersetzen", icon: "scan" },
  { id: "grammatik", label: "Grammatik", icon: "textbook" }
];
const ROUTES = new Set([...NAV.map(item => item.id), "fortschritt"]);

const CATEGORIES = [
  { id: "deklinationen", title: "Deklinationen", icon: "▦" },
  { id: "pronomen", title: "Pronomen", icon: "♙" },
  { id: "konjugationen", title: "Konjugationen und Verbformen", icon: "↻" },
  { id: "tempora", title: "Tempora / Zeitformen", icon: "◷" },
  { id: "partizipien", title: "Partizipien", icon: "§" },
  { id: "satzlehre", title: "Satzlehre", icon: "☷" },
  { id: "regeln", title: "Regeln und Merkhilfen", icon: "✦" }
];

const COURSE_ACCESS_KEY = "vocalat-course-access-v1";
const COURSE_PROGRESS_KEY = "vocalat-course-progress-v1";

const state = {
  vocabulary: [], grammar: [], route: "kurs", detail: null,
  search: "", lesson: "all", favoritesOnly: false,
  course: null, courseAccessManifest: null, courseAccessGranted: false,
  courseAccessRecord: null, courseAccessBusy: false, courseAccessError: "",
  courseModuleId: null, coursePackIndex: 0, coursePhase: "map", courseRound: [], courseQuestionIndex: 0,
  courseBaseQuestionCount: 0, courseAttempts: [], courseAnswerRecorded: false, courseSelectedChoice: null,
  courseTypedAnswer: "", courseFeedback: null, courseHintUsed: false, courseResult: null,
  courseProgress: loadCourseProgress(),
  paymentConfig: null, paymentState: "idle", paymentError: "",
  practiceLessons: "all", practicePickerOpen: false, mode: "typed", practiceSet: [], questionIndex: 0,
  practiceAnswered: 0, practiceCorrect: 0, practiceComplete: false,
  revealed: false, selectedChoice: null, feedback: null, answerRecorded: false, typedAnswer: "",
  grammarPracticeCategory: null, grammarPracticeLessons: [], grammarPracticePickerOpen: false, grammarPracticeRound: [], grammarPracticeIndex: 0,
  grammarPracticeSelected: null, grammarPracticeRecorded: false, grammarPracticeCorrect: 0, grammarPracticeComplete: false,
  translationText: "", translationRawText: "", translationImage: null, translationImageUrl: null,
  translationBusy: false, translationProgress: 0, translationStatus: "", translationError: "",
  translationConfidence: null, translationAnalysis: null,
  translationMorphology: new Map(),
  translationGlossary: [], translationDocument: null,
  translationJob: 0,
  fallbackVocabulary: [],
  progress: loadProgress()
};

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const announcer = document.querySelector("#announcer");
let paypalSdkPromise = null;

function loadProgress() {
  try {
    localStorage.removeItem("vocalat-progress");
    return JSON.parse(sessionStorage.getItem("vocalat-session-progress") || "{}");
  }
  catch { return {}; }
}

function saveProgress() {
  try { sessionStorage.setItem("vocalat-session-progress", JSON.stringify(state.progress)); }
  catch { /* Sitzungsdaten bleiben ersatzweise im Arbeitsspeicher. */ }
}

function loadCourseProgress() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(COURSE_PROGRESS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? { xp: 0, modules: {}, ...parsed } : { xp: 0, modules: {} };
  } catch { return { xp: 0, modules: {} }; }
}

function saveCourseProgress() {
  try { sessionStorage.setItem(COURSE_PROGRESS_KEY, JSON.stringify(state.courseProgress)); }
  catch { /* Kursdaten bleiben ersatzweise im Arbeitsspeicher. */ }
}

function loadCourseAccessSession() {
  try { return JSON.parse(sessionStorage.getItem(COURSE_ACCESS_KEY) || "null"); }
  catch { return null; }
}

function saveCourseAccessSession(session) {
  try { sessionStorage.setItem(COURSE_ACCESS_KEY, JSON.stringify(session)); }
  catch { /* Der Code gilt ersatzweise nur bis zum nächsten Neuladen. */ }
}

function clearCourseAccessSession() {
  try { sessionStorage.removeItem(COURSE_ACCESS_KEY); }
  catch { /* Kein persistierter Sitzungszugang vorhanden. */ }
}

function announce(message) {
  if (!announcer) return;
  announcer.textContent = "";
  requestAnimationFrame(() => { announcer.textContent = message; });
}

function stableId(entry) {
  const input = `${entry.lektion}|${entry.latein}|${entry.grammatik}|${entry.deutsch}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

function progressFor(entry) {
  const id = stableId(entry);
  return state.progress[id] || { studied: 0, correct: 0, answered: 0, favorite: false };
}

function updateProgress(entry, values) {
  const id = stableId(entry);
  state.progress[id] = { ...progressFor(entry), ...values };
  saveProgress();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
}

function label(key) {
  const labels = { formen: "Formen", form: "Form", kasus: "Kasus", numerus: "Numerus", person: "Person", singular: "Singular", plural: "Plural", latein: "Lateinischer Satz", deutsch: "Deutsche Übersetzung", regel: "Regel", beispiele: "Beispiele", beispiel: "Lateinische Form", beispielreihen: "Konjugationsbeispiele", beispiele_3_plural: "Beispiele: 3. Person Plural", bildung: "Bildung", bildung_aktiv: "Bildung im Aktiv", bildung_passiv: "Bildung im Passiv", imperfekt_bildung: "Bildung des Imperfekts", verwendung: "Verwendung", übersetzung: "Übersetzung", uebersetzungsmoeglichkeiten: "Übersetzungsmöglichkeiten", merksatz: "Merksatz", merkbegriff: "Merkbegriff", hinweis: "Wichtig", bedeutung: "Bedeutung", muster: "Grundformen und Bedeutung", personalendungen: "Personalendungen", praesens_personalendungen: "Personalendungen im Präsens", maskulin: "Maskulinum", feminin: "Femininum", neutrum: "Neutrum", praesens: "Präsens", imperfekt: "Imperfekt", futur: "Futur I", perfekt: "Perfekt", plusquamperfekt: "Plusquamperfekt", tempus: "Zeitform", verb: "Grundform", konjugation: "Konjugation", konstruktion: "Konstruktion", partizip: "Partizip", zeitverhaeltnis: "Zeitverhältnis", genus_verbi: "Handlungsrichtung", ppa: "Partizip Präsens Aktiv (PPA)", ppp: "PPP-Form", pfa: "PFA-Form", infinitiv_futur: "Infinitiv Futur Aktiv", stufe: "Steigerungsstufe", adjektiv: "Adjektiv", adverb: "Adverb", aktiv: "Aktiv", passiv: "Passiv", bereich: "Bereich", werte: "Formen" };
  return labels[key.toLowerCase()] || key.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
}

function categoryFor(section) {
  return grammarCategory(section);
}

function lessons() { return [...new Set(state.vocabulary.map(v => v.lektion))].sort((a, b) => a - b); }
function entriesForLesson(lesson) { return state.vocabulary.filter(v => String(v.lektion) === String(lesson)); }
function shuffled(items) { return [...items].sort(() => Math.random() - .5); }

function setHeader(title, eyebrow = "VocaLat") {
  document.querySelector("#page-title").textContent = title;
  document.querySelector("#page-eyebrow").textContent = eyebrow;
  document.title = `${title} · VocaLat`;
}

function renderNav() {
  document.querySelectorAll(".nav-list").forEach(nav => {
    nav.innerHTML = NAV.map(item => `<button class="nav-link ${state.route === item.id ? "active" : ""}" data-route="${item.id}" type="button" ${state.route === item.id ? 'aria-current="page"' : ""}><span class="nav-icon" aria-hidden="true">${navIcon(item.icon)}</span><span>${item.label}</span></button>`).join("");
  });
}

function navIcon(name) {
  const paths = {
    course: '<path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 0 5 23z"/><path d="M8.5 7.5h7M8.5 11h7M8.5 14.5h4"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5a2.5 2.5 0 0 1 2.5 2.5z"/>',
    cards: '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 1.8h8M2 8v8"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/>',
    textbook: '<path d="M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2z"/><path d="M5 17h14M9 7h6M9 11h6"/>',
    chart: '<path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M2 20h20"/>'
  };
  return `<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function navigate(route, detail = null) {
  state.route = route; state.detail = detail;
  history.replaceState(null, "", `#${route}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function renderAtTop() {
  window.scrollTo({ top: 0, behavior: "auto" });
  render();
}

function renderVocabularyBrowser() {
  setHeader("Vokabeln", "Buchwortschatz");
  let filtered = state.vocabulary.filter(v => {
    const haystack = `${v.latein} ${v.deutsch} ${v.grammatik}`.toLocaleLowerCase("de");
    return (!state.search || haystack.includes(state.search.toLocaleLowerCase("de"))) &&
      (state.lesson === "all" || String(v.lektion) === state.lesson) &&
      (!state.favoritesOnly || progressFor(v).favorite);
  });

  const lessonCards = state.search || state.lesson !== "all" || state.favoritesOnly ? "" : `<div class="section-heading"><h2>Lektionen</h2><span>${lessons().length} verfügbar</span></div><div class="grid">${lessons().map(n => {
    const entries = entriesForLesson(n); const done = entries.filter(v => progressFor(v).studied > 0).length;
    return `<button class="card lesson-card" data-lesson-card="${n}" type="button"><div class="card-top"><h3>Lektion ${n}</h3><span class="meta">${entries.length} Vokabeln</span></div><div class="progress-track"><div class="progress-fill" style="width:${entries.length ? done / entries.length * 100 : 0}%"></div></div><span class="meta">${done} von ${entries.length} angesehen</span></button>`;
  }).join("")}</div>`;

  app.innerHTML = `<div class="page-utility"><span>${state.vocabulary.length} Buchvokabeln</span><button class="text-button" data-route="fortschritt" type="button">Sitzungsstand</button></div><div class="toolbar"><label class="search-wrap"><span class="sr-only">Vokabeln durchsuchen</span><input class="field" id="search" type="search" placeholder="Latein, Deutsch, Grammatik" value="${escapeHtml(state.search)}"></label><select class="select" id="lesson-filter" aria-label="Lektion filtern"><option value="all">Alle Lektionen</option>${lessons().map(n => `<option value="${n}" ${state.lesson === String(n) ? "selected" : ""}>Lektion ${n}</option>`).join("")}</select><label class="toggle"><input id="favorite-filter" type="checkbox" ${state.favoritesOnly ? "checked" : ""}> Nur Favoriten</label></div>${lessonCards}<div class="section-heading"><h2>Vokabeln</h2><span>${filtered.length} Einträge</span></div><div class="vocab-list">${filtered.length ? filtered.map(vocabRow).join("") : `<div class="empty card">Keine Treffer. Passe Suche oder Filter an.</div>`}</div>`;
}

function vocabRow(v) {
  const p = progressFor(v); const id = stableId(v);
  return `<article class="card vocab-row"><button class="favorite-button" data-favorite="${id}" aria-label="${p.favorite ? "Favorit entfernen" : "Als Favorit markieren"}" type="button">${p.favorite ? "★" : "☆"}</button><div><div class="word">${escapeHtml(v.latein)}</div><div class="meaning">${escapeHtml(v.deutsch)}</div>${v.grammatik ? `<div class="meta">${escapeHtml(v.grammatik)} · Lektion ${v.lektion}</div>` : `<div class="meta">Lektion ${v.lektion}</div>`}</div></article>`;
}

function renderCourse() {
  setHeader("Kurs", "VocaLat");
  if (!state.course?.modules?.length) {
    app.innerHTML = `<div class="card empty">Der Kurs konnte nicht geladen werden.</div>`;
    return;
  }
  if (!state.courseAccessGranted) return renderCourseGate();
  if (state.coursePhase === "module") return renderCourseModule();
  if (state.coursePhase === "quiz") return renderCourseQuiz();
  if (state.coursePhase === "summary") return renderCourseSummary();
  renderCourseMap();
}

function renderCourseGate() {
  const paymentStatus = paymentConfigStatus(state.paymentConfig);
  const monthlyPrice = formatMonthlyPrice(state.paymentConfig) || "4,99 € monatlich";
  app.innerHTML = `<div class="course-gate">
    <section class="course-access" aria-label="Kurs freischalten">
      <div class="course-payment-card">
        <strong class="course-price">${escapeHtml(monthlyPrice)}</strong>
        ${paymentStatus.ready ? state.paymentState === "error" ? `<button class="button secondary" data-payment-retry type="button">PayPal erneut laden</button>` : `<div id="paypal-subscription-buttons" aria-label="PayPal-Sandbox-Abo"></div>` : `<button class="button payment-disabled" type="button" disabled>PayPal ist gerade nicht verfügbar</button>`}
        ${state.paymentError ? `<div class="inline-alert error" role="alert">${escapeHtml(state.paymentError)}</div>` : ""}
      </div>
      <details class="course-code-access" ${state.courseAccessError ? "open" : ""}>
        <summary>Stattdessen Kurscode verwenden</summary>
        <form class="course-code-form" id="course-access-form">
          <label for="course-access-code">Freischaltcode</label>
          <input class="field" id="course-access-code" name="courseCode" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="VL1-…" required ${state.courseAccessBusy ? "disabled" : ""}>
          ${state.courseAccessError ? `<div class="inline-alert error" role="alert">${escapeHtml(state.courseAccessError)}</div>` : ""}
          <button class="button" type="submit" ${state.courseAccessBusy ? "disabled" : ""}>${state.courseAccessBusy ? "Code wird geprüft …" : "Mit Code freischalten"}</button>
        </form>
      </details>
    </section>
    <section class="course-benefits" aria-labelledby="course-benefits-title">
      <h2 id="course-benefits-title">Das lernst du im Kurs</h2>
      <p>Der Kurs verbindet die Vokabeln aus dem Schulbuch mit der Grammatik, die du beim Übersetzen wirklich brauchst.</p>
      <ul>
        <li>Erklärungen in der Reihenfolge des Buches</li>
        <li>Grammatik direkt nach jeder Erklärung üben</li>
        <li>Fehler gezielt wiederholen</li>
        <li>Tests über eine oder mehrere Lektionen</li>
      </ul>
      <p>So kannst du dich auf Hausaufgaben und Klassenarbeiten vorbereiten, ohne dir das Material selbst zusammensuchen zu müssen.</p>
    </section>
  </div>`;
  if (paymentStatus.ready && state.paymentState !== "error") requestAnimationFrame(() => { void mountPayPalSubscription(); });
}

async function mountPayPalSubscription() {
  const container = document.querySelector("#paypal-subscription-buttons");
  const sdkUrl = buildPayPalSdkUrl(state.paymentConfig);
  if (!container || !sdkUrl || container.dataset.rendered === "true") return;
  container.dataset.rendered = "true";
  container.innerHTML = `<p class="meta">PayPal wird geladen …</p>`;
  try {
    const paypal = await loadPayPalSdk(sdkUrl);
    if (!container.isConnected) return;
    container.replaceChildren();
    const buttons = paypal.Buttons({
      style: { layout: "vertical", shape: "rect", label: "subscribe", height: 42 },
      createSubscription(_data, actions) {
        return actions.subscription.create({ plan_id: state.paymentConfig.planId });
      },
      onApprove() {
        state.paymentState = "sandbox-approved";
        state.paymentError = "";
        state.courseAccessGranted = true;
        state.coursePhase = "map";
        renderAtTop();
        announce("PayPal-Sandbox bestätigt. Kurs für diese Sitzung freigeschaltet.");
      },
      onCancel() {
        state.paymentState = "cancelled";
        state.paymentError = "Die PayPal-Zahlung wurde abgebrochen.";
        render();
      },
      onError() {
        state.paymentState = "error";
        state.paymentError = "Die PayPal-Zahlung konnte nicht abgeschlossen werden.";
        render();
      }
    });
    if (typeof buttons.isEligible === "function" && !buttons.isEligible()) throw new Error("PayPal ist derzeit nicht verfügbar.");
    await buttons.render(container);
  } catch (error) {
    if (!container.isConnected) return;
    state.paymentState = "error";
    state.paymentError = error instanceof Error ? error.message : "PayPal konnte nicht geladen werden.";
    render();
  }
}

function loadPayPalSdk(sdkUrl) {
  if (window.paypal?.Buttons) return Promise.resolve(window.paypal);
  if (paypalSdkPromise) return paypalSdkPromise;
  paypalSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = sdkUrl;
    script.async = true;
    script.dataset.vocalatPaypal = "sandbox";
    script.addEventListener("load", () => window.paypal?.Buttons ? resolve(window.paypal) : reject(new Error("PayPal wurde nicht vollständig geladen.")), { once: true });
    script.addEventListener("error", () => { script.remove(); reject(new Error("PayPal konnte nicht geladen werden.")); }, { once: true });
    document.head.append(script);
  });
  return paypalSdkPromise;
}

function moduleProgress(moduleId) {
  state.courseProgress.modules ||= {};
  return state.courseProgress.modules[moduleId] || { packs: {}, attempts: 0 };
}

function packProgress(moduleId, packIndex) {
  return moduleProgress(moduleId).packs?.[packIndex] || { passed: false, bestScore: 0, attempts: 0 };
}

function moduleCourseInfo(module) {
  const packs = vocabularyPacks(state.vocabulary, module, state.course.packSize || 8);
  const progress = moduleProgress(module.id);
  const passedPacks = packs.filter((_, index) => packProgress(module.id, index).passed).length;
  return { packs, progress, passedPacks, totalPacks: packs.length, status: moduleSessionStatus(progress.packs || {}, packs.length) };
}

function courseRequiredScore() {
  return state.course?.mastery?.requiredScore || 80;
}

function moduleNumber(module) {
  return Math.max(state.course.modules.findIndex(item => item.id === module.id) + 1, 1);
}

function lessonRange(module) {
  const values = module.lessons || [];
  if (!values.length) return "–";
  return values.length === 1 ? String(values[0]) : `${values[0]}–${values.at(-1)}`;
}

function conceptExample(module) {
  const example = module.concept?.example;
  if (example && typeof example === "object") return { latin: example.latin || "", german: example.german || "" };
  const parts = String(example || "").split(/\s+[–—]\s+/);
  if (parts.length < 2) return { latin: String(example || ""), german: "" };
  return { latin: parts.shift(), german: parts.join(" – ") };
}

function recommendedCourseTarget() {
  for (const module of state.course.modules) {
    const info = moduleCourseInfo(module);
    const packIndex = info.packs.findIndex((_, index) => !packProgress(module.id, index).passed);
    if (packIndex >= 0) return { module, packIndex };
  }
  const module = state.course.modules.at(-1);
  return { module, packIndex: Math.max(moduleCourseInfo(module).packs.length - 1, 0) };
}

function renderCourseMap() {
  const moduleInfos = state.course.modules.map(module => ({ module, ...moduleCourseInfo(module) }));
  const totalPacks = moduleInfos.reduce((sum, info) => sum + info.totalPacks, 0);
  const passedPacks = moduleInfos.reduce((sum, info) => sum + info.passedPacks, 0);
  const recommended = recommendedCourseTarget();
  const percent = totalPacks ? Math.round(passedPacks / totalPacks * 100) : 0;
  const completedModules = moduleInfos.filter(info => info.totalPacks > 0 && info.passedPacks === info.totalPacks).length;

  app.innerHTML = `<div class="course-map">
    <header class="course-overview">
      <h2>Kursübersicht</h2>
      <p class="course-overview-meta"><strong>${passedPacks} von ${totalPacks}</strong> Lerneinheiten abgeschlossen</p>
      <div class="progress-track" role="progressbar" aria-label="Kursfortschritt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><div class="progress-fill" style="width:${percent}%"></div></div>
      <div class="course-overview-actions">
        <button class="button" data-course-continue type="button">${passedPacks ? "Weiterlernen" : "Erste Lerneinheit starten"}</button>
        <div><button class="text-button" data-route="fortschritt" type="button">Sitzungsstand</button><button class="text-button" data-course-lock type="button">Zugang beenden</button></div>
      </div>
    </header>
    <section class="course-module-section" aria-labelledby="course-modules-title">
      <div class="section-heading"><h2 id="course-modules-title">Module</h2><span>${completedModules}/${moduleInfos.length} abgeschlossen</span></div>
      <ol class="course-module-list">${moduleInfos.map(({ module, passedPacks: done, totalPacks: total, status }, index) => {
        const isRecommended = recommended.module.id === module.id;
        const statusKey = status.status;
        const statusClass = statusKey === "complete" ? "passed" : statusKey;
        const statusLabel = statusKey === "complete" ? "Bestanden" : statusKey === "in-progress" ? "Begonnen" : "Neu";
        return `<li><button class="course-module ${statusClass} ${isRecommended ? "recommended" : ""}" data-course-module="${escapeHtml(module.id)}" type="button" ${isRecommended ? 'aria-current="step"' : ""}>
          <span class="course-module-marker">${statusKey === "complete" ? "✓" : index + 1}</span>
          <span class="course-module-copy"><h3>${escapeHtml(module.title)}</h3><small>Lektion ${lessonRange(module)} · ${total} ${total === 1 ? "Lerneinheit" : "Lerneinheiten"}</small></span>
          <span class="course-module-progress"><strong>${done}/${total}</strong><small>${statusLabel}</small></span>
        </button></li>`;
      }).join("")}</ol>
    </section>
  </div>`;
}

function selectedCourseModule() {
  return state.course.modules.find(module => module.id === state.courseModuleId) || state.course.modules[0];
}

function renderCourseModule() {
  const module = selectedCourseModule();
  const info = moduleCourseInfo(module);
  if (!info.packs.length) {
    state.coursePhase = "map";
    return renderCourseMap();
  }
  state.coursePackIndex = Math.max(0, Math.min(state.coursePackIndex, info.packs.length - 1));
  const pack = info.packs[state.coursePackIndex];
  const currentProgress = packProgress(module.id, state.coursePackIndex);
  const conceptParagraphs = Array.isArray(module.concept.explanation) ? module.concept.explanation : [module.concept.explanation];
  const example = conceptExample(module);
  const grammarLinks = (module.grammarTitles || []).map(title => ({ title, index: state.grammar.findIndex(section => section.titel === title) })).filter(item => item.index >= 0);

  app.innerHTML = `<div class="course-detail">
    <header class="course-detail-header">
      <button class="text-button course-back" data-course-map type="button">← Kursübersicht</button>
      <p class="course-kicker">Modul ${moduleNumber(module)} · Lektion ${lessonRange(module)}</p>
      <h2>${escapeHtml(module.title)}</h2>
      <p>${escapeHtml(module.story)}</p>
      <small>Stufe ${module.difficulty} von 5</small>
    </header>
    <section class="course-objectives-section" aria-labelledby="course-objectives-title"><h3 id="course-objectives-title">Lernziele</h3><ul class="course-objectives">${module.objectives.map(objective => `<li>${escapeHtml(objective)}</li>`).join("")}</ul></section>
    <section class="course-lesson-section course-concept">
      <p class="course-kicker">Grammatik</p>
      <h3>${escapeHtml(module.grammarTitles?.[0] || "Grammatik im Satz")}</h3>
      ${conceptParagraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("")}
      <div class="course-rule"><strong>Merkregel:</strong> ${escapeHtml(module.concept.rule)}</div>
      <div class="course-example"><strong lang="la">${escapeHtml(example.latin)}</strong>${example.german ? `<span>${escapeHtml(example.german)}</span>` : ""}</div>
      <p class="course-mistake"><strong>Typischer Fehler:</strong> ${escapeHtml(module.concept.commonMistake)}</p>
      ${grammarLinks.length ? `<nav class="course-grammar-links" aria-label="Passende Grammatik">${grammarLinks.map(item => `<button class="course-text-link" data-grammar-section="${item.index}" type="button">${escapeHtml(item.title)} <span aria-hidden="true">→</span></button>`).join("")}</nav>` : ""}
    </section>
    <details class="course-challenge"><summary>Zusatzaufgabe: ${escapeHtml(module.challenge.title)}</summary><p>${escapeHtml(module.challenge.prompt)}</p><small>Freiwillig; beeinflusst die nächste Lerneinheit nicht.</small></details>
    <section class="course-pack-section">
      <div class="course-pack-heading"><div><p class="course-kicker">Wortschatz</p><h3>Lerneinheit ${state.coursePackIndex + 1} von ${info.packs.length}</h3></div><p>${pack.length} neue Wörter · ${currentProgress.bestScore || 0} % Bestwert</p></div>
      <div class="course-pack-list" role="group" aria-label="Lerneinheit auswählen">${info.packs.map((_, index) => `<button class="course-pack-button ${index === state.coursePackIndex ? "active" : ""} ${packProgress(module.id, index).passed ? "passed" : ""}" data-course-pack="${index}" type="button" aria-label="Lerneinheit ${index + 1}${packProgress(module.id, index).passed ? ", bestanden" : ""}">${packProgress(module.id, index).passed ? "✓" : index + 1}</button>`).join("")}</div>
      <div class="course-vocab-preview">${pack.map(entry => `<article class="course-vocab-item"><strong lang="la">${escapeHtml(entry.latein)}</strong><span>${escapeHtml(entry.deutsch)}</span><small>${escapeHtml(entry.grammatik || `Lektion ${entry.lektion}`)}</small></article>`).join("")}</div>
    </section>
    <section class="course-start-row"><p>Fehler werden nach zwei weiteren Aufgaben erneut abgefragt.</p><button class="button" data-course-start type="button">${currentProgress.passed ? "Lerneinheit wiederholen" : "Training starten"}</button></section>
  </div>`;
}

function courseReviewVocabulary(module, packIndex) {
  const moduleIndex = state.course.modules.findIndex(item => item.id === module.id);
  const earlierModules = state.course.modules.slice(0, Math.max(moduleIndex, 0));
  const earlierModuleVocabulary = earlierModules.flatMap(item => vocabularyForModule(state.vocabulary, item));
  const earlierPacks = vocabularyPacks(state.vocabulary, module, state.course.packSize || 8).slice(0, packIndex).flat();
  return [...earlierPacks, ...earlierModuleVocabulary];
}

function startCourseRound() {
  const module = selectedCourseModule();
  const packs = vocabularyPacks(state.vocabulary, module, state.course.packSize || 8);
  const pack = packs[state.coursePackIndex] || [];
  state.courseRound = buildCourseRound({
    module,
    pack,
    reviewVocabulary: courseReviewVocabulary(module, state.coursePackIndex),
    moduleVocabulary: vocabularyForModule(state.vocabulary, module),
    random: Math.random
  });
  state.courseBaseQuestionCount = state.courseRound.length;
  state.courseQuestionIndex = 0;
  state.courseAttempts = [];
  state.courseResult = null;
  resetCourseAnswer();
  state.coursePhase = "quiz";
  const current = moduleProgress(module.id);
  state.courseProgress.modules[module.id] = { ...current, attempts: (current.attempts || 0) + 1, packs: current.packs || {} };
  saveCourseProgress();
  render();
  focusCourseQuestion();
}

function resetCourseAnswer() {
  state.courseAnswerRecorded = false;
  state.courseSelectedChoice = null;
  state.courseTypedAnswer = "";
  state.courseFeedback = null;
  state.courseHintUsed = false;
}

function currentCourseQuestion() {
  return state.courseRound[state.courseQuestionIndex];
}

function renderCourseQuiz() {
  const module = selectedCourseModule();
  const question = currentCourseQuestion();
  if (!question) return finishCourseRound();
  const firstAttemptCount = state.courseAttempts.filter(attempt => !attempt.retry).length;
  const progress = Math.min(100, Math.round(firstAttemptCount / Math.max(state.courseBaseQuestionCount, 1) * 100));
  const skillLabels = { vocabulary: "Bedeutung", forms: "Formen", grammar: "Grammatik", reading: "Satzverständnis" };
  const retryLabel = question.retry ? " · Reparaturrunde" : question.review ? " · Wiederholung" : "";
  const choiceMarkup = question.type === "choice" ? `<div class="course-choice-list">${question.options.map(option => {
    const optionState = answerOptionState(option, question.answer, state.courseSelectedChoice, state.courseAnswerRecorded);
    const icon = optionState === "correct" ? "✓" : optionState === "wrong" ? "✕" : "";
    return `<button class="course-choice ${optionState}" data-course-choice="${escapeHtml(option)}" type="button" ${state.courseAnswerRecorded ? "disabled" : ""}><span>${escapeHtml(option)}</span><strong aria-hidden="true">${icon}</strong></button>`;
  }).join("")}</div>` : `<form class="course-answer-form" id="course-answer-form"><label class="sr-only" for="course-typed-answer">Antwort eingeben</label><input class="field" id="course-typed-answer" autocomplete="off" spellcheck="false" placeholder="Antwort eingeben" value="${escapeHtml(state.courseTypedAnswer)}" ${state.courseAnswerRecorded ? "disabled" : ""}>${!state.courseAnswerRecorded ? `<div class="course-answer-actions"><button class="button" type="submit">Prüfen</button><button class="button secondary" data-course-hint type="button">Hinweis</button></div>` : ""}</form>`;
  const feedback = state.courseAnswerRecorded ? `<div class="course-feedback ${state.courseFeedback.correct ? "correct" : "wrong"}" role="status"><strong>${state.courseFeedback.correct ? state.courseHintUsed ? "✓ Richtig – mit Hinweis" : "✓ Richtig" : `✕ Richtig ist: ${escapeHtml(question.answer)}`}</strong><p>${escapeHtml(question.explanation)}</p>${state.courseFeedback.retryScheduled ? `<small>Diese Aufgabe kommt nach zwei anderen Fragen erneut.</small>` : ""}${state.courseHintUsed ? `<small>Mit Hinweis gelöst – für einen sicheren Abruf folgt eine Wiederholung.</small>` : ""}</div><div class="course-answer-actions"><button class="button" data-course-next type="button">${state.courseQuestionIndex + 1 >= state.courseRound.length ? "Auswertung" : "Weiter"}</button></div>` : "";

  app.innerHTML = `<div class="course-quiz">
    <section class="card course-quiz-header"><div class="course-quiz-meta"><span>${escapeHtml(module.title)} · Lerneinheit ${state.coursePackIndex + 1}</span><span>${firstAttemptCount}/${state.courseBaseQuestionCount}${retryLabel}</span></div><div class="progress-track" role="progressbar" aria-label="Kursfortschritt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><div class="progress-fill" style="width:${progress}%"></div></div></section>
    <section class="card course-question-card" id="course-question" tabindex="-1">
      <span class="course-skill-tag">${escapeHtml(skillLabels[question.skill] || "Training")}${retryLabel}</span>
      <h2 ${question.promptLanguage === "la" ? 'lang="la"' : ""}>${escapeHtml(question.prompt)}</h2>
      ${question.context ? `<p class="course-question-context" ${question.contextLanguage === "la" ? 'lang="la"' : ""}>${escapeHtml(question.context)}</p>` : ""}
      ${state.courseHintUsed && !state.courseAnswerRecorded ? `<p class="course-hint-box"><strong>Hinweis:</strong> ${escapeHtml(question.hint || `Die Antwort beginnt mit „${question.answer.slice(0, 1)}“.`)}</p>` : ""}
      ${choiceMarkup}${feedback}
    </section>
  </div>`;
}

function recordCourseAnswer(input) {
  if (state.courseAnswerRecorded) return;
  const question = currentCourseQuestion();
  const correct = question.type === "choice" ? input === question.answer : answerMatches(input, question.answer);
  const attempt = { id: question.id, skill: question.skill, correct, assisted: state.courseHintUsed, retry: Boolean(question.retry) };
  state.courseAttempts.push(attempt);
  state.courseSelectedChoice = question.type === "choice" ? input : null;
  state.courseTypedAnswer = question.type === "choice" ? "" : input;
  state.courseAnswerRecorded = true;
  let retryScheduled = false;
  if ((!correct || state.courseHintUsed) && !question.retry) {
    const insertAt = nextRetryIndex(state.courseQuestionIndex, state.courseRound.length);
    state.courseRound.splice(insertAt, 0, { ...question, retry: true });
    retryScheduled = true;
  }
  state.courseFeedback = { correct, retryScheduled };
  render();
  requestAnimationFrame(() => document.querySelector("[data-course-next]")?.focus());
  announce(correct ? "Richtig beantwortet." : `Nicht richtig. Die Lösung ist ${question.answer}.`);
}

function nextCourseQuestion() {
  if (state.courseQuestionIndex + 1 >= state.courseRound.length) return finishCourseRound();
  state.courseQuestionIndex += 1;
  resetCourseAnswer();
  render();
  focusCourseQuestion();
}

function finishCourseRound() {
  const module = selectedCourseModule();
  const result = calculateCourseResult(state.courseAttempts, courseRequiredScore());
  const currentModule = moduleProgress(module.id);
  const previous = packProgress(module.id, state.coursePackIndex);
  const packRecord = {
    attempts: (previous.attempts || 0) + 1,
    bestScore: Math.max(previous.bestScore || 0, result.score || 0),
    passed: Boolean(previous.passed || result.passed),
    lastScore: result.score || 0
  };
  state.courseProgress.modules[module.id] = { ...currentModule, packs: { ...(currentModule.packs || {}), [state.coursePackIndex]: packRecord } };
  state.courseProgress.xp = (state.courseProgress.xp || 0) + state.courseAttempts.reduce((sum, attempt) => sum + (attempt.correct ? attempt.retry ? 3 : attempt.assisted ? 5 : 10 : 0), 0);
  saveCourseProgress();
  state.courseResult = result;
  state.coursePhase = "summary";
  render();
  announce(result.passed ? "Lerneinheit bestanden." : "Lerneinheit noch nicht bestanden.");
}

function renderCourseSummary() {
  const module = selectedCourseModule();
  const result = state.courseResult || calculateCourseResult(state.courseAttempts, courseRequiredScore());
  const info = moduleCourseInfo(module);
  const nextPackIndex = Math.min(state.coursePackIndex + 1, info.packs.length - 1);
  const breakdown = result.skillScores || {};
  const labels = { vocabulary: "Bedeutungen", forms: "Formen", grammar: "Grammatik", reading: "Sätze" };
  app.innerHTML = `<div class="course-summary ${result.passed ? "passed" : ""}">
    <header class="course-summary-hero"><p class="course-kicker">${escapeHtml(module.title)} · Lerneinheit ${state.coursePackIndex + 1}</p><h2>${result.passed ? "Lerneinheit bestanden" : "Lerneinheit wiederholen"}</h2><p>${result.passed ? "Alle Aufgaben dieser Lerneinheit sind geschafft." : `Erforderlich sind ${result.requiredScore || courseRequiredScore()} % im ersten Versuch, mindestens ${result.minimumSkillScore || 60} % je Bereich und jede Korrektur.`}</p><div class="course-score">${result.score || 0} %</div>${result.initialMistakes ? `<small class="meta">${result.correctedMistakes}/${result.initialMistakes} unsichere Antworten korrigiert</small>` : ""}</header>
    <dl class="course-breakdown">${Object.entries(labels).map(([skill, label]) => `<div><dt>${label}</dt><dd>${breakdown[skill]?.score ?? "–"}${Number.isFinite(breakdown[skill]?.score) ? " %" : ""}</dd></div>`).join("")}</dl>
    <div class="course-summary-actions"><button class="button secondary" data-course-map type="button">Kursübersicht</button><button class="button secondary" data-course-retry type="button">Lerneinheit wiederholen</button>${result.passed && state.coursePackIndex < info.packs.length - 1 ? `<button class="button" data-course-next-pack="${nextPackIndex}" type="button">Nächste Lerneinheit</button>` : `<button class="button" data-course-module-return type="button">Zum Modul</button>`}</div>
  </div>`;
}

function focusCourseQuestion() {
  requestAnimationFrame(() => document.querySelector("#course-question")?.focus());
}

async function unlockCourse(code) {
  if (state.courseAccessBusy) return;
  state.courseAccessBusy = true;
  state.courseAccessError = "";
  renderCourseGate();
  try {
    if (!state.courseAccessManifest) throw new Error("Die Codeprüfung ist gerade nicht verfügbar. Prüfe deine Verbindung und lade die Seite neu.");
    const record = await verifyCourseAccessCode(code, state.courseAccessManifest);
    if (!record) throw new Error("Dieser Freischaltcode ist ungültig oder nicht mehr aktiv.");
    const session = await createCourseAccessSession(code, record);
    if (!session) throw new Error("Der Freischaltcode konnte nicht bestätigt werden.");
    saveCourseAccessSession(session);
    state.courseAccessRecord = record;
    state.courseAccessGranted = true;
    state.coursePhase = "map";
    announce("Kurs freigeschaltet.");
  } catch (error) {
    state.courseAccessError = error instanceof Error ? error.message : "Der Code konnte nicht geprüft werden.";
  } finally {
    state.courseAccessBusy = false;
    if (state.courseAccessGranted) renderAtTop();
    else render();
  }
}

function lockCourse() {
  clearCourseAccessSession();
  state.courseAccessGranted = false;
  state.courseAccessRecord = null;
  state.coursePhase = "map";
  state.courseRound = [];
  state.courseAttempts = [];
  render();
  announce("Zugang dieser Sitzung beendet.");
}

function startPractice() {
  const pool = selectPracticeVocabulary(state.vocabulary, state.practiceLessons);
  state.practiceSet = shuffled(pool); state.questionIndex = 0; state._choiceKey = null; state._choices = null; resetQuestion();
  state.practiceAnswered = 0; state.practiceCorrect = 0; state.practiceComplete = false;
}

function selectedPracticeLessons() {
  const available = lessons().map(String);
  if (state.practiceLessons === "all") return available;
  const allowed = new Set(available);
  return (state.practiceLessons || []).map(String).filter(lesson => allowed.has(lesson));
}

function resetQuestion() {
  state.revealed = false;
  state.selectedChoice = null;
  state.feedback = null;
  state.answerRecorded = false;
  state.typedAnswer = "";
}
function currentQuestion() { return state.practiceSet[state.questionIndex]; }

function renderPractice() {
  setHeader("Test", "Üben");
  if (!state.practiceSet.length) startPractice();
  const entry = currentQuestion();
  const availableLessons = lessons();
  const selectedLessons = new Set(selectedPracticeLessons());
  const selectionLabel = state.practiceLessons === "all"
    ? "Alle Lektionen"
    : selectedLessons.size === 1
      ? `1 Lektion ausgewählt`
      : `${selectedLessons.size} Lektionen ausgewählt`;
  const progressCard = entry ? `<section class="card"><div class="card-top"><strong>${state.practiceComplete ? "Test abgeschlossen" : `Frage ${state.questionIndex + 1} von ${state.practiceSet.length}`}</strong><span class="meta">${state.practiceComplete ? selectionLabel : `Lektion ${entry.lektion}`}</span></div><div class="progress-track" style="margin-top:10px" role="progressbar" aria-label="Testfortschritt" aria-valuemin="0" aria-valuemax="${state.practiceSet.length}" aria-valuenow="${state.practiceComplete ? state.practiceSet.length : state.questionIndex}"><div class="progress-fill" style="width:${state.practiceComplete ? 100 : state.questionIndex / state.practiceSet.length * 100}%"></div></div></section>` : `<section class="card"><strong>Wähle mindestens eine Lektion aus.</strong><p class="meta">Du kannst beliebig viele Lektionen für einen gemischten Test kombinieren.</p></section>`;

  app.innerHTML = `<div class="practice-layout"><section class="card control-card"><h3>Vokabeltest</h3><div class="lesson-picker"><button class="lesson-picker-trigger" data-practice-picker type="button" aria-expanded="${state.practicePickerOpen}" aria-controls="practice-lesson-panel"><span><small>Lektionen</small><strong>${selectionLabel}</strong></span><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg></button><div class="lesson-picker-panel" id="practice-lesson-panel" ${state.practicePickerOpen ? "" : "hidden"}><div class="lesson-picker-actions"><button class="text-button" data-practice-select-all type="button">Alle</button><button class="text-button" data-practice-clear type="button">Keine</button></div><div class="lesson-checkbox-grid" role="group" aria-label="Lektionen für den Test auswählen">${availableLessons.map(n => { const count = entriesForLesson(n).length; return `<label class="lesson-checkbox"><input type="checkbox" data-practice-lesson value="${n}" aria-label="Lektion ${n}, ${count} Vokabeln" ${selectedLessons.has(String(n)) ? "checked" : ""}><span aria-hidden="true">${n}</span><small aria-hidden="true">${count}</small></label>`; }).join("")}</div><button class="button secondary lesson-picker-done" data-practice-picker-close type="button">Fertig</button></div></div><div><span class="meta">Modus</span><div class="segments" role="group" aria-label="Testmodus wählen">${[["flashcards","Karte"],["multiple","Auswahl"],["typed","Eingabe"]].map(([id,name]) => `<button class="segment ${state.mode === id ? "active" : ""}" data-mode="${id}" type="button" aria-pressed="${state.mode === id}">${name}</button>`).join("")}</div></div><button class="button secondary" id="shuffle" type="button" ${entry ? "" : "disabled"}>Neu mischen</button></section><div class="practice-stack">${progressCard}${state.practiceComplete ? renderPracticeSummary(selectionLabel) : entry ? renderQuestion(entry) : `<div class="card empty">Keine Testfragen verfügbar.</div>`}</div></div>`;
}

function renderPracticeSummary(selectionLabel) {
  const accuracy = state.practiceAnswered ? Math.round(state.practiceCorrect / state.practiceAnswered * 100) : 0;
  return `<section class="card practice-summary"><span class="practice-summary-mark" aria-hidden="true">${accuracy >= 80 ? "✓" : "↻"}</span><p class="eyebrow">${escapeHtml(selectionLabel)}</p><h2>${accuracy >= 80 ? "Starker Durchgang" : "Weiter üben lohnt sich"}</h2><p>Du hast ${state.practiceCorrect} von ${state.practiceAnswered} Aufgaben richtig beantwortet.</p><strong class="practice-summary-score">${accuracy} %</strong><button class="button" data-practice-restart type="button">Neuen Test mischen</button></section>`;
}

function renderQuestion(entry) {
  if (state.mode === "flashcards") {
    const favorite = progressFor(entry).favorite;
    return `<section class="card question-card"><div class="flashcard-top"><span class="lesson-tag">Lektion ${entry.lektion}</span><button class="favorite-button" data-favorite="${stableId(entry)}" aria-label="${favorite ? "Favorit entfernen" : "Als Favorit markieren"}" type="button">${favorite ? "★" : "☆"}</button></div><div class="question-word">${escapeHtml(entry.latein)}</div>${state.revealed ? `<div class="answer"><strong>${escapeHtml(entry.deutsch)}</strong><small>${escapeHtml(entry.grammatik)}</small></div><div class="button-row"><button class="button secondary" data-result="wrong">Falsch</button><button class="button" data-result="correct">Richtig</button></div>` : `<button class="button" id="reveal" type="button">Antwort zeigen</button>`}</section>`;
  }
  if (state.mode === "multiple") {
    const choices = choicesFor(entry);
    const correction = state.answerRecorded
      ? state.selectedChoice === entry.deutsch
        ? `<p class="feedback success" role="status"><span aria-hidden="true">✓</span> Richtig</p>`
        : `<div class="correction-card" role="status"><strong>✕ Nicht ganz</strong><span>Richtig: ${escapeHtml(entry.deutsch)}</span><small>Deine Antwort: ${escapeHtml(state.selectedChoice)}</small></div>`
      : "";
    const next = state.answerRecorded ? `<div class="practice-actions end"><button class="button" data-next type="button">Weiter</button></div>` : "";
    return `<section class="card question-card"><span class="lesson-tag">Was bedeutet …</span><div class="question-word">${escapeHtml(entry.latein)}</div><div class="choice-list">${choices.map(choice => { const result = answerOptionState(choice, entry.deutsch, state.selectedChoice, state.answerRecorded); const icon = result === "correct" ? `<span class="choice-icon correct-icon" aria-hidden="true">✓</span>` : result === "wrong" ? `<span class="choice-icon wrong-icon" aria-hidden="true">✕</span>` : ""; return `<button class="choice ${result}" data-choice="${escapeHtml(choice)}" ${state.answerRecorded ? "disabled" : ""}><span>${escapeHtml(choice)}</span>${icon}</button>`; }).join("")}</div>${correction}${next}</section>`;
  }
  const typedFeedback = state.answerRecorded
    ? `<p class="feedback ${state.feedback?.correct ? "success" : "error"}"><span aria-hidden="true">${state.feedback?.correct ? "✓" : "✕"}</span> ${state.feedback?.correct ? "Richtig" : `Erwartet: ${escapeHtml(entry.deutsch)}`}</p>`
    : "";
  const typedActions = state.answerRecorded
    ? `<div class="practice-actions"><button class="button" data-next type="button">Weiter</button></div>`
    : `<div class="practice-actions"><button class="button" type="submit">Prüfen</button><button class="button secondary" data-skip type="button">Überspringen</button></div>`;
  return `<section class="card question-card typed-question"><span class="lesson-tag">Deutsche Bedeutung</span><div class="question-word">${escapeHtml(entry.latein)}</div><form class="typed-form" id="typed-form"><input class="field" id="typed-answer" autocomplete="off" placeholder="Antwort eingeben" value="${escapeHtml(state.typedAnswer)}" ${state.answerRecorded ? "disabled" : ""}>${typedFeedback}${typedActions}</form></section>`;
}

function choicesFor(entry) {
  if (state._choiceKey === stableId(entry) && state._choices) return state._choices;
  state._choiceKey = stableId(entry); state._choices = shuffledUniqueMeanings(entry, state.practiceSet);
  return state._choices;
}

function recordAnswer(entry, correct) {
  const p = progressFor(entry);
  updateProgress(entry, { studied: p.studied + 1, answered: p.answered + 1, correct: p.correct + (correct ? 1 : 0) });
  state.practiceAnswered += 1;
  if (correct) state.practiceCorrect += 1;
}

function nextQuestion() {
  if (!state.practiceSet.length) return;
  if (state.questionIndex + 1 >= state.practiceSet.length) {
    state.practiceComplete = true;
    render();
    announce("Test abgeschlossen.");
    return;
  }
  state.questionIndex += 1;
  resetQuestion(); state._choiceKey = null; state._choices = null; render();
}

function renderTranslate() {
  setHeader("Übersetzen");
  const preview = state.translationImageUrl
    ? `<figure class="scan-preview compact"><img src="${escapeHtml(state.translationImageUrl)}" alt="Vorschau des ausgewählten lateinischen Textes"><figcaption>${escapeHtml(state.translationImage?.name || "Ausgewähltes Bild")}</figcaption></figure>`
    : "";
  const ocrStatus = renderOcrStatus();

  app.innerHTML = `<div class="translate-layout compact">
    <section class="card quick-translator">
      <label class="upload-zone ${state.translationBusy ? "busy" : ""}" for="latin-image">
        <span class="upload-icon" aria-hidden="true">▧</span>
        <strong>${state.translationImage ? "Anderes Bild auswählen" : "Bild auswählen"}</strong>
      </label>
      <input class="sr-only" id="latin-image" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" ${state.translationBusy ? "disabled" : ""}>
      ${preview}
      ${ocrStatus}
      <details class="text-review">
        <summary>${state.translationText ? "Erkannten Text prüfen" : "Text stattdessen eingeben"}</summary>
        <form id="translation-form">
          <textarea class="field latin-textarea" id="latin-text" rows="5" placeholder="Lateinischen Text eingeben …" ${state.translationBusy ? "disabled" : ""}>${escapeHtml(state.translationText)}</textarea>
          <button class="button" type="submit" ${state.translationBusy || !state.translationText.trim() ? "disabled" : ""}>Neu übersetzen</button>
        </form>
      </details>
    </section>
    <div id="translation-results">${renderTranslationResults()}</div>
  </div>`;
}

function renderOcrStatus() {
  if (state.translationError) return `<div class="inline-alert error" role="alert">${escapeHtml(state.translationError)}</div>`;
  if (state.translationBusy) {
    return `<div class="ocr-status" role="status"><div class="card-top"><span id="ocr-status-text">${escapeHtml(state.translationStatus || "OCR wird vorbereitet …")}</span><strong id="ocr-progress-value">${Math.round(state.translationProgress * 100)}%</strong></div><div class="progress-track"><div class="progress-fill" id="ocr-progress-fill" style="width:${state.translationProgress * 100}%"></div></div></div>`;
  }
  if (Number.isFinite(state.translationConfidence)) {
    return `<div class="ocr-done">✓ Text erkannt und Formen geprüft</div>`;
  }
  return "";
}

function renderTranslationResults() {
  const analysis = state.translationAnalysis;
  if (!analysis) return "";
  const statusLabels = { exact: "Buchvokabel", "book-form": "Buchform", fallback: "Zusatzwörterbuch", contextual: "Bildvokabel", proper: "Eigenname", corrected: "OCR korrigiert", ambiguous: "Buchbedeutung", candidate: "Form prüfen", unknown: "Nicht gefunden" };
  const sourceLabel = entry => entry.source === "book" ? `Lektion ${entry.lektion}` : entry.source === "glossary" ? "Fußnote im Bild" : entry.source === "proper" ? "Eigenname" : "FreeDict-Zusatzwörterbuch";
  const wordRows = analysis.matches.map(match => {
    const morphology = formatMorphology(match.morphology);
    const details = match.entries.length
      ? `<div class="match-entries">${match.entries.slice(0, 3).map(entry => `<div><strong>${escapeHtml(entry.latein)}</strong><span>${escapeHtml(entry.deutsch)}</span><small>${sourceLabel(entry)}${entry.grammatik ? ` · ${escapeHtml(entry.grammatik)}` : ""}</small></div>`).join("")}${morphology ? `<span class="form-label">${escapeHtml(morphology)}</span>` : ""}</div>`
      : `<p class="meta">Keine sichere Bedeutung gefunden.</p>`;
    return `<article class="word-match ${match.status}"><div class="word-match-head"><strong>${escapeHtml(match.token)}</strong><span>${statusLabels[match.status]}</span></div>${details}</article>`;
  }).join("");
  const grammar = analysis.grammar.length
    ? `<div class="grammar-suggestions">${analysis.grammar.map(rule => Number.isInteger(rule.index)
      ? `<button class="grammar-suggestion" data-grammar-section="${rule.index}" type="button"><strong>${escapeHtml(rule.title)}</strong><small>${escapeHtml(rule.reason)}</small><span aria-hidden="true">›</span></button>`
      : `<article class="grammar-suggestion generated"><strong>${escapeHtml(rule.title)}</strong><small>${escapeHtml(rule.reason)}</small><span>Automatisch ergänzt</span></article>`).join("")}</div>`
    : `<p class="meta">Keine zusätzliche Grammatikregel nötig.</p>`;
  const translationLines = analysis.translation.split("\n").filter(Boolean).map(line => `<p>${escapeHtml(line)}</p>`).join("");
  const translationBadge = analysis.translationReliable ? "Lokal übersetzt" : "Bitte prüfen";

  return `<section class="translation-results" aria-live="polite">
    <section class="card final-translation">
      <div class="card-top"><h2>Übersetzung</h2><span class="coverage-badge${analysis.translationReliable ? "" : " needs-review"}">${translationBadge}</span></div>
      <div class="translated-lines">${translationLines || `<p>Keine Übersetzung möglich.</p>`}</div>
      ${analysis.unresolvedWords ? `<small>${analysis.unresolvedWords} ${analysis.unresolvedWords === 1 ? "Stelle konnte" : "Stellen konnten"} nicht sicher aufgelöst werden.</small>` : ""}
    </section>
    <details class="card analysis-details">
      <summary>Text und Formen prüfen</summary>
      <div class="analysis-content">
        ${state.translationDocument?.detected ? `<p class="document-detection">✓ Lateinischer Haupttext automatisch ausgewählt; Einleitung, Logo und Fußnoten wurden nicht mitübersetzt.</p>` : ""}
        <h3>Korrigierter OCR-Text</h3>
        <pre>${escapeHtml(analysis.correctedText)}</pre>
        ${Number.isFinite(state.translationConfidence) ? `<p class="meta">OCR-Konfidenz: ${state.translationConfidence} % · Akzente und Makron-Verwechslungen wurden für die Formenprüfung normalisiert.</p>` : ""}
        <h3>Formen und Vokabeln</h3>
        <div class="word-analysis">${wordRows}</div>
        <h3>Grammatik</h3>
        ${grammar}
        ${state.translationRawText && state.translationRawText.trim() !== state.translationText.trim() ? `<details class="raw-ocr"><summary>Vollständigen OCR-Text anzeigen</summary><pre>${escapeHtml(state.translationRawText)}</pre></details>` : ""}
        <p class="source-note">Vokabeln aus Bildfußnoten und dem Schulbuch haben Vorrang. Fehlende Bedeutungen stammen aus dem mitgelieferten FreeDict-Wörterbuch (GPL-3.0-or-later).</p>
      </div>
    </details>
  </section>`;
}

function formatMorphology(items = []) {
  const item = items.find(value => value.case || value.mood || value.tense) || items.find(value => value.part);
  if (!item) return "";
  const parts = {
    n: "Substantiv", adj: "Adjektiv", adv: "Adverb", v: "Verb", ppa: "PPA",
    nominative: "Nominativ", genitive: "Genitiv", dative: "Dativ", accusative: "Akkusativ", ablative: "Ablativ",
    singular: "Singular", plural: "Plural", infinitive: "Infinitiv", indicative: "Indikativ", subjunctive: "Konjunktiv", imperative: "Imperativ",
    present: "Präsens", imperfect: "Imperfekt", future: "Futur", perfect: "Perfekt", pluperfect: "Plusquamperfekt", active: "Aktiv", passive: "Passiv"
  };
  return [item.part, ...(item.case || "").split("/"), item.number, item.mood, item.tense, item.voice]
    .filter(Boolean)
    .map(value => parts[value] || value)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" · ");
}

async function runOcr() {
  if (!state.translationImage || state.translationBusy) return;
  const file = state.translationImage;
  const job = ++state.translationJob;
  try {
    validateOcrImage(file);
    state.translationBusy = true;
    state.translationError = "";
    state.translationProgress = 0;
    state.translationStatus = "OCR wird vorbereitet …";
    state.translationConfidence = null;
    state.translationAnalysis = null;
    renderTranslate();
    const morphologyReady = prepareMorphology().catch(() => null);
    let result;
    let browserOcrError = null;
    try {
      result = await recognizeLatinText(file, updateOcrProgress);
    } catch (error) {
      browserOcrError = error;
      result = { text: "", confidence: null };
    }
    if (job !== state.translationJob || file !== state.translationImage) return;
    if (!result.text.trim()) throw browserOcrError || new Error("Auf dem Bild wurde kein lateinischer Text erkannt.");
    state.translationRawText = result.text;
    state.translationConfidence = result.confidence;
    state.translationStatus = "Formen und OCR-Fehler werden geprüft …";
    updateOcrProgress({ status: "checking morphology", progress: .96 });
    await morphologyReady;
    if (job !== state.translationJob) return;
    state.translationMorphology = await analyzeLatinMorphology(result.text).catch(() => new Map());
    if (job !== state.translationJob) return;
    state.translationDocument = extractLatinDocument(result.text, state.translationMorphology);
    state.translationText = state.translationDocument.latinText;
    state.translationGlossary = state.translationDocument.glossary;
    await applyBookAnalysis(job);
  } catch (error) {
    if (job === state.translationJob) state.translationError = friendlyOcrError(error);
  } finally {
    if (job !== state.translationJob) return;
    state.translationBusy = false;
    state.translationProgress = 0;
    state.translationStatus = "";
    if (state.route === "uebersetzen") renderTranslate();
  }
}

function updateOcrProgress(message) {
  const labels = {
    "loading tesseract core": "Lokaler OCR-Kern wird geladen …",
    "initializing tesseract": "OCR wird initialisiert …",
    "loading language traineddata": "Lateinisches Sprachmodell wird geladen …",
    "initializing api": "Texterkennung wird vorbereitet …",
    "recognizing text": "Lateinischer Text wird erkannt …",
    "checking morphology": "Formen und OCR-Fehler werden geprüft …",
    "translating locally": "Deutsche Übersetzung wird formuliert …"
  };
  state.translationStatus = labels[message.status] || "Texterkennung läuft …";
  state.translationProgress = Number.isFinite(message.progress) ? message.progress : state.translationProgress;
  const status = document.querySelector("#ocr-status-text");
  const value = document.querySelector("#ocr-progress-value");
  const fill = document.querySelector("#ocr-progress-fill");
  if (status) status.textContent = state.translationStatus;
  if (value) value.textContent = `${Math.round(state.translationProgress * 100)}%`;
  if (fill) fill.style.width = `${state.translationProgress * 100}%`;
}

function friendlyOcrError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/memory|allocate/i.test(message)) return "Für dieses Bild reicht der Gerätespeicher nicht aus. Bitte verwende einen kleineren Bildausschnitt.";
  if (/fetch|network|load/i.test(message)) return "Die lokalen OCR-Dateien konnten nicht geladen werden. Bitte lade die App neu und versuche es erneut.";
  return message || "Der Text konnte nicht erkannt werden.";
}

async function runBookAnalysis() {
  const text = state.translationText.trim();
  if (!text) {
    state.translationError = "Bitte gib zuerst einen lateinischen Text ein oder erkenne ihn aus einem Bild.";
    renderTranslate();
    return;
  }
  const job = ++state.translationJob;
  try {
    state.translationBusy = true;
    state.translationError = "";
    state.translationStatus = "Formen werden geprüft …";
    state.translationProgress = .96;
    renderTranslate();
    state.translationMorphology = await analyzeLatinMorphology(text).catch(() => new Map());
    if (job !== state.translationJob) return;
    state.translationDocument = extractLatinDocument(text, state.translationMorphology);
    state.translationRawText = text;
    state.translationText = state.translationDocument.latinText;
    state.translationGlossary = state.translationDocument.glossary;
    await applyBookAnalysis(job);
  } finally {
    if (job !== state.translationJob) return;
    state.translationBusy = false;
    state.translationProgress = 0;
    state.translationStatus = "";
    if (state.route === "uebersetzen") {
      renderTranslate();
      document.querySelector("#translation-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

async function applyBookAnalysis(job = state.translationJob) {
  const analysis = analyzeBookText(state.translationText, state.vocabulary, state.grammar, null, [...state.translationGlossary, ...state.fallbackVocabulary], state.translationMorphology);
  state.translationAnalysis = analysis;
  if (analysis.correctedText) state.translationText = analysis.correctedText;
}

function selectTranslationImage(file) {
  if (state.translationBusy) return;
  try {
    validateOcrImage(file);
    if (state.translationImageUrl) URL.revokeObjectURL(state.translationImageUrl);
    state.translationImage = file;
    state.translationImageUrl = URL.createObjectURL(file);
    state.translationText = "";
    state.translationRawText = "";
    state.translationError = "";
    state.translationConfidence = null;
    state.translationAnalysis = null;
    state.translationMorphology = new Map();
    state.translationGlossary = [];
    state.translationDocument = null;
    renderTranslate();
    void runOcr();
  } catch (error) {
    state.translationError = error instanceof Error ? error.message : String(error);
    renderTranslate();
  }
}

function removeTranslationImage() {
  if (state.translationImageUrl) URL.revokeObjectURL(state.translationImageUrl);
  state.translationImage = null;
  state.translationImageUrl = null;
  state.translationConfidence = null;
  state.translationError = "";
  renderTranslate();
}

function selectedGrammarPracticeLessons() {
  const available = lessons().map(Number);
  if (state.grammarPracticeLessons === "all") return available;
  if (Array.isArray(state.grammarPracticeLessons)) {
    const allowed = new Set(available);
    return state.grammarPracticeLessons.map(Number).filter(lesson => allowed.has(lesson));
  }
  return [];
}

function grammarPracticeSelectionLabel() {
  if (state.grammarPracticeLessons === "all") return "Alle Lektionen";
  const selected = selectedGrammarPracticeLessons();
  if (!selected.length) return "Keine ausgewählt";
  if (selected.length === 1) return `Lektion ${selected[0]}`;
  if (selected.length <= 3) return `Lektionen ${selected.join(", ")}`;
  return `${selected.length} Lektionen ausgewählt`;
}

function startGrammarPractice(category = null) {
  const round = buildGrammarPractice(state.grammar, { category, lessons: selectedGrammarPracticeLessons(), limit: 10 });
  state.grammarPracticeCategory = category;
  state.grammarPracticeRound = round;
  state.grammarPracticeIndex = 0;
  state.grammarPracticeSelected = null;
  state.grammarPracticeRecorded = false;
  state.grammarPracticeCorrect = 0;
  state.grammarPracticeComplete = false;
  state.detail = { type: "practice" };
  renderAtTop();
}

function renderGrammarPractice() {
  const round = state.grammarPracticeRound;
  const category = CATEGORIES.find(item => item.id === state.grammarPracticeCategory);
  if (!round.length) {
    app.innerHTML = `<div class="grammar-practice"><button class="text-button" data-grammar-practice-back type="button">← Zur Grammatik</button><div class="card empty">Für diese Auswahl sind noch keine Übungen vorhanden.</div></div>`;
    return;
  }
  if (state.grammarPracticeComplete) {
    const percent = Math.round(state.grammarPracticeCorrect / round.length * 100);
    app.innerHTML = `<div class="grammar-practice"><button class="text-button" data-grammar-practice-back type="button">← Zur Grammatik</button><section class="card grammar-practice-summary"><span class="practice-summary-mark" aria-hidden="true">${percent >= 80 ? "✓" : "↻"}</span><h2>${percent >= 80 ? "Sicher gelöst" : "Noch einmal üben"}</h2><p>${state.grammarPracticeCorrect} von ${round.length} Aufgaben richtig</p><strong class="practice-summary-score">${percent} %</strong><button class="button" data-grammar-practice-restart type="button">Neue Runde</button></section></div>`;
    return;
  }

  const question = round[state.grammarPracticeIndex];
  const progress = Math.round(state.grammarPracticeIndex / round.length * 100);
  const feedback = state.grammarPracticeRecorded
    ? `<div class="grammar-practice-feedback ${state.grammarPracticeSelected === question.answer ? "correct" : "wrong"}" role="status"><strong>${state.grammarPracticeSelected === question.answer ? "Richtig" : `Richtig ist: ${escapeHtml(question.answer)}`}</strong><p>${escapeHtml(question.explanation)}</p></div><button class="button grammar-next" data-grammar-practice-next type="button">${state.grammarPracticeIndex + 1 === round.length ? "Auswertung" : "Weiter"}</button>`
    : "";
  app.innerHTML = `<div class="grammar-practice">
    <button class="text-button" data-grammar-practice-back type="button">← Zur Grammatik</button>
    <section class="grammar-practice-progress"><div class="card-top"><span>${category ? escapeHtml(category.title) : "Gemischte Grammatik"} · ${escapeHtml(grammarPracticeSelectionLabel())}</span><strong>${state.grammarPracticeIndex + 1}/${round.length}</strong></div><div class="progress-track" role="progressbar" aria-label="Übungsfortschritt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><div class="progress-fill" style="width:${progress}%"></div></div></section>
    <section class="card grammar-question-card"><span class="course-skill-tag">${escapeHtml(question.sectionTitle)} · ab Lektion ${question.lesson}</span><h2>${escapeHtml(question.prompt)}</h2><div class="grammar-choice-list">${question.options.map(option => { const optionState = answerOptionState(option, question.answer, state.grammarPracticeSelected, state.grammarPracticeRecorded); return `<button class="grammar-choice ${optionState}" data-grammar-choice="${escapeHtml(option)}" type="button" ${state.grammarPracticeRecorded ? "disabled" : ""}><span>${escapeHtml(option)}</span>${optionState === "correct" ? `<strong aria-hidden="true">✓</strong>` : optionState === "wrong" ? `<strong aria-hidden="true">✕</strong>` : ""}</button>`; }).join("")}</div>${feedback}</section>
  </div>`;
}

function renderGrammar() {
  setHeader("Grammatik", "Lernen und üben");
  if (state.detail?.type === "practice") return renderGrammarPractice();
  if (state.detail?.type === "section") return renderGrammarDetail(state.grammar[state.detail.index]);
  const sections = state.grammar;
  if (state.detail?.type === "category") {
    const cat = CATEGORIES.find(c => c.id === state.detail.id); const items = sections.map((s, i) => ({ s, i: state.grammar.indexOf(s) })).filter(x => categoryFor(x.s) === cat.id);
    app.innerHTML = `<div class="detail-header"><button class="back button secondary" data-grammar-back type="button">← Alle Kategorien</button><h2>${escapeHtml(cat.title)}</h2><p class="meta">Verwandte Formen und Regeln stehen direkt nacheinander.</p><button class="button grammar-category-practice" data-grammar-practice="${escapeHtml(cat.id)}" type="button">Diese Grammatik üben</button></div><div class="grid two">${items.map(({s,i}, position) => `<button class="card category-card" data-grammar-section="${i}" type="button"><span class="category-icon grammar-sequence-number">${position + 1}</span><span><h3>${escapeHtml(s.titel)}</h3><small class="meta">${escapeHtml(label(s.typ))}</small></span></button>`).join("") || `<div class="empty card">Keine Einträge.</div>`}</div>`;
    return;
  }
  const grammarLessons = lessons().map(Number);
  const selectedGrammarLessons = new Set(selectedGrammarPracticeLessons().map(Number));
  const grammarSelection = grammarPracticeSelectionLabel();
  const grammarPickerAction = state.grammarPracticePickerOpen ? "Schließen" : selectedGrammarLessons.size ? "Ändern" : "Auswählen";
  app.innerHTML = `<section class="grammar-practice-entry"><div><h2>Grammatik üben</h2><p>Wähle eine oder mehrere Lektionen für deinen Grammatiktest.</p></div><div class="grammar-practice-controls"><div class="lesson-picker grammar-lesson-picker"><button class="lesson-picker-trigger" data-grammar-picker type="button" aria-expanded="${state.grammarPracticePickerOpen}" aria-controls="grammar-lesson-panel"><span><small>Lektionen</small><strong>${escapeHtml(grammarSelection)}</strong></span><span class="picker-action" aria-hidden="true">${grammarPickerAction}</span></button><div class="lesson-picker-panel" id="grammar-lesson-panel" ${state.grammarPracticePickerOpen ? "" : "hidden"}><div class="lesson-picker-actions"><button class="text-button" data-grammar-select-all type="button">Alle</button><button class="text-button" data-grammar-clear type="button">Keine</button></div><div class="lesson-checkbox-grid" role="group" aria-label="Lektionen für den Grammatiktest auswählen">${grammarLessons.map(lesson => `<label class="lesson-checkbox"><input type="checkbox" data-grammar-practice-lesson value="${lesson}" aria-label="Lektion ${lesson}" ${selectedGrammarLessons.has(lesson) ? "checked" : ""}><span aria-hidden="true">${lesson}</span></label>`).join("")}</div><button class="button secondary lesson-picker-done" data-grammar-picker-close type="button">Fertig</button></div></div><button class="button" data-grammar-practice="all" type="button" ${selectedGrammarLessons.size ? "" : "disabled"}>Grammatiktest starten</button></div></section><div class="section-heading"><h2>Nachschlagen</h2></div><div class="grid two">${CATEGORIES.map(cat => { const count = sections.filter(s => categoryFor(s) === cat.id).length; return count ? `<button class="card category-card" data-category="${cat.id}" type="button"><span class="category-icon">${cat.icon}</span><span><h3>${escapeHtml(cat.title)}</h3><small class="meta">${count} Abschnitte</small></span></button>` : ""; }).join("")}</div>`;
}

function renderGrammarDetail(section) {
  const category = CATEGORIES.find(c => c.id === categoryFor(section));
  const details = Object.entries(section).filter(([key]) => !["typ", "titel", "quelle"].includes(key));
  const related = state.grammar.map((item, index) => ({ item, index })).filter(entry => categoryFor(entry.item) === category.id);
  const position = related.findIndex(entry => entry.item === section);
  const previous = position > 0 ? related[position - 1] : null;
  const next = position >= 0 && position < related.length - 1 ? related[position + 1] : null;
  const sequenceNavigation = `<nav class="grammar-sequence-nav" aria-label="Verwandte Grammatikabschnitte">${previous ? `<button class="button secondary" data-grammar-section="${previous.index}" type="button"><span>← Vorher</span><strong>${escapeHtml(previous.item.titel)}</strong></button>` : `<span></span>`}${next ? `<button class="button secondary" data-grammar-section="${next.index}" type="button"><span>Weiter →</span><strong>${escapeHtml(next.item.titel)}</strong></button>` : ""}</nav>`;
  app.innerHTML = `<div class="detail-header"><button class="back button secondary" data-category="${category.id}" type="button">← ${escapeHtml(category.title)}</button><p class="eyebrow">${escapeHtml(label(section.typ))} · ${position + 1} von ${related.length}</p><h2>${escapeHtml(section.titel)}</h2></div><div class="grammar-values">${details.map(([key,value]) => { const presentation = grammarFieldPresentation(section, key); return `<section class="card grammar-value"><h3>${escapeHtml(presentation.title)}</h3>${presentation.description ? `<p class="grammar-value-description">${escapeHtml(presentation.description)}</p>` : ""}${renderGrammarValue(value, { section, key, title: presentation.title })}</section>`; }).join("")}</div>${sequenceNavigation}`;
}

function grammarFieldPresentation(section, key) {
  const title = String(section?.titel || "");
  if (key === "formen") {
    if (/pronomen/i.test(title)) return { title: `Deklination von ${title.replace(/^.*pronomen\s+/i, "")}`, description: "Die Formen sind nach Numerus, Kasus und Genus geordnet." };
    if (title === "Partizipien Überblick") return { title: "PPA, PPP und PFA im Vergleich", description: "Vergleiche Zeitverhältnis, Handlungsrichtung, lateinische Form und deutsche Übersetzung." };
    if (title === "PPP Bildung und Verwendung") return { title: "PPP-Formen und Übersetzung", description: "Zu jeder Grundform stehen das PPP und seine deutsche Übersetzung." };
    if (/Deklination/.test(title)) return { title: "Deklinationstabelle", description: "Die Formen sind nach Kasus und Numerus geordnet; bei mehreren Wörtern zusätzlich nach Genus." };
    if (title === "Gerundium und Gerundivum") return { title: "Formen und Verwendung", description: "Lateinische Beispiele stehen direkt neben ihrer deutschen Übersetzung." };
    if (title === "Steigerung von Adjektiven und Adverbien") return { title: "Steigerungsformen", description: "Positiv, Komparativ und Superlativ für Adjektiv und Adverb im Vergleich." };
    return { title: "Formtabelle", description: "Die Formen stehen in der Reihenfolge 1. Person Singular bis 3. Person Plural." };
  }
  if (key === "beispielreihen") return { title: "Konjugationsbeispiele", description: "Jede Formenreihe läuft von der 1. Person Singular bis zur 3. Person Plural." };
  if (key === "beispiele") return { title: "Beispiele mit Übersetzung", description: "Die lateinische Konstruktion steht direkt neben der deutschen Übersetzung." };
  if (key === "personalendungen") return { title: "Personalendungen", description: "Die Zeilen zeigen die 1., 2. und 3. Person; die Spalten unterscheiden Singular und Plural." };
  if (key === "praesens_personalendungen") return { title: "Personalendungen im Präsens", description: "Reihenfolge: 1., 2., 3. Person Singular; danach 1., 2., 3. Person Plural." };
  if (key === "beispiele_3_plural") return { title: "Beispielformen in der 3. Person Plural", description: "Die Beispiele zeigen dieselbe Person bei verschiedenen Verben." };
  if (key === "uebersetzungsmoeglichkeiten") return { title: "Mögliche Übersetzungen", description: "Wähle die Übersetzung, die zum Zusammenhang des Satzes passt." };
  if (key === "ppa") return { title: "Partizip Präsens Aktiv (PPA)", description: "Grundform des Partizips im Nominativ Singular." };
  if (["praesens", "imperfekt", "futur", "perfekt", "plusquamperfekt"].includes(key)) return { title: `${label(key)} von ${title}`, description: "Reihenfolge: 1., 2., 3. Person Singular; danach 1., 2., 3. Person Plural." };
  const titles = { bildung: "So wird es gebildet", bildung_aktiv: "Bildung im Aktiv", bildung_passiv: "Bildung im Passiv", imperfekt_bildung: "Bildung des Imperfekts", hinweis: "Wichtig", bedeutung: "Bedeutung", verwendung: "Verwendung", merksatz: "Merksatz", merkbegriff: "Merkbegriff", muster: "Grundformen und Bedeutung" };
  return { title: titles[key] || label(key), description: "" };
}

function renderGrammarValue(value, context = {}) {
  if (value == null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return `<p>${escapeHtml(value)}</p>`;
  if (Array.isArray(value)) {
    if (["praesens", "imperfekt", "futur", "perfekt", "plusquamperfekt", "praesens_personalendungen"].includes(context.key) && value.length === 6) {
      const persons = ["1. Person Singular", "2. Person Singular", "3. Person Singular", "1. Person Plural", "2. Person Plural", "3. Person Plural"];
      return renderTable(value.map((form, index) => ({ person: persons[index], form })), context);
    }
    if (value.every(x => x && typeof x === "object" && !Array.isArray(x))) {
      const expanded = expandGrammarPersonRows(value);
      return renderTable(expanded, { ...context, personExpanded: expanded !== value });
    }
    return `<ul class="grammar-list">${value.map(x => `<li>${renderGrammarValue(x)}</li>`).join("")}</ul>`;
  }
  const matrixRows = context.key === "formen" ? flattenGrammarFormMatrix(value) : [];
  if (matrixRows.length) return renderTable(matrixRows, context);
  const numberRows = flattenNumberFormArrays(value);
  if (numberRows.length) return renderTable(numberRows, context);
  const keys = Object.keys(value);
  if (keys.every(k => Array.isArray(value[k]))) return renderTable(keys.map(k => ({ bereich: label(k), werte: value[k].join(", ") })), context);
  return `<div>${keys.map(k => `<p><strong>${escapeHtml(label(k))}:</strong> ${renderGrammarValue(value[k])}</p>`).join("")}</div>`;
}

function expandGrammarPersonRows(rows) {
  const persons = ["1. Person Singular", "2. Person Singular", "3. Person Singular", "1. Person Plural", "2. Person Plural", "3. Person Plural"];
  if (!rows.some(row => Object.values(row).some(value => Array.isArray(value) && value.length === persons.length))) return rows;
  return rows.flatMap(row => {
    const formKeys = Object.keys(row).filter(key => Array.isArray(row[key]) && row[key].length === persons.length);
    if (!formKeys.length) return [row];
    return persons.map((person, index) => ({
      ...Object.fromEntries(Object.entries(row).filter(([, value]) => !Array.isArray(value))),
      person,
      ...Object.fromEntries(formKeys.map(key => [key, row[key][index]]))
    }));
  });
}

function flattenGrammarFormMatrix(forms) {
  if (!forms || typeof forms !== "object" || !forms.singular || !forms.plural) return [];
  const rows = [];
  for (const [number, cases] of Object.entries(forms)) {
    if (!cases || typeof cases !== "object") return [];
    for (const [grammaticalCase, values] of Object.entries(cases)) {
      if (!Array.isArray(values)) return [];
      rows.push({ numerus: label(number), kasus: label(grammaticalCase), maskulin: values[0], feminin: values[1], neutrum: values[2] });
    }
  }
  return rows;
}

function flattenNumberFormArrays(value) {
  if (!value || !Array.isArray(value.singular) || !Array.isArray(value.plural) || value.singular.length !== value.plural.length) return [];
  return value.singular.map((form, index) => ({ person: `${index + 1}. Person`, singular: form, plural: value.plural[index] }));
}

function renderTable(rows, context = {}) {
  const present = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const priority = ["numerus","kasus","person","konstruktion","konjugation","verb","form","stufe","partizip","zeitverhaeltnis","genus_verbi","singular","plural","maskulin","feminin","neutrum","esse","posse","ire","tempus","aktiv","passiv","ppa","ppp","pfa","infinitiv_futur","adjektiv","adverb","beispiel","latein","deutsch","formen"];
  const columns = [...priority.filter(k => present.includes(k)), ...present.filter(k => !priority.includes(k))];
  return `<div class="grammar-table-wrap"><table class="grammar-table"><caption class="sr-only">${escapeHtml(context.title || "Grammatiktabelle")}</caption><thead><tr>${columns.map(c => `<th>${escapeHtml(grammarColumnLabel(c, context, rows))}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(c => `<td>${escapeHtml(formatScalar(row[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function grammarColumnLabel(column, context, rows) {
  if (column === "formen" && context.personExpanded) return "Lateinische Form";
  if (column === "formen" && context.key === "beispielreihen") return "Formen: 1. Sg. bis 3. Pl.";
  if (column === "form" && context.key === "praesens_personalendungen") return "Endung";
  if (column === "form" && ["praesens", "imperfekt", "futur", "perfekt", "plusquamperfekt"].includes(context.key)) return "Lateinische Form";
  if (["singular", "plural"].includes(column) && context.key === "personalendungen") return `${label(column)}-Endung`;
  if (["maskulin", "feminin", "neutrum"].includes(column) && /Deklination/.test(context.section?.titel || "")) {
    const nominative = rows.find(row => /^Nominativ(?:\s|$)/i.test(String(row.kasus || "")));
    if (nominative?.[column]) return `${nominative[column]} (${label(column)})`;
  }
  return label(column);
}

function formatScalar(value) { if (value == null) return ""; if (Array.isArray(value)) return value.join(", "); if (typeof value === "object") return Object.entries(value).map(([k,v]) => `${label(k)}: ${formatScalar(v)}`).join(" · "); return String(value); }

function renderProgress() {
  setHeader("Sitzung", "Temporärer Fortschritt");
  const all = Object.values(state.progress); const answered = all.reduce((n,p) => n + (p.answered || 0), 0); const correct = all.reduce((n,p) => n + (p.correct || 0), 0); const studied = all.reduce((n,p) => n + (p.studied || 0), 0); const favorites = all.filter(p => p.favorite).length; const accuracy = answered ? Math.round(correct / answered * 100) : 0;
  const moduleInfos = state.course?.modules?.map(module => moduleCourseInfo(module)) || [];
  const coursePacks = moduleInfos.reduce((sum, info) => sum + info.totalPacks, 0);
  const passedCoursePacks = moduleInfos.reduce((sum, info) => sum + info.passedPacks, 0);
  const courseModules = moduleInfos.filter(info => info.totalPacks > 0 && info.passedPacks === info.totalPacks).length;
  const stats = [["Beantwortet",answered],["Richtig",correct],["Genauigkeit",`${accuracy}%`],["Karten geübt",studied],["Favoriten",favorites]];
  const courseStats = [["Lerneinheiten", `${passedCoursePacks}/${coursePacks}`], ["Module gemeistert", `${courseModules}/${moduleInfos.length || 10}`], ["Lernpunkte", state.courseProgress.xp || 0]];
  app.innerHTML = `<div class="section-heading"><h2>Kurs</h2></div><section class="ios-list">${courseStats.map(([name,value]) => `<div class="stat-row"><span>${name}</span><strong>${value}</strong></div>`).join("")}</section><div class="section-heading"><h2>Freies Üben</h2></div><section class="ios-list">${stats.map(([name,value]) => `<div class="stat-row"><span>${name}</span><strong>${value}</strong></div>`).join("")}</section><div class="section-heading"><h2>Lektionen</h2></div><div class="lesson-progress-list ios-list">${lessons().map(n => { const entries = entriesForLesson(n); const done = entries.filter(v => progressFor(v).studied > 0).length; return `<article class="lesson-progress"><div class="card-top"><strong>Lektion ${n}</strong><span class="meta">${done}/${entries.length}</span></div><div class="progress-track" style="margin-top:10px" role="progressbar" aria-label="Lektion ${n}" aria-valuemin="0" aria-valuemax="${entries.length}" aria-valuenow="${done}"><div class="progress-fill" style="width:${done / entries.length * 100}%"></div></div></article>`; }).join("")}</div><div class="reset-row ios-list"><button class="ios-destructive" id="reset-studied" type="button">Angesehene Vokabeln zurücksetzen</button><button class="ios-destructive" id="reset-all" type="button">Alle Lernstände dieser Sitzung zurücksetzen</button></div>`;
}

function showToast(message) { toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800); }

function render() {
  renderNav();
  if (state.route === "kurs") renderCourse();
  if (state.route === "vokabeln") renderVocabularyBrowser();
  if (state.route === "ueben") renderPractice();
  if (state.route === "uebersetzen") renderTranslate();
  if (state.route === "grammatik") renderGrammar();
  if (state.route === "fortschritt") renderProgress();
}

document.addEventListener("click", event => {
  const target = event.target.closest("button"); if (!target) return;
  if (target.dataset.route) navigate(target.dataset.route);
  if (target.hasAttribute("data-course-continue")) {
    const recommended = recommendedCourseTarget();
    state.courseModuleId = recommended.module.id;
    state.coursePackIndex = recommended.packIndex;
    state.coursePhase = "module";
    renderAtTop();
  }
  if (target.hasAttribute("data-course-lock")) lockCourse();
  if (target.dataset.courseModule) {
    const module = state.course.modules.find(item => item.id === target.dataset.courseModule);
    if (module) {
      state.courseModuleId = module.id;
      state.coursePackIndex = moduleCourseInfo(module).status.nextPackIndex ?? 0;
      state.coursePhase = "module";
      renderAtTop();
    }
  }
  if (target.hasAttribute("data-course-map")) { state.coursePhase = "map"; renderAtTop(); }
  if (target.dataset.coursePack != null) { state.coursePackIndex = Number(target.dataset.coursePack); state.coursePhase = "module"; render(); }
  if (target.hasAttribute("data-course-start") || target.hasAttribute("data-course-retry")) startCourseRound();
  if (target.dataset.courseChoice != null && !state.courseAnswerRecorded) recordCourseAnswer(target.dataset.courseChoice);
  if (target.hasAttribute("data-course-hint") && !state.courseAnswerRecorded) {
    state.courseHintUsed = true;
    render();
    requestAnimationFrame(() => document.querySelector("#course-typed-answer")?.focus());
    announce("Hinweis eingeblendet.");
  }
  if (target.hasAttribute("data-course-next")) nextCourseQuestion();
  if (target.dataset.courseNextPack != null) { state.coursePackIndex = Number(target.dataset.courseNextPack); state.coursePhase = "module"; renderAtTop(); }
  if (target.hasAttribute("data-course-module-return")) { state.coursePhase = "module"; renderAtTop(); }
  if (target.dataset.lessonCard) { state.lesson = target.dataset.lessonCard; state.search = ""; render(); }
  if (target.dataset.favorite) {
    const entry = state.vocabulary.find(v => stableId(v) === target.dataset.favorite); const p = progressFor(entry);
    updateProgress(entry, { favorite: !p.favorite }); render(); showToast(!p.favorite ? "Für diese Sitzung gespeichert" : "Favorit entfernt");
  }
  if (target.dataset.mode) { state.mode = target.dataset.mode; resetQuestion(); render(); }
  if (target.hasAttribute("data-payment-retry")) { paypalSdkPromise = null; state.paymentState = "idle"; state.paymentError = ""; render(); }
  if (target.hasAttribute("data-practice-restart")) { startPractice(); render(); announce("Neuer Test gestartet."); }
  if (target.hasAttribute("data-practice-picker")) {
    const wasOpen = state.practicePickerOpen;
    state.practicePickerOpen = !wasOpen;
    if (wasOpen) startPractice();
    render();
    requestAnimationFrame(() => document.querySelector(wasOpen ? "[data-practice-picker]" : "[data-practice-lesson]")?.focus());
  }
  if (target.hasAttribute("data-practice-picker-close")) { state.practicePickerOpen = false; startPractice(); render(); requestAnimationFrame(() => document.querySelector("[data-practice-picker]")?.focus()); announce("Lektionsauswahl übernommen."); }
  if (target.hasAttribute("data-practice-select-all")) { state.practiceLessons = "all"; state.practicePickerOpen = true; render(); requestAnimationFrame(() => document.querySelector("[data-practice-select-all]")?.focus()); announce("Alle Lektionen ausgewählt."); }
  if (target.hasAttribute("data-practice-clear")) { state.practiceLessons = []; state.practicePickerOpen = true; render(); requestAnimationFrame(() => document.querySelector("[data-practice-clear]")?.focus()); announce("Lektionsauswahl geleert."); }
  if (target.hasAttribute("data-grammar-picker")) {
    const wasOpen = state.grammarPracticePickerOpen;
    state.grammarPracticePickerOpen = !wasOpen;
    render();
    requestAnimationFrame(() => document.querySelector(wasOpen ? "[data-grammar-picker]" : "[data-grammar-practice-lesson]")?.focus());
  }
  if (target.hasAttribute("data-grammar-picker-close")) {
    state.grammarPracticePickerOpen = false;
    render();
    requestAnimationFrame(() => document.querySelector("[data-grammar-picker]")?.focus());
    announce("Lektionsauswahl für den Grammatiktest übernommen.");
  }
  if (target.hasAttribute("data-grammar-select-all")) {
    state.grammarPracticeLessons = "all";
    state.grammarPracticePickerOpen = true;
    render();
    requestAnimationFrame(() => document.querySelector("[data-grammar-select-all]")?.focus());
    announce("Alle Lektionen für den Grammatiktest ausgewählt.");
  }
  if (target.hasAttribute("data-grammar-clear")) {
    state.grammarPracticeLessons = [];
    state.grammarPracticePickerOpen = true;
    render();
    requestAnimationFrame(() => document.querySelector("[data-grammar-clear]")?.focus());
    announce("Lektionsauswahl für den Grammatiktest geleert.");
  }
  if (target.id === "shuffle") { startPractice(); render(); }
  if (target.id === "reveal") { state.revealed = true; render(); }
  if (target.dataset.result && !state.answerRecorded) {
    state.answerRecorded = true;
    recordAnswer(currentQuestion(), target.dataset.result === "correct");
    setTimeout(nextQuestion, 350);
  }
  if (target.dataset.choice && !state.answerRecorded) {
    const entry = currentQuestion();
    state.selectedChoice = target.dataset.choice;
    state.answerRecorded = true;
    recordAnswer(entry, target.dataset.choice === entry.deutsch);
    render();
  }
  if (target.hasAttribute("data-next")) nextQuestion();
  if (target.hasAttribute("data-skip") && !state.answerRecorded) {
    state.typedAnswer = "";
    state.feedback = { correct: false, skipped: true };
    state.answerRecorded = true;
    recordAnswer(currentQuestion(), false);
    render();
  }
  if (target.id === "remove-image") removeTranslationImage();
  if (target.hasAttribute("data-grammar-practice")) startGrammarPractice(target.dataset.grammarPractice === "all" ? null : target.dataset.grammarPractice);
  if (target.dataset.grammarChoice != null && !state.grammarPracticeRecorded) {
    state.grammarPracticeSelected = target.dataset.grammarChoice;
    state.grammarPracticeRecorded = true;
    if (state.grammarPracticeSelected === state.grammarPracticeRound[state.grammarPracticeIndex]?.answer) state.grammarPracticeCorrect += 1;
    render();
    requestAnimationFrame(() => document.querySelector("[data-grammar-practice-next]")?.focus());
  }
  if (target.hasAttribute("data-grammar-practice-next")) {
    if (state.grammarPracticeIndex + 1 >= state.grammarPracticeRound.length) state.grammarPracticeComplete = true;
    else {
      state.grammarPracticeIndex += 1;
      state.grammarPracticeSelected = null;
      state.grammarPracticeRecorded = false;
    }
    renderAtTop();
  }
  if (target.hasAttribute("data-grammar-practice-restart")) startGrammarPractice(state.grammarPracticeCategory);
  if (target.hasAttribute("data-grammar-practice-back")) {
    state.detail = state.grammarPracticeCategory ? { type: "category", id: state.grammarPracticeCategory } : null;
    renderAtTop();
  }
  if (target.dataset.category) navigate("grammatik", { type: "category", id: target.dataset.category });
  if (target.dataset.grammarSection != null) navigate("grammatik", { type: "section", index: Number(target.dataset.grammarSection) });
  if (target.hasAttribute("data-grammar-back")) { state.detail = null; render(); }
  if (target.id === "reset-studied" && confirm("Angesehene Vokabeln wirklich zurücksetzen?")) { Object.values(state.progress).forEach(p => p.studied = 0); saveProgress(); render(); }
  if (target.id === "reset-all" && confirm("Alle Lernstände dieser Sitzung und Favoriten löschen?")) { state.progress = {}; state.courseProgress = { xp: 0, modules: {} }; saveProgress(); saveCourseProgress(); render(); }
});

document.addEventListener("input", event => {
  if (event.target.id === "search") {
    const position = event.target.selectionStart;
    state.search = event.target.value;
    renderVocabularyBrowser();
    const replacement = document.querySelector("#search");
    replacement.focus(); replacement.setSelectionRange(position, position);
  }
  if (event.target.id === "typed-answer") state.typedAnswer = event.target.value;
  if (event.target.id === "course-typed-answer") state.courseTypedAnswer = event.target.value;
  if (event.target.id === "latin-text") {
    state.translationText = event.target.value;
    state.translationRawText = "";
    state.translationAnalysis = null;
    state.translationMorphology = new Map();
    state.translationGlossary = [];
    state.translationDocument = null;
    state.translationError = "";
    const results = document.querySelector("#translation-results");
    if (results) results.innerHTML = "";
    const submit = document.querySelector("#translation-form button[type='submit']");
    if (submit) submit.disabled = state.translationBusy || !state.translationText.trim();
  }
});

document.addEventListener("change", event => {
  if (event.target.id === "lesson-filter") { state.lesson = event.target.value; render(); }
  if (event.target.id === "favorite-filter") { state.favoritesOnly = event.target.checked; render(); }
  if (event.target.matches?.("[data-grammar-practice-lesson]")) {
    const changedLesson = Number(event.target.value);
    const selected = new Set(selectedGrammarPracticeLessons().map(Number));
    if (event.target.checked) selected.add(changedLesson); else selected.delete(changedLesson);
    const available = lessons().map(Number);
    const ordered = available.filter(lesson => selected.has(lesson));
    state.grammarPracticeLessons = ordered.length === available.length ? "all" : ordered;
    state.grammarPracticePickerOpen = true;
    render();
    requestAnimationFrame(() => document.querySelector(`[data-grammar-practice-lesson][value="${changedLesson}"]`)?.focus());
    announce(ordered.length === 1 ? "1 Lektion für den Grammatiktest ausgewählt." : `${ordered.length} Lektionen für den Grammatiktest ausgewählt.`);
  }
  if (event.target.matches?.("[data-practice-lesson]")) {
    const changedLesson = event.target.value;
    const selected = new Set(selectedPracticeLessons());
    if (event.target.checked) selected.add(event.target.value); else selected.delete(event.target.value);
    const ordered = lessons().map(String).filter(lesson => selected.has(lesson));
    state.practiceLessons = ordered.length === lessons().length ? "all" : ordered;
    state.practicePickerOpen = true;
    render();
    requestAnimationFrame(() => document.querySelector(`[data-practice-lesson][value="${changedLesson}"]`)?.focus());
    announce(`${ordered.length} Lektionen für den Test ausgewählt.`);
  }
  if (event.target.id === "latin-image") {
    const file = event.target.files?.[0];
    if (!file) return;
    selectTranslationImage(file);
  }
});

document.addEventListener("dragover", event => {
  const zone = event.target.closest?.(".upload-zone");
  if (!zone || state.translationBusy) return;
  event.preventDefault();
  zone.classList.add("dragging");
});

document.addEventListener("dragleave", event => event.target.closest?.(".upload-zone")?.classList.remove("dragging"));

document.addEventListener("drop", event => {
  const zone = event.target.closest?.(".upload-zone");
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove("dragging");
  if (state.translationBusy) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) selectTranslationImage(file);
});

document.addEventListener("submit", event => {
  if (event.target.id === "course-access-form") {
    event.preventDefault();
    const code = new FormData(event.target).get("courseCode")?.toString().trim() || "";
    if (code) void unlockCourse(code);
  }
  if (event.target.id === "course-answer-form") {
    event.preventDefault();
    if (state.courseAnswerRecorded) return;
    const input = document.querySelector("#course-typed-answer")?.value.trim() || "";
    if (input) recordCourseAnswer(input);
  }
  if (event.target.id === "typed-form") {
    event.preventDefault();
    if (state.answerRecorded) return;
    const input = document.querySelector("#typed-answer")?.value.trim() || "";
    if (!input) return;
    const entry = currentQuestion(); const correct = answerMatches(input, entry.deutsch);
    state.typedAnswer = input;
    state.feedback = { correct };
    state.answerRecorded = true;
    recordAnswer(entry, correct);
    render();
  }
  if (event.target.id === "translation-form") {
    event.preventDefault();
    void runBookAnalysis();
  }
});

async function init() {
  try {
    const [vocabularyResponse, grammarResponse, fallbackResponse, courseResponse, accessResponse, paymentResponse] = await Promise.all([
      fetch("data/vocabulary.json"),
      fetch("data/grammar.json"),
      fetch("data/fallback-lexicon.json"),
      fetch("data/course.json"),
      fetch("data/course-access.json", { cache: "no-store" }).catch(() => null),
      fetch("data/payment.json", { cache: "no-store" }).catch(() => null)
    ]);
    if (!vocabularyResponse.ok || !grammarResponse.ok || !courseResponse.ok) throw new Error("Inhalte konnten nicht geladen werden.");
    state.vocabulary = (await vocabularyResponse.json()).filter(v => v.latein?.trim() && v.deutsch?.trim() && !v.grammatik?.toLocaleLowerCase("de").includes("unsicher"));
    state.grammar = orderGrammarSections((await grammarResponse.json()).abschnitte || []);
    state.fallbackVocabulary = fallbackResponse.ok ? (await fallbackResponse.json()).entries || [] : [];
    state.course = await courseResponse.json();
    state.courseAccessManifest = accessResponse?.ok ? await accessResponse.json() : null;
    state.paymentConfig = paymentResponse?.ok ? await paymentResponse.json() : null;
    const storedCourseAccess = loadCourseAccessSession();
    if (storedCourseAccess && state.courseAccessManifest) {
      state.courseAccessRecord = await verifyCourseAccessSession(storedCourseAccess, state.courseAccessManifest);
      state.courseAccessGranted = Boolean(state.courseAccessRecord);
      if (!state.courseAccessGranted) clearCourseAccessSession();
    }
    const hash = location.hash.slice(1);
    if (hash === "lernen") state.route = "kurs";
    else if (ROUTES.has(hash)) state.route = hash;
    startPractice(); render();
  } catch (error) {
    app.innerHTML = `<div class="card empty"><h2>Inhalte fehlen</h2><p>${escapeHtml(error.message)}</p><p>Starte die Seite über einen lokalen Webserver.</p></div>`;
  }
}

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("service-worker.js", { updateViaCache: "none" })
    .then(registration => registration.update())
    .catch(() => {});
}
init();
