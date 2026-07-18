import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(resolve(root, "app.js"), "utf8");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const styles = readFileSync(resolve(root, "styles.css"), "utf8");

test("course screens and every primary course action are wired", () => {
  for (const renderer of ["renderCourseGate", "renderCourseMap", "renderCourseModule", "renderCourseQuiz", "renderCourseSummary"]) {
    assert.match(app, new RegExp(`function ${renderer}\\(`));
  }
  for (const action of [
    "data-course-continue",
    "data-course-module",
    "data-course-pack",
    "data-course-start",
    "data-course-choice",
    "data-course-hint",
    "data-course-next",
    "data-course-retry",
    "data-course-next-pack",
    "data-course-lock"
  ]) assert.match(app, new RegExp(action));
  assert.match(app, /event\.target\.id === "course-access-form"/);
  assert.match(app, /event\.target\.id === "course-answer-form"/);
  assert.match(app, /verifyCourseAccessSession\(storedCourseAccess/);
});

test("course accessibility and mobile feedback are present", () => {
  assert.match(html, /rel="icon" href="assets\/icon-192\.png"/);
  assert.match(html, /class="skip-link" href="#main"/);
  assert.match(html, /id="announcer"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.doesNotMatch(html, /id="app"[^>]*aria-live/);
  assert.match(app, /aria-current="page"/);
  assert.match(app, /aria-pressed=/);
  assert.match(app, /role="progressbar"/);
  assert.match(app, /aria-label="Kursfortschritt"/);
  assert.match(app, /class="feedback success" role="status"/);
  assert.match(app, /lang="la"/);
  assert.match(styles, /\.course-choice\.correct[^}]*background:/s);
  assert.match(styles, /\.course-choice\.wrong[^}]*background:/s);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.course-overview-actions/);
});

test("course and vocabulary are separate top-level destinations", () => {
  const navBlock = app.match(/const NAV = \[([\s\S]*?)\];/)?.[1] || "";
  const ids = [...navBlock.matchAll(/id: "([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids, ["kurs", "vokabeln", "ueben", "uebersetzen", "grammatik"]);
  assert.match(app, /state\.route === "kurs"\) renderCourse\(\)/);
  assert.match(app, /state\.route === "vokabeln"\) renderVocabularyBrowser\(\)/);
  assert.doesNotMatch(app, /learnView|learnSwitcher|data-learn-view/);
  assert.match(app, /data-route="fortschritt"/);
});

test("course progress and access remain session-bound", () => {
  assert.match(app, /const COURSE_ACCESS_KEY/);
  assert.match(app, /const COURSE_PROGRESS_KEY/);
  assert.match(app, /sessionStorage\.setItem\(COURSE_ACCESS_KEY/);
  assert.match(app, /sessionStorage\.setItem\(COURSE_PROGRESS_KEY/);
  assert.doesNotMatch(app, /localStorage\.setItem/);
});

test("free practice supports an accessible multi-lesson selection", () => {
  assert.match(app, /practiceLessons:\s*"all"/);
  assert.match(app, /class="lesson-picker-trigger"/);
  assert.match(app, /aria-expanded=/);
  assert.match(app, /data-practice-picker-close/);
  assert.match(app, /data-practice-lesson/);
  assert.match(app, /data-practice-select-all/);
  assert.match(app, /data-practice-clear/);
  assert.match(app, /new Set\(selectedPracticeLessons\(\)\)/);
  assert.match(styles, /\.lesson-checkbox-grid/);
  assert.doesNotMatch(app, /Latein lesen, Deutsch antworten|class="lesson-multiselect"/);
  assert.doesNotMatch(styles, /lesson-multiselect|content:\s*"⌄"|content:\s*"⌃"/);
});

test("course gate keeps PayPal and course codes without extra introductory copy", () => {
  assert.match(app, /4,99 € monatlich/);
  assert.match(app, /paypal-subscription-buttons/);
  assert.match(app, /class="course-code-access"/);
  assert.match(app, /actions\.subscription\.create/);
  assert.match(app, /plan_id:\s*state\.paymentConfig\.planId/);
  assert.doesNotMatch(app, /Monatszugang mit PayPal|Freischaltung für den vollständigen Kurs|PayPal-Sandbox bereit|Derzeit wird kein echtes Geld abgebucht|Nach der Bestätigung gilt der Zugang|10 Module ·|Via Latina|Kurszugang/);
  assert.doesNotMatch(app, /Prototyp|Latein verstehen – Schritt für Schritt|Mit PayPal testen/);
  assert.doesNotMatch(app, /course-gate-hero|course-map-hero|course-chip/);
  assert.doesNotMatch(app, /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
});

test("course pages use a quiet linear structure instead of dashboard cards", () => {
  assert.match(app, /class="course-benefits"/);
  assert.match(app, /Das lernst du im Kurs/);
  assert.doesNotMatch(app, /Kursinhalt|Der Code und der Kursstand werden nicht dauerhaft/);
  assert.match(app, /class="course-module-list"/);
  assert.match(app, /class="course-overview"/);
  assert.match(styles, /\/\* Calm, content-first course layout \*\/[\s\S]*\.course-module\s*\{[\s\S]*?border-radius:\s*0/);
});

test("grammar reference uses the ordered sequence and related navigation", () => {
  assert.match(app, /orderGrammarSections\(\(await grammarResponse\.json\(\)\)\.abschnitte/);
  assert.match(app, /class="grammar-sequence-nav"/);
  assert.match(app, /Verwandte Formen und Regeln stehen direkt nacheinander/);
  assert.match(app, /data-grammar-practice/);
  assert.match(app, /function renderGrammarPractice/);
  assert.doesNotMatch(app, /id="grammar-search"|Abschnitte suchen/);
});

test("translation uses the complete local vocabulary without a lesson gate", () => {
  assert.doesNotMatch(app, /Vokabelstand|translation-lesson|Foto oder Screenshot · die Übersetzung startet automatisch/);
  assert.match(app, /analyzeBookText\(state\.translationText, state\.vocabulary, state\.grammar, null/);
});

test("session-only implementation details are not shown to learners", () => {
  assert.doesNotMatch(app, /Dieser Fortschritt, deine Favoriten und der Kursstand gelten nur für die aktuelle Browser-Sitzung/);
  assert.doesNotMatch(app, /Kurspakete|\bPaket(?:e|en)?\b/);
  assert.match(app, /Lerneinheiten/);
});

test("grammar practice is limited by the learner's current lesson", () => {
  assert.match(app, /id="grammar-practice-lesson"/);
  assert.match(app, /grammarPracticeMaxLesson/);
  assert.match(app, /maxLesson: state\.grammarPracticeMaxLesson/);
  assert.match(app, /Array\.from\(\{ length: 31 \}/);
  assert.match(app, /nur Aufgaben zu Grammatik, die bis zu deiner Lektion vorkommt/);
  assert.doesNotMatch(app, /if \(!round\.length && category\)/);
});
