import test from "node:test";
import assert from "node:assert/strict";
import { translateLatinSyntax } from "../latin-syntax-translator.js";

/*
 * Broad, synthetic regression corpus for the general translation pipeline.
 * Every sample is assembled from ordinary lexical and morphological records;
 * none of the sentences is present in product data or translation shortcuts.
 */

const lexeme = (lemma, german, pos = "n", extra = {}) => ({
  lemma,
  latein: lemma,
  deutsch: german,
  meanings: [german],
  pos,
  source: "fallback",
  ...extra
});

function word(token, entry, morphology) {
  const analysis = { dictionaryLemma: entry.lemma, ...morphology };
  return {
    token,
    normalized: latinKey(token),
    status: "fallback",
    entries: [entry],
    morphology: [analysis],
    morphologyCandidates: [{ entry, morphology: analysis }],
    length: 1
  };
}

const noun = (token, lemma, german, grammaticalCase, number = "singular", gender = "m", extra = {}) =>
  word(token, lexeme(lemma, german, "n", extra), { part: "n", case: grammaticalCase, number, gender });

const proper = (token, grammaticalCase = "nominative") =>
  word(token, { ...lexeme(token, token, "proper"), source: "proper-context" }, {
    part: "proper",
    case: grammaticalCase,
    number: "singular",
    gender: "m"
  });

const adjective = (token, lemma, german, grammaticalCase, number = "singular", gender = "m") =>
  word(token, lexeme(lemma, german, "adj"), { part: "adj", case: grammaticalCase, number, gender });

const pronoun = (token, lemma, german, grammaticalCase, number = "singular", gender = "m", extra = {}) =>
  word(token, lexeme(lemma, german, "pron"), { part: "pron", case: grammaticalCase, number, gender, ...extra });

const finite = (token, lemma, german, options = {}) => {
  const { entry: entryExtra = {}, ...morphology } = options;
  return word(token, lexeme(lemma, german, "v", entryExtra), {
    part: "v",
    mood: "indicative",
    tense: "present",
    voice: "active",
    person: 3,
    number: "singular",
    ...morphology
  });
};

const infinitive = (token, lemma, german, tense = "present", voice = "active", extra = {}) =>
  word(token, lexeme(lemma, german, "v", extra), { part: "v", mood: "infinitive", tense, voice, ...extra });

const participle = (token, lemma, german, grammaticalCase, number, gender, tense, voice, extra = {}) =>
  word(token, lexeme(lemma, german, "v", extra), {
    part: "ppa",
    mood: "participle",
    case: grammaticalCase,
    number,
    gender,
    tense,
    voice,
    ...extra
  });

const gerund = (token, lemma, german, grammaticalCase) =>
  word(token, lexeme(lemma, german, "v"), {
    part: "gerund",
    nonFinite: "gerund",
    nonFiniteType: "gerund",
    gerundCandidate: true,
    case: grammaticalCase,
    number: "singular",
    gender: "n"
  });

const particle = (token, pos, german = token) =>
  word(token, lexeme(latinKey(token), german, pos), { part: pos });

function translate(words, source = "") {
  return translateLatinSyntax(words, { source });
}

function latinKey(value = "") {
  return String(value)
    .normalize("NFD")
    .toLocaleLowerCase("la")
    .replace(/\p{M}/gu, "")
    .replaceAll("j", "i")
    .replace(/[^a-z]/g, "");
}

function normalizeTag(value = "") {
  return String(value).toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "");
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

function hasTag(root, expected) {
  const wanted = normalizeTag(expected);
  return walk(root).some(node => [node?.type, node?.kind, node?.constructionType, node?.clauseType, node?.relation, node?.role]
    .filter(value => typeof value === "string")
    .some(value => {
      const tag = normalizeTag(value);
      return tag === wanted || tag.includes(wanted) || wanted.includes(tag);
    }));
}

function hasRole(root, expected, token) {
  const wantedRole = normalizeTag(expected);
  const wantedToken = latinKey(token);
  return walk(root).some(node => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;
    const role = normalizeTag(node.role || node.relation || node.type);
    if (!(role === wantedRole || role.includes(wantedRole) || wantedRole.includes(role))) return false;
    return walk(node).some(item => [item?.raw, item?.token, item?.lemma, item?.surface]
      .some(value => latinKey(value) === wantedToken));
  });
}

function assertSentence(result, id) {
  assert.match(result.text, /^[\p{Lu}ÄÖÜ].*[.!?]$/u, `${id}: ${result.text}`);
  assert.doesNotMatch(result.text, /\[[^\]]+\]|\s·\s/u, `${id}: lexical fallback leaked into the result`);
}

test("free Latin constituent order converges on one German clause plan", () => {
  const build = order => {
    const forms = {
      s: noun("servus", "servus", "der Sklave", "nominative"),
      i: noun("puellae", "puella", "das Mädchen", "dative", "singular", "f"),
      o: noun("rosam", "rosa", "die Rose", "accusative", "singular", "f"),
      v: finite("dat", "do", "geben")
    };
    return translate([...order].map(key => forms[key]));
  };
  const variants = ["siov", "osvi", "ivso", "vois"].map(build);

  assert.deepEqual(variants.map(result => result.text), Array(variants.length).fill("Der Sklave gibt dem Mädchen die Rose."));
  for (const result of variants) {
    assert.equal(hasRole(result.pipeline.syntax, "subject", "servus"), true);
    assert.equal(hasRole(result.pipeline.syntax, "direct-object", "rosam"), true);
    assert.equal(hasRole(result.pipeline.syntax, "indirect-object", "puellae"), true);
  }
});

test("subordinate and relative clause corpus keeps German clause-final predicates", () => {
  const samples = [
    {
      id: "relative",
      tag: "relative-clause",
      words: [
        noun("Puella", "puella", "das Mädchen", "nominative", "singular", "f"),
        pronoun("quam", "qui", "die", "accusative", "singular", "f", { pronounKind: "relative" }),
        noun("magister", "magister", "der Lehrer", "nominative"),
        finite("laudat", "laudo", "loben"),
        particle("diligenter", "adv", "fleißig"),
        finite("laborat", "laboro", "arbeiten")
      ],
      pattern: /Mädchen, das der Lehrer lobt,.+arbeitet/iu
    },
    {
      id: "causal",
      tag: "causal",
      words: [
        particle("Quod", "conj", "weil"),
        noun("hostes", "hostis", "der Feind", "nominative", "plural"),
        finite("veniunt", "venio", "kommen", { number: "plural" }),
        noun("cives", "civis", "der Bürger", "nominative", "plural"),
        finite("timent", "timeo", "sich fürchten", { number: "plural" })
      ],
      pattern: /Weil.+Feinde.+kommen,.+(?:Bürger.+fürchten|fürchten.+Bürger|Bürger.+Angst)/iu
    },
    {
      id: "purpose",
      tag: "final",
      words: [
        noun("Dux", "dux", "der Anführer", "nominative"),
        noun("milites", "miles", "der Soldat", "accusative", "plural"),
        finite("misit", "mitto", "schicken", { tense: "perfect" }),
        particle("ut", "conj", "damit"),
        noun("urbem", "urbs", "die Stadt", "accusative", "singular", "f"),
        finite("defenderent", "defendo", "verteidigen", { mood: "subjunctive", tense: "imperfect", number: "plural" })
      ],
      pattern: /Anführer.+(?:schickte|hat.+geschickt).+Soldaten.+damit.+Stadt.+verteidigten/iu
    },
    {
      id: "conditional",
      tag: "conditional",
      words: [
        particle("Si", "conj", "wenn"),
        finite("laboras", "laboro", "arbeiten", { person: 2 }),
        finite("disces", "disco", "lernen", { tense: "future", person: 2 })
      ],
      pattern: /Wenn du arbeitest,.+wirst du lernen/iu
    },
    {
      id: "indirect-question",
      tag: "indirect-question",
      words: [
        noun("Magister", "magister", "der Lehrer", "nominative"),
        finite("rogat", "rogo", "fragen"),
        particle("cur", "adv", "warum"),
        noun("discipuli", "discipulus", "der Schüler", "nominative", "plural"),
        finite("taceant", "taceo", "schweigen", { mood: "subjunctive", number: "plural" })
      ],
      pattern: /Lehrer.+fragt.+warum.+Schüler.+schweigen/iu
    }
  ];

  for (const sample of samples) {
    const result = translate(sample.words);
    assertSentence(result, sample.id);
    assert.equal(hasTag(result.pipeline, sample.tag), true, `${sample.id}: missing ${sample.tag}`);
    assert.match(result.text, sample.pattern, `${sample.id}: ${result.text}`);
    if (sample.id === "indirect-question") assert.doesNotMatch(result.text, /\?$/u);
  }
});

test("active, passive and deponent voices remain semantically distinct", () => {
  const active = translate([
    noun("Mater", "mater", "die Mutter", "nominative", "singular", "f"),
    noun("epistulam", "epistula", "der Brief", "accusative", "singular", "f"),
    finite("scribit", "scribo", "schreiben")
  ]);
  const passive = translate([
    noun("Epistula", "epistula", "der Brief", "nominative", "singular", "f"),
    particle("a", "prep", "von"),
    noun("matre", "mater", "die Mutter", "ablative", "singular", "f"),
    finite("scribitur", "scribo", "schreiben", { voice: "passive" })
  ]);
  const perfectPassive = translate([
    noun("Epistula", "epistula", "der Brief", "nominative", "singular", "f"),
    participle("scripta", "scribo", "schreiben", "nominative", "singular", "f", "perfect", "passive"),
    finite("est", "sum", "sein")
  ]);
  const deponent = translate([
    noun("Miles", "miles", "der Soldat", "nominative"),
    noun("ducem", "dux", "der Anführer", "accusative"),
    finite("sequitur", "sequor", "folgen", {
      voice: "passive",
      deponent: true,
      lexicalVoice: "deponent",
      verbClass: "deponent"
    })
  ]);

  assert.match(active.text, /Mutter.+schreibt.+Brief/iu);
  assert.doesNotMatch(active.text, /wird|worden/iu);
  assert.match(passive.text, /Brief.+wird.+von der Mutter.+geschrieben/iu);
  assert.match(perfectPassive.text, /Brief.+(?:ist.+geschrieben worden|wurde.+geschrieben)/iu);
  assert.match(deponent.text, /Soldat.+folgt.+dem Anführer/iu);
  assert.doesNotMatch(deponent.text, /wird.+gefolgt/iu);
});

test("gerund and gerundive corpus distinguishes purpose, attribute and obligation", () => {
  const gerundResult = translate([
    noun("Ars", "ars", "die Kunst", "nominative", "singular", "f"),
    gerund("dicendi", "dico", "sagen", "genitive"),
    adjective("difficilis", "difficilis", "schwierig", "nominative", "singular", "f"),
    finite("est", "sum", "sein")
  ]);
  const purpose = translate([
    noun("Discipulus", "discipulus", "der Schüler", "nominative"),
    particle("ad", "prep", "zu"),
    gerund("legendum", "lego", "lesen", "accusative"),
    finite("venit", "venio", "kommen", { tense: "perfect" })
  ]);
  const obligation = translate([
    noun("Liber", "liber", "das Buch", "nominative", "singular", "m"),
    noun("discipulo", "discipulus", "der Schüler", "dative"),
    participle("legendus", "lego", "lesen", "nominative", "singular", "m", "future", "passive", { gerundiveCandidate: true }),
    finite("est", "sum", "sein")
  ]);
  const attribute = translate([
    noun("Liber", "liber", "das Buch", "nominative", "singular", "m"),
    participle("legendus", "lego", "lesen", "nominative", "singular", "m", "future", "passive", { gerundiveCandidate: true }),
    finite("iacet", "iaceo", "liegen")
  ]);

  assert.equal(hasTag(gerundResult.pipeline, "gerund"), true);
  assert.match(gerundResult.text, /Kunst.+(?:des Sagens|zu sagen).+schwierig/iu);
  assert.equal(hasTag(purpose.pipeline, "gerund-purpose"), true);
  assert.match(purpose.text, /Schüler.+(?:kam|ist gekommen).+um.+zu lesen/iu);
  assert.equal(hasTag(obligation.pipeline, "gerundive-obligation"), true);
  assert.match(obligation.text, /(?:Schüler.+muss.+Buch.+lesen|Buch.+muss.+(?:vom|von dem) Schüler.+gelesen werden)/iu);
  assert.equal(hasTag(attribute.pipeline, "gerundive-attributive"), true);
  assert.match(attribute.text, /(?:zu lesende|das zu lesende).+Buch.+liegt/iu);
});

test("PPA, PPP and future participles keep their controller and arguments", () => {
  const ppa = translate([
    noun("Puer", "puer", "der Junge", "nominative"),
    noun("librum", "liber", "das Buch", "accusative", "singular", "m"),
    participle("legens", "lego", "lesen", "nominative", "singular", "m", "present", "active"),
    finite("ambulat", "ambulo", "gehen")
  ]);
  const ppp = translate([
    noun("Epistula", "epistula", "der Brief", "nominative", "singular", "f"),
    particle("a", "prep", "von"),
    noun("matre", "mater", "die Mutter", "ablative", "singular", "f"),
    participle("scripta", "scribo", "schreiben", "nominative", "singular", "f", "perfect", "passive"),
    finite("iacet", "iaceo", "liegen")
  ]);
  const future = translate([
    noun("Miles", "miles", "der Soldat", "nominative"),
    noun("urbem", "urbs", "die Stadt", "accusative", "singular", "f"),
    participle("oppugnaturus", "oppugno", "angreifen", "nominative", "singular", "m", "future", "active"),
    finite("venit", "venio", "kommen")
  ]);

  assert.equal(hasTag(ppa.pipeline, "present-participle"), true);
  assert.match(ppa.text, /Junge.+Buch.+(?:liest|lesend).+(?:geht|läuft)|Junge.+(?:geht|läuft).+während.+Buch.+liest/iu);
  assert.equal(hasTag(ppp.pipeline, "perfect-passive-participle"), true);
  assert.match(ppp.text, /Brief.+(?:von der Mutter geschrieben|der.+von der Mutter.+geschrieben wurde).+(?:liegt|befindet)/iu);
  assert.equal(hasTag(future.pipeline, "future-participle"), true);
  assert.match(future.text, /Soldat.+Stadt.+(?:angreifen|angreift).+(?:kommt|kommen wird)|Soldat.+kommt.+um.+Stadt.+anzugreifen/iu);
});

test("ablative absolutes choose temporal, causal and concessive German links from context", () => {
  const samples = [
    {
      relation: "temporal",
      words: [
        noun("Urbe", "urbs", "die Stadt", "ablative", "singular", "f"),
        participle("capta", "capio", "erobern", "ablative", "singular", "f", "perfect", "passive"),
        noun("milites", "miles", "der Soldat", "nominative", "plural"),
        finite("discesserunt", "discedo", "weggehen", { tense: "perfect", number: "plural" })
      ],
      pattern: /^(?:Nachdem|Als).+Stadt.+erobert.+(?:(?:gingen|sind.+weggegangen).+Soldaten|Soldaten.+(?:gingen|sind.+weggegangen))/iu
    },
    {
      relation: "causal",
      words: [
        noun("Hostibus", "hostis", "der Feind", "ablative", "plural"),
        participle("venientibus", "venio", "kommen", "ablative", "plural", "m", "present", "active"),
        particle("itaque", "adv", "deshalb"),
        noun("cives", "civis", "der Bürger", "nominative", "plural"),
        noun("portas", "porta", "das Tor", "accusative", "plural", "f"),
        finite("claudunt", "claudo", "schließen", { number: "plural" })
      ],
      pattern: /^Weil.+Feinde.+kommen,.+(?:schließen.+Bürger|Bürger.+schließen).+Tore/iu
    },
    {
      relation: "concessive",
      words: [
        noun("Hostibus", "hostis", "der Feind", "ablative", "plural"),
        participle("venientibus", "venio", "kommen", "ablative", "plural", "m", "present", "active"),
        particle("tamen", "adv", "dennoch"),
        noun("cives", "civis", "der Bürger", "nominative", "plural"),
        particle("non", "adv", "nicht"),
        finite("timent", "timeo", "sich fürchten", { number: "plural" })
      ],
      pattern: /^Obwohl.+Feinde.+kommen,.+(?:fürchten.+Bürger|Bürger.+fürchten).+nicht/iu
    }
  ];

  for (const sample of samples) {
    const result = translate(sample.words);
    const construction = result.pipeline.grammar.constructions.find(item => item.type === "ablative-absolute");
    assert.ok(construction, `${sample.relation}: missing ablative absolute`);
    assert.equal(construction.relation, sample.relation);
    assert.match(result.text, sample.pattern, `${sample.relation}: ${result.text}`);
  }
});

test("central idioms are productive and independent of Latin word order", () => {
  const cases = [
    {
      orders: [["s", "o", "v"], ["o", "s", "v"]],
      forms: () => ({
        s: proper("Caesar"),
        o: noun("bellum", "bellum", "der Krieg", "accusative", "singular", "n"),
        v: finite("gerit", "gero", "führen")
      }),
      expected: "Caesar führt Krieg."
    },
    {
      orders: [["s", "o", "v"], ["o", "s", "v"]],
      forms: () => ({
        s: proper("Caesar"),
        o: noun("gratiam", "gratia", "der Dank", "accusative", "singular", "f"),
        v: finite("agit", "ago", "sagen")
      }),
      pattern: /Caesar.+dankt/iu
    },
    {
      orders: [["s", "o", "v"], ["o", "s", "v"]],
      forms: () => ({
        s: proper("Caesar"),
        o: noun("iter", "iter", "der Weg", "accusative", "singular", "n"),
        v: finite("facit", "facio", "machen")
      }),
      pattern: /Caesar.+reist/iu
    }
  ];

  for (const sample of cases) {
    const outputs = sample.orders.map(order => {
      const forms = sample.forms();
      return translate(order.map(key => forms[key])).text;
    });
    assert.equal(new Set(outputs).size, 1, outputs.join(" | "));
    if (sample.expected) assert.equal(outputs[0], sample.expected);
    else assert.match(outputs[0], sample.pattern);
  }
});

test("German noun and adjective inflection covers irregular plurals and weak nouns", () => {
  const plural = translate([
    adjective("Multae", "multus", "viele", "nominative", "plural", "f"),
    noun("aquae", "aqua", "das Wasser", "nominative", "plural", "f"),
    adjective("magnas", "magnus", "groß", "accusative", "plural", "f"),
    noun("urbes", "urbs", "die Stadt", "accusative", "plural", "f"),
    finite("delent", "deleo", "zerstören", { number: "plural" })
  ]);
  const weakDative = translate([
    noun("Amicus", "amicus", "der Freund", "nominative"),
    particle("cum", "prep", "mit"),
    adjective("bono", "bonus", "gut", "ablative"),
    noun("domino", "dominus", "der Herr", "ablative"),
    finite("venit", "venio", "kommen")
  ]);
  const weakGenitive = translate([
    noun("Liber", "liber", "das Buch", "nominative", "singular", "n"),
    adjective("boni", "bonus", "gut", "genitive"),
    noun("domini", "dominus", "der Herr", "genitive"),
    finite("manet", "maneo", "bleiben")
  ]);

  assert.match(plural.text, /Viele Wässer.+großen Städte/iu);
  assert.doesNotMatch(plural.text, /die Wasser|die Holze|die Städten/iu);
  assert.match(weakDative.text, /mit dem guten Herrn/iu);
  assert.doesNotMatch(weakDative.text, /mit dem Herr(?:\s|[.!?])/iu);
  assert.match(weakGenitive.text, /des guten Herrn/iu);
  assert.doesNotMatch(weakGenitive.text, /Herrens/iu);
});
