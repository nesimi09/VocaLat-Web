/**
 * Didactic ordering for the grammar reference.
 *
 * The exact priorities cover every title currently shipped in grammar.json.
 * Semantic fallbacks keep newly added, recognisable sections in the right
 * neighbourhood; titles we do not know remain stable at the end.
 */

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("de");
}

const EXACT_PRIORITIES = new Map([
  // Deklinationen: vom häufigsten Grundmuster zu den späteren Klassen.
  ["a-Deklination – serva, servae f.", 100],
  ["o-Deklination – avus und bellum", 110],
  ["Konsonantische Deklination – clamor, mater und litus", 120],
  ["i-Deklination – civis, navis und mare", 130],
  ["u-Deklination – exercitus, manus und cornu", 140],
  ["e-Deklination – res, rei f.", 150],

  // Pronomen: das zeigende Muster vor dem satzverknüpfenden Relativpronomen.
  ["Demonstrativpronomen iste, ista, istud", 200],
  ["Relativpronomen qui, quae, quod", 210],

  // Verbgrundlagen und Präsens. Die Tabelle selbst führt esse, posse, ire.
  ["Präsens von esse, posse und ire", 300],

  // Indikativische Tempora: Bildung jeweils direkt vor den Sonderformen.
  ["Imperfekt Aktiv", 400],
  ["Imperfekt von esse, posse und ire", 410],
  ["Futur I Aktiv", 500],
  ["Futur I von esse, posse und ire", 510],
  ["Perfekt, Plusquamperfekt und Futur II Aktiv", 600],
  ["Perfekt von esse, posse und ire", 610],
  ["Plusquamperfekt von esse, posse und ire", 700],
  ["Futur II von esse, posse und ire", 800],
  ["velle", 850],

  // Genus Verbi und Modus.
  ["Passiv: Präsens, Imperfekt und Futur I", 900],
  ["Passiv: Perfekt, Plusquamperfekt und Futur II", 910],
  ["Konjunktiv Präsens Aktiv und Passiv", 1000],
  ["Konjunktiv Imperfekt Aktiv und Passiv", 1010],
  ["Konjunktiv Perfekt Aktiv und Passiv", 1020],
  ["Konjunktiv Plusquamperfekt Aktiv", 1030],
  ["Konjunktiv Plusquamperfekt Passiv", 1031],

  // Infinite Verbformen.
  ["Partizipien Überblick", 1100],
  ["PPA und seine Übersetzung", 1110],
  ["PPP Bildung und Verwendung", 1120],
  ["PFA und Infinitiv Futur Aktiv", 1130],
  ["Gerundium und Gerundivum", 1140],

  // Satzlehre: erst abhängige Aussagen, dann Partizipialkonstruktionen.
  ["AcI und NcI", 1200],
  ["Ablativus absolutus", 1210],

  // Ergänzende Regeln.
  ["Adverbien der i-Deklination", 1300],
  ["Steigerung von Adjektiven und Adverbien", 1310]
].map(([title, priority]) => [normalizeTitle(title), priority]));

function irregularVerbOffset(title) {
  const hasEsse = /(?:^|\W)esse(?:\W|$)/u.test(title);
  const hasPosse = /(?:^|\W)posse(?:\W|$)/u.test(title);
  const hasIre = /(?:^|\W)ire(?:\W|$)/u.test(title);

  // A combined overview starts with esse. Individual future sections retain
  // the required esse -> posse -> ire sequence.
  if (hasEsse) return 0;
  if (hasPosse) return 1;
  if (hasIre) return 2;
  return 8;
}

function declensionPriority(title) {
  if (/\ba-deklination\b/u.test(title)) return 100;
  if (/\bo-deklination\b/u.test(title)) return 110;
  if (/konsonantische? deklination/u.test(title)) return 120;
  if (/\bi-deklination\b/u.test(title)) return 130;
  if (/\bu-deklination\b/u.test(title)) return 140;
  if (/\be-deklination\b/u.test(title)) return 150;
  return 180;
}

function tensePriority(title) {
  if (title.includes("prasens")) return 300;
  if (title.includes("imperfekt")) return 400;
  if (title.includes("futur i") && !title.includes("futur ii")) return 500;
  if (title.includes("perfekt") && !title.includes("plusquamperfekt")) return 600;
  if (title.includes("plusquamperfekt")) return 700;
  if (title.includes("futur ii")) return 800;
  return null;
}

function semanticPriority(section) {
  const title = normalizeTitle(section?.titel);
  const type = normalizeTitle(section?.typ);
  const exact = EXACT_PRIORITIES.get(title);
  if (exact != null) return exact;

  // More specific constructions must be checked before their tense words.
  if (/\b(aci|nci)\b/u.test(title)) return 1200;
  if (title.includes("ablativus absolutus")) return 1210;

  if (title.includes("partizipien") && title.includes("uberblick")) return 1100;
  if (/\bppa\b/u.test(title)) return 1110;
  if (/\bppp\b/u.test(title)) return 1120;
  if (/\bpfa\b/u.test(title)) return 1130;
  if (title.includes("gerundium") || title.includes("gerundivum")) return 1140;
  if (type === "partizip") return 1190;

  if (title.includes("konjunktiv")) {
    const tense = tensePriority(title) ?? 390;
    const tenseOffset = new Map([[300, 0], [400, 10], [600, 20], [700, 30], [500, 40], [800, 50]]).get(tense) ?? 90;
    const voiceOffset = title.includes("passiv") && !title.includes("aktiv") ? 1 : 0;
    return 1000 + tenseOffset + voiceOffset;
  }

  if (title.includes("passiv")) {
    const perfectSystem = title.includes("perfekt") || title.includes("plusquamperfekt") || title.includes("futur ii");
    return perfectSystem ? 910 : 900;
  }

  if (title.includes("pronomen")) {
    if (title.includes("demonstrativ")) return 200;
    if (title.includes("relativ")) return 210;
    return 290;
  }

  // Adverb rules contain declension names but belong with the general rules.
  if (title.includes("adverb")) return title.includes("steigerung") ? 1310 : 1300;
  if (title.includes("steigerung")) return 1310;

  if (type === "deklination" || title.includes("deklination")) return declensionPriority(title);

  if (title === "esse") return 300;
  if (title === "posse") return 301;
  if (title === "ire") return 302;
  if (title === "velle") return 850;

  const tense = tensePriority(title);
  if (tense != null) {
    const irregularOffset = irregularVerbOffset(title);
    return tense + (irregularOffset < 8 ? 10 + irregularOffset : 0);
  }

  if (type === "konjugation" || title.includes("konjugation")) return 390;
  if (type === "regel") return 1390;
  return Number.POSITIVE_INFINITY;
}

/** Maps a grammar section to the reference category shown in the UI. */
export function grammarCategory(section) {
  const title = normalizeTitle(section?.titel);
  const type = normalizeTitle(section?.typ);
  if (title.includes("adverb") || title.includes("steigerung")) return "regeln";
  if (title.includes("pronomen")) return "pronomen";
  if (["partizip", "ppa", "ppp", "gerundium", "gerundivum"].some(term => title.includes(term)) || type === "partizip") return "partizipien";
  if (/\b(aci|nci)\b/u.test(title) || title.includes("ablativus absolutus")) return "satzlehre";
  if (type === "deklination" || title.includes("deklination")) return "deklinationen";
  if (type === "konjugation" || ["konjugation", "passiv", "konjunktiv", "velle", "posse", "esse"].some(term => title.includes(term)) || /(?:^|\W)ire(?:\W|$)/u.test(title)) return "konjugationen";
  if (["prasens", "imperfekt", "futur", "perfekt", "plusquamperfekt"].some(term => title.includes(term))) return "tempora";
  return "regeln";
}

/**
 * Returns a newly allocated, didactically ordered array without modifying the
 * input. Equal and unknown entries keep their original relative order.
 */
export function orderGrammarSections(sections) {
  if (!Array.isArray(sections)) throw new TypeError("sections must be an array");

  return sections
    .map((section, originalIndex) => ({ section, originalIndex, priority: semanticPriority(section) }))
    .sort((left, right) => left.priority - right.priority || left.originalIndex - right.originalIndex)
    .map(({ section }) => section);
}

export const sortGrammarSections = orderGrammarSections;
