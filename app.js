const NAV = [
  { id: "lernen", label: "Lernen", icon: "book" },
  { id: "ueben", label: "Üben", icon: "cards" },
  { id: "grammatik", label: "Grammatik", icon: "textbook" },
  { id: "fortschritt", label: "Fortschritt", icon: "chart" }
];

const CATEGORIES = [
  { id: "deklinationen", title: "Deklinationen", icon: "▦" },
  { id: "pronomen", title: "Pronomen", icon: "♙" },
  { id: "konjugationen", title: "Konjugationen und Verbformen", icon: "↻" },
  { id: "tempora", title: "Tempora / Zeitformen", icon: "◷" },
  { id: "partizipien", title: "Partizipien", icon: "§" },
  { id: "satzlehre", title: "Satzlehre", icon: "☷" },
  { id: "regeln", title: "Regeln und Merkhilfen", icon: "✦" }
];

const state = {
  vocabulary: [], grammar: [], route: "lernen", detail: null,
  search: "", lesson: "all", favoritesOnly: false,
  practiceLesson: "all", mode: "flashcards", practiceSet: [], questionIndex: 0,
  revealed: false, selectedChoice: null, feedback: null,
  progress: loadProgress()
};

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

function loadProgress() {
  try { return JSON.parse(localStorage.getItem("vocalat-progress") || "{}"); }
  catch { return {}; }
}

function saveProgress() { localStorage.setItem("vocalat-progress", JSON.stringify(state.progress)); }

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
  const labels = { formen: "Formen", form: "Form", kasus: "Kasus", person: "Person", singular: "Singular", plural: "Plural", latein: "Latein", deutsch: "Deutsch", regel: "Regel", beispiele: "Beispiele", beispiel: "Beispiel", bildung: "Bildung", verwendung: "Verwendung", übersetzung: "Übersetzung", merksatz: "Merksatz", maskulin: "Maskulin", feminin: "Feminin", neutrum: "Neutrum" };
  return labels[key.toLowerCase()] || key.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
}

function categoryFor(section) {
  const title = section.titel.toLocaleLowerCase("de");
  if (section.typ === "deklination" || ["a-deklination", "o-deklination", "konsonantisch", "i-deklination", "u-deklination", "e-deklination"].some(x => title.includes(x))) return "deklinationen";
  if (title.includes("pronomen")) return "pronomen";
  if (["partizip", "ppa", "ppp", "gerundium", "gerundivum"].some(x => title.includes(x))) return "partizipien";
  if (["präsens", "imperfekt", "futur", "perfekt", "plusquamperfekt"].some(x => title.includes(x))) return "tempora";
  if (["aci", "nci", "ablativus absolutus"].some(x => title.includes(x))) return "satzlehre";
  if (["konjugation", "passiv", "konjunktiv", "velle", "posse"].some(x => title.includes(x))) return "konjugationen";
  if (section.typ === "konjugation") return "konjugationen";
  if (section.typ === "partizip") return "partizipien";
  return "regeln";
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
    nav.innerHTML = NAV.map(item => `<button class="nav-link ${state.route === item.id ? "active" : ""}" data-route="${item.id}" type="button"><span class="nav-icon" aria-hidden="true">${navIcon(item.icon)}</span><span>${item.label}</span></button>`).join("");
  });
}

function navIcon(name) {
  const paths = {
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5a2.5 2.5 0 0 1 2.5 2.5z"/>',
    cards: '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 1.8h8M2 8v8"/>',
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

function renderLearn() {
  setHeader("Lernen", "Vokabelsammlung");
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

  app.innerHTML = `<div class="toolbar"><label class="search-wrap"><span class="sr-only"></span><input class="field" id="search" type="search" placeholder="Latein, Deutsch, Grammatik" value="${escapeHtml(state.search)}"></label><select class="select" id="lesson-filter" aria-label="Lektion filtern"><option value="all">Alle Lektionen</option>${lessons().map(n => `<option value="${n}" ${state.lesson === String(n) ? "selected" : ""}>Lektion ${n}</option>`).join("")}</select><label class="toggle"><input id="favorite-filter" type="checkbox" ${state.favoritesOnly ? "checked" : ""}> Nur Favoriten</label></div>${lessonCards}<div class="section-heading"><h2>Vokabeln</h2><span>${filtered.length} Einträge</span></div><div class="vocab-list">${filtered.length ? filtered.map(vocabRow).join("") : `<div class="empty card">Keine Treffer. Passe Suche oder Filter an.</div>`}</div>`;
}

function vocabRow(v) {
  const p = progressFor(v); const id = stableId(v);
  return `<article class="card vocab-row"><button class="favorite-button" data-favorite="${id}" aria-label="${p.favorite ? "Favorit entfernen" : "Als Favorit markieren"}" type="button">${p.favorite ? "★" : "☆"}</button><div><div class="word">${escapeHtml(v.latein)}</div><div class="meaning">${escapeHtml(v.deutsch)}</div>${v.grammatik ? `<div class="meta">${escapeHtml(v.grammatik)} · Lektion ${v.lektion}</div>` : `<div class="meta">Lektion ${v.lektion}</div>`}</div></article>`;
}

function startPractice() {
  const pool = state.practiceLesson === "all" ? state.vocabulary : entriesForLesson(state.practiceLesson);
  state.practiceSet = shuffled(pool); state.questionIndex = 0; resetQuestion();
}

function resetQuestion() { state.revealed = false; state.selectedChoice = null; state.feedback = null; }
function currentQuestion() { return state.practiceSet[state.questionIndex % Math.max(state.practiceSet.length, 1)]; }

function renderPractice() {
  setHeader("Test", "Üben");
  if (!state.practiceSet.length) startPractice();
  const entry = currentQuestion();
  app.innerHTML = `<div class="practice-layout"><section class="card control-card"><div><h3>Vokabeltest</h3><p class="meta">Latein lesen, Deutsch antworten</p></div><label><span>Lektion</span><select class="select" id="practice-lesson"><option value="all">Alle Lektionen</option>${lessons().map(n => `<option value="${n}" ${state.practiceLesson === String(n) ? "selected" : ""}>Lektion ${n}</option>`).join("")}</select></label><div><span class="meta">Modus</span><div class="segments">${[["flashcards","Karten"],["multiple","Auswahl"],["typed","Eingabe"]].map(([id,name]) => `<button class="segment ${state.mode === id ? "active" : ""}" data-mode="${id}" type="button">${name}</button>`).join("")}</div></div><button class="button secondary" id="shuffle" type="button">Neu mischen</button></section><div class="practice-stack"><section class="card"><div class="card-top"><strong>Frage ${state.questionIndex + 1} von ${state.practiceSet.length}</strong><span class="meta">Lektion ${entry?.lektion || "–"}</span></div><div class="progress-track" style="margin-top:10px"><div class="progress-fill" style="width:${(state.questionIndex + 1) / Math.max(state.practiceSet.length, 1) * 100}%"></div></div></section>${entry ? renderQuestion(entry) : `<div class="card empty">Keine Testfragen verfügbar.</div>`}</div></div>`;
}

function renderQuestion(entry) {
  if (state.mode === "flashcards") {
    const favorite = progressFor(entry).favorite;
    return `<section class="card question-card"><div class="flashcard-top"><span class="lesson-tag">Lektion ${entry.lektion}</span><button class="favorite-button" data-favorite="${stableId(entry)}" aria-label="${favorite ? "Favorit entfernen" : "Als Favorit markieren"}" type="button">${favorite ? "★" : "☆"}</button></div><div class="question-word">${escapeHtml(entry.latein)}</div>${state.revealed ? `<div class="answer"><strong>${escapeHtml(entry.deutsch)}</strong><small>${escapeHtml(entry.grammatik)}</small></div><div class="button-row"><button class="button secondary" data-result="wrong">Falsch</button><button class="button" data-result="correct">Richtig</button></div>` : `<button class="button" id="reveal" type="button">Antwort zeigen</button>`}</section>`;
  }
  if (state.mode === "multiple") {
    const choices = choicesFor(entry);
    return `<section class="card question-card"><span class="lesson-tag">Was bedeutet …</span><div class="question-word">${escapeHtml(entry.latein)}</div><div class="choice-list">${choices.map(choice => { const selected = state.selectedChoice === choice; const cls = state.selectedChoice ? (choice === entry.deutsch ? "correct" : selected ? "wrong" : "") : ""; return `<button class="choice ${cls}" data-choice="${escapeHtml(choice)}" ${state.selectedChoice ? "disabled" : ""}>${escapeHtml(choice)}</button>`; }).join("")}</div></section>`;
  }
  return `<section class="card question-card"><span class="lesson-tag">Deutsche Bedeutung</span><div class="question-word">${escapeHtml(entry.latein)}</div><form class="typed-form" id="typed-form"><input class="field" id="typed-answer" autocomplete="off" placeholder="Antwort eingeben" ${state.feedback ? "disabled" : ""}><button class="button" type="submit" ${state.feedback ? "disabled" : ""}>Prüfen</button></form>${state.feedback ? `<p class="feedback">${state.feedback.correct ? "Richtig erkannt." : `Erwartet: ${escapeHtml(entry.deutsch)}`}</p>` : ""}</section>`;
}

function choicesFor(entry) {
  if (state._choiceKey === stableId(entry) && state._choices) return state._choices;
  const distractors = shuffled(state.practiceSet.filter(v => v.deutsch !== entry.deutsch).map(v => v.deutsch)).slice(0, 3);
  state._choiceKey = stableId(entry); state._choices = shuffled([entry.deutsch, ...distractors]);
  return state._choices;
}

function normalizeAnswer(value) { return value.toLocaleLowerCase("de").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zäöüß0-9 ]/gi, " ").replace(/\s+/g, " ").trim(); }
function answerMatches(input, answer) {
  const wanted = normalizeAnswer(answer); const got = normalizeAnswer(input);
  return wanted === got || wanted.split(/[,;/]|\boder\b/).map(x => x.replace(/^(der|die|das|zu)\s+/, "").trim()).includes(got.replace(/^(der|die|das|zu)\s+/, ""));
}

function recordAnswer(entry, correct) {
  const p = progressFor(entry);
  updateProgress(entry, { studied: p.studied + 1, answered: p.answered + 1, correct: p.correct + (correct ? 1 : 0) });
}

function nextQuestion() {
  state.questionIndex = (state.questionIndex + 1) % state.practiceSet.length; resetQuestion(); state._choices = null; render();
}

function renderGrammar() {
  setHeader("Grammatik", "Nachschlagen");
  if (state.detail?.type === "section") return renderGrammarDetail(state.grammar[state.detail.index]);
  const query = state.search.toLocaleLowerCase("de");
  const sections = state.grammar.filter(s => !query || `${s.titel} ${s.typ}`.toLocaleLowerCase("de").includes(query));
  if (state.detail?.type === "category") {
    const cat = CATEGORIES.find(c => c.id === state.detail.id); const items = sections.map((s, i) => ({ s, i: state.grammar.indexOf(s) })).filter(x => categoryFor(x.s) === cat.id);
    app.innerHTML = `<div class="detail-header"><button class="back button secondary" data-grammar-back type="button">← Alle Kategorien</button><p class="eyebrow">${escapeHtml(cat.title)}</p><h2>${escapeHtml(cat.title)}</h2></div><div class="grid two">${items.map(({s,i}) => `<button class="card category-card" data-grammar-section="${i}" type="button"><span class="category-icon">${cat.icon}</span><span><h3>${escapeHtml(s.titel)}</h3><small class="meta">${escapeHtml(label(s.typ))}</small></span></button>`).join("") || `<div class="empty card">Keine Treffer.</div>`}</div>`;
    return;
  }
  app.innerHTML = `<div class="toolbar"><label class="search-wrap"><input class="field" id="grammar-search" type="search" placeholder="Abschnitte suchen" value="${escapeHtml(state.search)}"></label></div><div class="grid two">${CATEGORIES.map(cat => { const count = sections.filter(s => categoryFor(s) === cat.id).length; return count ? `<button class="card category-card" data-category="${cat.id}" type="button"><span class="category-icon">${cat.icon}</span><span><h3>${escapeHtml(cat.title)}</h3><small class="meta">${count} Abschnitte</small></span></button>` : ""; }).join("")}</div>`;
}

function renderGrammarDetail(section) {
  const category = CATEGORIES.find(c => c.id === categoryFor(section));
  const details = Object.entries(section).filter(([key]) => !["typ", "titel", "quelle"].includes(key));
  app.innerHTML = `<div class="detail-header"><button class="back button secondary" data-category="${category.id}" type="button">← ${escapeHtml(category.title)}</button><p class="eyebrow">${escapeHtml(label(section.typ))}</p><h2>${escapeHtml(section.titel)}</h2></div><div class="grammar-values">${details.map(([key,value]) => `<section class="card grammar-value"><h3>${escapeHtml(label(key))}</h3>${renderGrammarValue(value)}</section>`).join("")}</div>`;
}

function renderGrammarValue(value) {
  if (value == null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return `<p>${escapeHtml(value)}</p>`;
  if (Array.isArray(value)) {
    if (value.every(x => x && typeof x === "object" && !Array.isArray(x))) return renderTable(value);
    return `<ul class="grammar-list">${value.map(x => `<li>${renderGrammarValue(x)}</li>`).join("")}</ul>`;
  }
  const keys = Object.keys(value);
  if (keys.every(k => Array.isArray(value[k]))) return renderTable(keys.map(k => ({ Form: label(k), Werte: value[k].join(", ") })));
  return `<div>${keys.map(k => `<p><strong>${escapeHtml(label(k))}:</strong> ${renderGrammarValue(value[k])}</p>`).join("")}</div>`;
}

function renderTable(rows) {
  const present = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const priority = present.includes("person") ? ["person","latein","deutsch","esse","posse","ire","tempus","verb"] : ["kasus","singular","plural","maskulin","feminin","neutrum","latein","deutsch"];
  const columns = [...priority.filter(k => present.includes(k)), ...present.filter(k => !priority.includes(k))];
  return `<div class="grammar-table-wrap"><table class="grammar-table"><thead><tr>${columns.map(c => `<th>${escapeHtml(label(c))}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(c => `<td>${escapeHtml(formatScalar(row[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function formatScalar(value) { if (value == null) return ""; if (Array.isArray(value)) return value.join(", "); if (typeof value === "object") return Object.entries(value).map(([k,v]) => `${label(k)}: ${formatScalar(v)}`).join(" · "); return String(value); }

function renderProgress() {
  setHeader("Fortschritt", "Deine Übersicht");
  const all = Object.values(state.progress); const answered = all.reduce((n,p) => n + (p.answered || 0), 0); const correct = all.reduce((n,p) => n + (p.correct || 0), 0); const studied = all.reduce((n,p) => n + (p.studied || 0), 0); const favorites = all.filter(p => p.favorite).length; const accuracy = answered ? Math.round(correct / answered * 100) : 0;
  const stats = [["Beantwortet",answered],["Richtig",correct],["Genauigkeit",`${accuracy}%`],["Karten geübt",studied],["Favoriten",favorites]];
  app.innerHTML = `<div class="section-heading"><h2>Übersicht</h2></div><section class="ios-list">${stats.map(([name,value]) => `<div class="stat-row"><span>${name}</span><strong>${value}</strong></div>`).join("")}</section><div class="section-heading"><h2>Lektionen</h2></div><div class="lesson-progress-list ios-list">${lessons().map(n => { const entries = entriesForLesson(n); const done = entries.filter(v => progressFor(v).studied > 0).length; return `<article class="lesson-progress"><div class="card-top"><strong>Lektion ${n}</strong><span class="meta">${done}/${entries.length}</span></div><div class="progress-track" style="margin-top:10px"><div class="progress-fill" style="width:${done / entries.length * 100}%"></div></div></article>`; }).join("")}</div><div class="reset-row ios-list"><button class="ios-destructive" id="reset-studied" type="button">Angesehene Vokabeln zurücksetzen</button><button class="ios-destructive" id="reset-all" type="button">Fortschritt zurücksetzen</button></div>`;
}

function showToast(message) { toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800); }

function render() {
  renderNav();
  if (state.route === "lernen") renderLearn();
  if (state.route === "ueben") renderPractice();
  if (state.route === "grammatik") renderGrammar();
  if (state.route === "fortschritt") renderProgress();
}

document.addEventListener("click", event => {
  const target = event.target.closest("button"); if (!target) return;
  if (target.dataset.route) navigate(target.dataset.route);
  if (target.dataset.lessonCard) { state.lesson = target.dataset.lessonCard; state.search = ""; render(); }
  if (target.dataset.favorite) {
    const entry = state.vocabulary.find(v => stableId(v) === target.dataset.favorite); const p = progressFor(entry);
    updateProgress(entry, { favorite: !p.favorite }); render(); showToast(!p.favorite ? "Als Favorit gespeichert" : "Favorit entfernt");
  }
  if (target.dataset.mode) { state.mode = target.dataset.mode; resetQuestion(); render(); }
  if (target.id === "shuffle") { startPractice(); render(); }
  if (target.id === "reveal") { state.revealed = true; render(); }
  if (target.dataset.result) { recordAnswer(currentQuestion(), target.dataset.result === "correct"); setTimeout(nextQuestion, 350); }
  if (target.dataset.choice) { const entry = currentQuestion(); state.selectedChoice = target.dataset.choice; recordAnswer(entry, target.dataset.choice === entry.deutsch); render(); setTimeout(nextQuestion, 350); }
  if (target.dataset.category) { state.detail = { type: "category", id: target.dataset.category }; render(); window.scrollTo(0,0); }
  if (target.dataset.grammarSection) { state.detail = { type: "section", index: Number(target.dataset.grammarSection) }; render(); window.scrollTo(0,0); }
  if (target.hasAttribute("data-grammar-back")) { state.detail = null; render(); }
  if (target.id === "reset-studied" && confirm("Angesehene Vokabeln wirklich zurücksetzen?")) { Object.values(state.progress).forEach(p => p.studied = 0); saveProgress(); render(); }
  if (target.id === "reset-all" && confirm("Alle lokalen Übungsdaten und Favoriten löschen?")) { state.progress = {}; saveProgress(); render(); }
});

document.addEventListener("input", event => {
  if (event.target.id === "search") {
    const position = event.target.selectionStart;
    state.search = event.target.value;
    renderLearn();
    const replacement = document.querySelector("#search");
    replacement.focus(); replacement.setSelectionRange(position, position);
  }
  if (event.target.id === "grammar-search") {
    const position = event.target.selectionStart;
    state.search = event.target.value;
    renderGrammar();
    const replacement = document.querySelector("#grammar-search");
    replacement.focus(); replacement.setSelectionRange(position, position);
  }
});

document.addEventListener("change", event => {
  if (event.target.id === "lesson-filter") { state.lesson = event.target.value; render(); }
  if (event.target.id === "favorite-filter") { state.favoritesOnly = event.target.checked; render(); }
  if (event.target.id === "practice-lesson") { state.practiceLesson = event.target.value; startPractice(); render(); }
});

document.addEventListener("submit", event => {
  if (event.target.id !== "typed-form") return; event.preventDefault();
  const input = document.querySelector("#typed-answer").value; const entry = currentQuestion(); const correct = answerMatches(input, entry.deutsch);
  state.feedback = { correct }; recordAnswer(entry, correct); render(); setTimeout(nextQuestion, 350);
});

async function init() {
  try {
    const [vocabularyResponse, grammarResponse] = await Promise.all([fetch("data/vocabulary.json"), fetch("data/grammar.json")]);
    if (!vocabularyResponse.ok || !grammarResponse.ok) throw new Error("Inhalte konnten nicht geladen werden.");
    state.vocabulary = (await vocabularyResponse.json()).filter(v => v.latein?.trim() && v.deutsch?.trim() && !v.grammatik?.toLocaleLowerCase("de").includes("unsicher"));
    state.grammar = (await grammarResponse.json()).abschnitte || [];
    const hash = location.hash.slice(1); if (NAV.some(n => n.id === hash)) state.route = hash;
    startPractice(); render();
  } catch (error) {
    app.innerHTML = `<div class="card empty"><h2>Inhalte fehlen</h2><p>${escapeHtml(error.message)}</p><p>Starte die Seite über einen lokalen Webserver.</p></div>`;
  }
}

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("service-worker.js");
init();
