import test from "node:test";
import assert from "node:assert/strict";
import {
  tokenizeTranslationInput,
  resolveMorphology,
  parseLatinSyntax,
  interpretLatinGrammar,
  selectContextualMeanings,
  generateGermanSentence,
  postprocessGerman,
  translateLatinSyntax
} from "../latin-syntax-translator.js";

/*
 * These are deliberately short, synthetic sentences rather than excerpts from
 * the translation corpus.  A test therefore cannot pass by recognizing a
 * stored passage.  Hand-built lexical and morphological input also lets each
 * pipeline stage be tested without making it depend on OCR or dictionary
 * coverage.
 */

const lexeme = (lemma, german, pos, source = "fallback", extra = {}) => ({
  lemma,
  latein: lemma,
  deutsch: german,
  meanings: [german],
  pos,
  source,
  ...extra
});

function match(token, entries, candidates, status = "fallback") {
  const lexicalEntries = Array.isArray(entries) ? entries : [entries];
  const analyses = candidates.map(candidate => candidate.morphology || candidate);
  return {
    token,
    normalized: latinKey(token),
    status,
    entries: lexicalEntries,
    morphology: analyses,
    morphologyCandidates: candidates.map(candidate => candidate.morphology
      ? candidate
      : { entry: lexicalEntries[0], morphology: candidate }),
    length: 1
  };
}

const noun = (token, lemma, german, grammaticalCase, number = "singular", gender = "m", source = "fallback", extra = {}) =>
  match(token, lexeme(lemma, german, "n", source, extra), [{ part: "n", case: grammaticalCase, number, gender }], source === "book" ? "book-form" : "fallback");

const adjective = (token, lemma, german, grammaticalCase, number = "singular", gender = "m") =>
  match(token, lexeme(lemma, german, "adj"), [{ part: "adj", case: grammaticalCase, number, gender }]);

const pronoun = (token, lemma, german, grammaticalCase, number = "singular", gender = "m") =>
  match(token, lexeme(lemma, german, "pron"), [{ part: "pron", case: grammaticalCase, number, gender }]);

const finite = (token, lemma, german, tense = "present", mood = "indicative", voice = "active", person = 3, number = "singular", extra = {}) =>
  match(token, lexeme(lemma, german, "v", "fallback", extra), [{ part: "v", tense, mood, voice, person, number }]);

const infinitive = (token, lemma, german, tense = "present", voice = "active", extra = {}) =>
  match(token, lexeme(lemma, german, "v", "fallback", extra), [{ part: "v", tense, mood: "infinitive", voice }]);

const participle = (token, lemma, german, grammaticalCase, number, gender, tense, voice, extra = {}) =>
  match(token, lexeme(lemma, german, "v", "fallback", extra), [{ part: "ppa", case: grammaticalCase, number, gender, tense, voice, mood: "participle" }]);

const particle = (token, pos, german = token) => match(token, lexeme(latinKey(token), german, pos), [{ part: pos }]);

function runStages(matches) {
  const morphology = resolveMorphology(matches);
  const syntax = parseLatinSyntax(morphology);
  const grammar = interpretLatinGrammar(syntax);
  const semantics = selectContextualMeanings(grammar);
  const generated = generateGermanSentence(semantics);
  return { morphology, syntax, grammar, semantics, generated, text: postprocessGerman(textOf(generated)) };
}

function textOf(value) {
  if (typeof value === "string") return value;
  return value?.text || value?.translation || value?.german || "";
}

function latinKey(value) {
  return String(value || "")
    .normalize("NFD")
    .toLocaleLowerCase("la")
    .replace(/\p{M}/gu, "")
    .replaceAll("j", "i")
    .replace(/[^a-z]/g, "");
}

function wordsOf(value) {
  if (Array.isArray(value)) return value;
  return value?.words || value?.tokens || value?.items || [];
}

function tokenOf(value) {
  return latinKey(value?.token || value?.surface || value?.raw || value?.form || value?.word || "");
}

function candidatesOf(word) {
  return word?.candidates || word?.morphologyCandidates || word?.analyses || (Array.isArray(word?.morphology) ? word.morphology : []);
}

function selectedMorphology(word) {
  return word?.selectedMorphology || word?.selected?.morphology || word?.analysis || (!Array.isArray(word?.morphology) ? word?.morphology : null) || {};
}

function normalizedTag(value) {
  return String(value || "").toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "");
}

function hasTypedNode(root, aliases) {
  const wanted = aliases.map(normalizedTag);
  return walk(root).some(node => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;
    const tags = [node.type, node.kind, node.construction, node.constructionType, node.clauseType, node.relation, node.role]
      .map(normalizedTag)
      .filter(Boolean);
    return tags.some(tag => wanted.some(alias => tag === alias || tag.includes(alias)));
  });
}

function hasRole(root, aliases, expectedToken) {
  const wanted = aliases.map(normalizedTag);
  const token = latinKey(expectedToken);
  return walk(root).some(node => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;
    const tag = normalizedTag(node.role || node.relation || node.type);
    if (wanted.some(alias => tag === alias || tag.includes(alias)) && containsToken(node, token)) return true;
    return Object.entries(node).some(([key, value]) => wanted.some(alias => normalizedTag(key) === alias) && containsToken(value, token));
  });
}

function containsToken(value, expected) {
  if (typeof value === "string") return latinKey(value) === expected;
  return walk(value).some(item => tokenOf(item) === expected || latinKey(item?.lemma) === expected);
}

function walk(root) {
  const values = [];
  const seen = new Set();
  const visit = value => {
    if (value == null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    values.push(value);
    if (Array.isArray(value)) value.forEach(visit);
    else Object.values(value).forEach(visit);
  };
  visit(root);
  return values;
}

function assertContainsWords(text, words) {
  for (const word of words) assert.match(text, new RegExp(word, "iu"), text);
}

test("tokenization preserves punctuation while normalizing macrons and separating enclitics", () => {
  const tokens = tokenizeTranslationInput("Dīxitne puella: «Amīcōsque vidēs?»");
  const normalized = tokens.flatMap(token => [
    tokenOf(token),
    ...(token.enclitics || token.enclitic ? [token.enclitics || token.enclitic].flat().map(latinKey) : [])
  ]).filter(Boolean);

  assert.deepEqual(normalized, ["dixit", "ne", "puella", "amicos", "que", "vides"]);
  assert.ok(tokens.some(token => token.punctuation || token.leadingPunctuation || token.trailingPunctuation), "punctuation must remain available to the parser");
});

test("morphology keeps every candidate and sentence-wide agreement chooses nominative plural", () => {
  const puella = lexeme("puella", "das Mädchen", "n", "book");
  const matches = [
    match("Puellae", puella, [
      { entry: puella, morphology: { part: "n", case: "genitive", number: "singular", gender: "f" } },
      { entry: puella, morphology: { part: "n", case: "dative", number: "singular", gender: "f" } },
      { entry: puella, morphology: { part: "n", case: "nominative", number: "plural", gender: "f" } }
    ], "ambiguous"),
    noun("rosas", "rosa", "die Rose", "accusative", "plural", "f"),
    finite("portant", "porto", "tragen", "present", "indicative", "active", 3, "plural")
  ];

  const morphology = resolveMorphology(matches);
  const girl = wordsOf(morphology).find(word => tokenOf(word) === "puellae");
  assert.ok(girl);
  assert.equal(candidatesOf(girl).length, 3, "candidate analyses must not be discarded before parsing");

  const syntax = parseLatinSyntax(morphology);
  const selectedGirl = walk(syntax).find(word => tokenOf(word) === "puellae" && selectedMorphology(word).case);
  assert.equal(selectedMorphology(selectedGirl).case, "nominative");
  assert.equal(selectedMorphology(selectedGirl).number, "plural");
  assert.ok(hasRole(syntax, ["subject", "subjekt"], "puellae"));
});

test("the parser assigns subject, dative object and accusative object independently of Latin word order", () => {
  const stages = runStages([
    noun("Rosam", "rosa", "die Rose", "accusative", "singular", "f"),
    noun("servus", "servus", "der Sklave", "nominative"),
    noun("puellae", "puella", "das Mädchen", "dative", "singular", "f"),
    finite("dat", "do", "geben")
  ]);

  assert.ok(hasRole(stages.syntax, ["subject", "subjekt"], "servus"));
  assert.ok(hasRole(stages.syntax, ["dativeobject", "indirectobject", "dativobjekt"], "puellae"));
  assert.ok(hasRole(stages.syntax, ["accusativeobject", "directobject", "akkusativobjekt"], "rosam"));
  assertContainsWords(stages.text, ["Sklav", "Mädchen", "Rose", "gibt"]);
  assert.match(stages.text, /^Der Sklave\b/u);
});

test("adjectives are attached by agreement rather than proximity alone", () => {
  const stages = runStages([
    adjective("Magnus", "magnus", "groß", "nominative", "singular", "m"),
    noun("canis", "canis", "der Hund", "nominative"),
    adjective("parvam", "parvus", "klein", "accusative", "singular", "f"),
    noun("puellam", "puella", "das Mädchen", "accusative", "singular", "f"),
    finite("terret", "terreo", "erschrecken")
  ]);

  assert.ok(hasRole(stages.syntax, ["attribute", "modifier", "attribut"], "magnus"));
  assert.ok(hasRole(stages.syntax, ["attribute", "modifier", "attribut"], "parvam"));
  assert.match(stages.text, /große Hund.+kleine Mädchen/iu);
  assert.doesNotMatch(stages.text, /Große erschreckt.+Hund/iu);
});

test("AcI is interpreted as an embedded statement with its own subject and anterior infinitive", () => {
  const stages = runStages([
    noun("Caesar", "Caesar", "Caesar", "nominative", "singular", "m", "proper-context"),
    finite("dicit", "dico", "sagen"),
    noun("milites", "miles", "der Soldat", "accusative", "plural"),
    noun("urbem", "urbs", "die Stadt", "accusative", "singular", "f"),
    infinitive("cepisse", "capio", "erobern", "perfect")
  ]);

  assert.ok(hasTypedNode(stages.grammar, ["aci", "accusativuscuminfinitivo"]));
  assert.ok(hasRole(stages.grammar, ["embeddedsubject", "subjectaccusative", "subjekt"], "milites"));
  assert.match(stages.text, /Caesar.+sagt.+dass.+Soldaten.+Stadt.+(?:erobert|eingenommen).+(?:haben|hätten)/iu);
  assert.doesNotMatch(stages.text, /Soldaten die Stadt (?:erobern|fassen)\.?$/iu);
});

test("NcI promotes the infinitive subject and generates a German passive reporting construction", () => {
  const stages = runStages([
    noun("Milites", "miles", "der Soldat", "nominative", "plural"),
    noun("urbem", "urbs", "die Stadt", "accusative", "singular", "f"),
    infinitive("cepisse", "capio", "erobern", "perfect"),
    finite("dicuntur", "dico", "sagen", "present", "indicative", "passive", 3, "plural")
  ]);

  assert.ok(hasTypedNode(stages.grammar, ["nci", "nominativuscuminfinitivo"]));
  assert.match(stages.text, /Soldaten.+(?:sollen|werden|heißt es).+(?:Stadt).+(?:erobert|eingenommen)/iu);
  assert.doesNotMatch(stages.text, /werden die Stadt erobern gesagt/iu);
});

test("an ablative absolute is a detached temporal construction, not a main-clause object", () => {
  const stages = runStages([
    noun("Urbe", "urbs", "die Stadt", "ablative", "singular", "f"),
    participle("capta", "capio", "erobern", "ablative", "singular", "f", "perfect", "passive"),
    noun("milites", "miles", "der Soldat", "nominative", "plural"),
    finite("discesserunt", "discedo", "weggehen", "perfect", "indicative", "active", 3, "plural")
  ]);

  assert.ok(hasTypedNode(stages.grammar, ["ablativeabsolute", "ablativusabsolutus"]));
  assert.ok(hasRole(stages.syntax, ["subject", "subjekt"], "milites"));
  assert.match(stages.text, /^(?:Nachdem|Als|Nach der).+Stadt.+(?:erobert|Eroberung).+Soldaten/iu);
});

test("PPA and PPP stay attached to their agreeing nouns", () => {
  const ppa = runStages([
    noun("Puer", "puer", "der Junge", "nominative"),
    noun("librum", "liber", "das Buch", "accusative", "singular", "n"),
    participle("legens", "lego", "lesen", "nominative", "singular", "m", "present", "active"),
    particle("in", "prep", "auf"),
    noun("via", "via", "die Straße", "ablative", "singular", "f"),
    finite("ambulat", "ambulo", "gehen")
  ]);
  assert.ok(hasTypedNode(ppa.grammar, ["ppa", "presentparticiple", "participialconstruction"]));
  assert.ok(hasRole(ppa.syntax, ["participle", "participialmodifier", "attribute"], "legens"));
  assertContainsWords(ppa.text, ["Junge", "Buch", "(?:liest|lesend)", "(?:geht|läuft)"]);

  const ppp = runStages([
    noun("Epistula", "epistula", "der Brief", "nominative", "singular", "f"),
    particle("a", "prep", "von"),
    noun("matre", "mater", "die Mutter", "ablative", "singular", "f"),
    participle("scripta", "scribo", "schreiben", "nominative", "singular", "f", "perfect", "passive"),
    finite("iacet", "iaceo", "liegen")
  ]);
  assert.ok(hasTypedNode(ppp.grammar, ["ppp", "perfectpassiveparticiple", "participialconstruction"]));
  assert.match(ppp.text, /(?:von der Mutter geschriebene Brief|Brief.+von der Mutter geschrieben).+(?:liegt|befindet)/iu);
});

test("a gerundive with dative of agent expresses obligation", () => {
  const stages = runStages([
    noun("Liber", "liber", "das Buch", "nominative", "singular", "m"),
    noun("discipulo", "discipulus", "der Schüler", "dative"),
    participle("legendus", "lego", "lesen", "nominative", "singular", "m", "future", "passive", { verbClass: "regular" }),
    finite("est", "sum", "sein")
  ]);

  assert.ok(hasTypedNode(stages.grammar, ["gerundive", "gerundiv", "passiveperiphrastic"]));
  assert.match(stages.text, /(?:Schüler.+muss.+Buch.+lesen|Buch.+muss.+(?:vom|von dem) Schüler.+gelesen werden)/iu);
});

test("clause markers are interpreted from mood, correlatives and context", () => {
  const cases = [
    {
      name: "purpose ut",
      aliases: ["purpose", "final", "finalclause"],
      matches: [
        noun("Dux", "dux", "der Anführer", "nominative"),
        noun("milites", "miles", "der Soldat", "accusative", "plural"),
        finite("misit", "mitto", "schicken", "perfect"),
        particle("ut", "conj", "damit"),
        noun("urbem", "urbs", "die Stadt", "accusative", "singular", "f"),
        finite("defenderent", "defendo", "verteidigen", "imperfect", "subjunctive", "active", 3, "plural")
      ],
      german: /damit.+Stadt.+verteidigten/iu
    },
    {
      name: "consecutive ut",
      aliases: ["consecutive", "consecutiveclause", "konsekutiv"],
      matches: [
        particle("tam", "adv", "so"),
        particle("fortiter", "adv", "tapfer"),
        finite("pugnavit", "pugno", "kämpfen", "perfect"),
        particle("ut", "conj", "dass"),
        pronoun("omnes", "omnis", "alle", "nominative", "plural"),
        pronoun("eum", "is", "ihn", "accusative"),
        finite("laudarent", "laudo", "loben", "imperfect", "subjunctive", "active", 3, "plural")
      ],
      german: /so.+dass.+(?:alle|jeder).+ihn.+lobten/iu
    },
    {
      name: "concessive cum",
      aliases: ["concessive", "concessiveclause", "konzessiv"],
      matches: [
        particle("Cum", "conj", "obwohl"),
        adjective("aeger", "aeger", "krank", "nominative"),
        finite("esset", "sum", "sein", "imperfect", "subjunctive"),
        particle("tamen", "adv", "dennoch"),
        finite("venit", "venio", "kommen", "perfect")
      ],
      german: /Obwohl.+krank.+war.+(?:kam|ist.+gekommen)/iu
    },
    {
      name: "conditional si",
      aliases: ["conditional", "conditionalclause", "konditional"],
      matches: [
        particle("Si", "conj", "wenn"),
        pronoun("hoc", "hic", "dies", "accusative", "singular", "n"),
        finite("fecisses", "facio", "tun", "pluperfect", "subjunctive", "active", 2),
        adjective("laetus", "laetus", "froh", "nominative"),
        finite("fuissem", "sum", "sein", "pluperfect", "subjunctive", "active", 1)
      ],
      german: /Wenn du dies getan hättest.+wäre ich froh gewesen/iu
    }
  ];

  for (const sample of cases) {
    const stages = runStages(sample.matches);
    assert.ok(hasTypedNode(stages.grammar, sample.aliases), `${sample.name}: missing structured clause interpretation`);
    assert.match(stages.text, sample.german, `${sample.name}: ${stages.text}`);
  }
});

test("relative clauses link the relative pronoun to its antecedent", () => {
  const stages = runStages([
    noun("Miles", "miles", "der Soldat", "nominative"),
    pronoun("quem", "qui", "der", "accusative"),
    noun("consul", "consul", "der Konsul", "nominative"),
    finite("laudavit", "laudo", "loben", "perfect"),
    particle("fortiter", "adv", "tapfer"),
    finite("pugnat", "pugno", "kämpfen")
  ]);

  assert.ok(hasTypedNode(stages.grammar, ["relative", "relativeclause", "relativsatz"]));
  assert.ok(hasRole(stages.syntax, ["antecedent", "bezugswort"], "miles"));
  assert.match(stages.text, /Soldat, den der Konsul (?:gelobt hat|lobte),.+kämpft/iu);
});

test("an indirect question is not rendered as a direct question", () => {
  const stages = runStages([
    finite("Rogat", "rogo", "fragen"),
    particle("cur", "adv", "warum"),
    noun("amici", "amicus", "der Freund", "nominative", "plural"),
    finite("discesserint", "discedo", "weggehen", "perfect", "subjunctive", "active", 3, "plural")
  ]);

  assert.ok(hasTypedNode(stages.grammar, ["indirectquestion", "indirektefrage"]));
  assert.match(stages.text, /fragt.+warum.+Freunde.+(?:weggegangen sind|fortgingen|weggingen)/iu);
  assert.doesNotMatch(stages.text, /\?$/u);
});

test("sense selection uses parsed argument semantics, then prefers a compatible textbook sense", () => {
  const visit = lexeme("peto", "aufsuchen", "v", "book", {
    senseId: "peto-visit",
    frames: [{ objectCase: "accusative", objectSemanticClass: "place" }]
  });
  const request = lexeme("peto", "erbitten", "v", "book", {
    senseId: "peto-request",
    frames: [{ objectCase: "accusative", objectSemanticClass: "abstract" }]
  });
  const fallback = lexeme("peto", "fordern", "v", "fallback", {
    senseId: "peto-demand",
    frames: [{ objectCase: "accusative", objectSemanticClass: "abstract" }]
  });
  const verbCandidates = [{ part: "v", tense: "present", mood: "indicative", voice: "active", person: 3, number: "singular" }];
  const make = object => runStages([
    noun("Legatus", "legatus", "der Gesandte", "nominative"),
    object,
    match("petit", [visit, request, fallback], verbCandidates, "ambiguous")
  ]);

  const peace = make(noun("pacem", "pax", "der Frieden", "accusative", "singular", "f", "fallback", { semanticClass: "abstract" }));
  assert.match(peace.text, /Gesandte.+(?:erbittet|bittet).+Frieden/iu);
  assert.doesNotMatch(peace.text, /Frieden aufsucht|Frieden fordert/iu);

  const city = make(noun("urbem", "urbs", "die Stadt", "accusative", "singular", "f", "fallback", { semanticClass: "place" }));
  assert.match(city.text, /Gesandte.+(?:aufsucht.+Stadt|sucht.+Stadt.+auf)/iu);
});

test("generic postprocessing fixes typography without changing lexical content", () => {
  const result = postprocessGerman("  die Frau  kommt , weil der Freund wartet  ");
  assert.equal(result, "Die Frau kommt, weil der Freund wartet.");
});

test("the public translation result exposes pipeline evidence, never translation-memory verification", () => {
  const result = translateLatinSyntax([
    noun("Agricola", "agricola", "der Bauer", "nominative"),
    noun("equum", "equus", "das Pferd", "accusative", "singular", "m"),
    finite("videt", "video", "sehen")
  ]);

  assert.match(textOf(result), /Bauer.+(?:sieht|betrachtet).+Pferd/iu);
  assert.equal(Object.hasOwn(result, "translationVerified"), false);
  assert.equal(Object.hasOwn(result, "verifiedLines"), false);
  assert.equal(Object.hasOwn(result, "memoryMatch"), false);
  assert.ok(result.pipeline || result.analysis || result.syntax || result.stages, "the result must expose structured pipeline evidence for diagnostics");
});

test("AcI keeps the complete embedded noun phrase and German subordinate order", () => {
  const result = translateLatinSyntax([
    infinitive("Patere", "pateo", "offen stehen"),
    adjective("tua", "tuus", "dein", "accusative", "plural", "n"),
    noun("consilia", "consilium", "der Plan", "accusative", "plural", "n"),
    particle("non", "adv", "nicht"),
    finite("sentis", "sentio", "fühlen", "present", "indicative", "active", 2)
  ]);

  assert.match(result.text, /^Du bemerkst nicht, dass deine Pläne offen stehen\.$/u);
  assert.doesNotMatch(result.text, /Du bemerkst dein/iu);
});

test("reliability rejects dangling clause markers and unassigned finite predicates", () => {
  const dangling = translateLatinSyntax([
    particle("Quia", "conj", "weil"),
    noun("puella", "puella", "das Mädchen", "nominative", "singular", "f"),
    finite("venit", "venio", "kommen")
  ]);
  assert.equal(dangling.reliable, false);
  assert.ok(dangling.diagnostics.includes("dangling-clause-marker"));

  const doubled = translateLatinSyntax([
    noun("Puella", "puella", "das Mädchen", "nominative", "singular", "f"),
    finite("cantat", "canto", "singen"),
    noun("puer", "puer", "das Kind", "nominative", "singular", "m"),
    finite("legit", "lego", "lesen")
  ]);
  assert.equal(doubled.reliable, false);
  assert.ok(doubled.diagnostics.includes("unassigned-finite-predicate"));
});

test("reliability rejects a resolved form without a selected German meaning", () => {
  const emptyNoun = lexeme("res", "", "n");
  emptyNoun.meanings = [];
  const result = translateLatinSyntax([
    match("Res", emptyNoun, [{ part: "n", case: "nominative", number: "singular", gender: "f" }]),
    finite("manet", "maneo", "bleiben")
  ]);

  assert.equal(result.reliable, false);
  assert.ok(result.diagnostics.includes("meaning-selection-incomplete"));
  assert.ok(result.unresolved.includes("Res"));
});
