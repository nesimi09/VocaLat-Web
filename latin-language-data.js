/**
 * Declarative language data for the deterministic Latin -> German pipeline.
 *
 * These records are intentionally separate from the parser and realiser. New
 * valency frames and idioms can be added here without adding sentence-shaped
 * branches to the translation code.
 */

export const SOURCE_WEIGHTS = Object.freeze({
  book: 18,
  glossary: 15,
  grammar: 14,
  "proper-context": 11,
  fallback: 8,
  proper: 5
});

const irregularForms = {};
const addIrregularParadigm = (lemma, german, tense, forms, mood = "indicative") => {
  forms.forEach((form, offset) => {
    if (!form) return;
    const person = offset % 3 + 1;
    const number = offset < 3 ? "singular" : "plural";
    (irregularForms[form] ||= []).push({ lemma, german, part: "v", mood, tense, voice: "active", person, number });
  });
};

addIrregularParadigm("sum", "sein", "present", ["sum", "es", "est", "sumus", "estis", "sunt"]);
addIrregularParadigm("sum", "sein", "imperfect", ["eram", "eras", "erat", "eramus", "eratis", "erant"]);
addIrregularParadigm("sum", "sein", "future", ["ero", "eris", "erit", "erimus", "eritis", "erunt"]);
addIrregularParadigm("possum", "können", "present", ["possum", "potes", "potest", "possumus", "potestis", "possunt"]);
addIrregularParadigm("possum", "können", "imperfect", ["poteram", "poteras", "poterat", "poteramus", "poteratis", "poterant"]);
addIrregularParadigm("eo", "gehen", "present", ["eo", "is", "it", "imus", "itis", "eunt"]);
addIrregularParadigm("eo", "gehen", "imperfect", ["ibam", "ibas", "ibat", "ibamus", "ibatis", "ibant"]);
addIrregularParadigm("volo", "wollen", "present", ["volo", "vis", "vult", "volumus", "vultis", "volunt"]);
addIrregularParadigm("volo", "wollen", "imperfect", ["volebam", "volebas", "volebat", "volebamus", "volebatis", "volebant"]);
addIrregularParadigm("nolo", "nicht wollen", "present", ["nolo", "nonvis", "nonvult", "nolumus", "nonvultis", "nolunt"]);
addIrregularParadigm("malo", "lieber wollen", "present", ["malo", "mavis", "mavult", "malumus", "mavultis", "malunt"]);
addIrregularParadigm("fero", "tragen", "present", ["fero", "fers", "fert", "ferimus", "fertis", "ferunt"]);
addIrregularParadigm("fero", "tragen", "imperfect", ["ferebam", "ferebas", "ferebat", "ferebamus", "ferebatis", "ferebant"]);

/** Common irregular paradigms used as morphology, never as sentence rules. */
export const IRREGULAR_LATIN_FORMS = Object.freeze(Object.fromEntries(
  Object.entries(irregularForms).map(([form, analyses]) => [form, Object.freeze(analyses.map(Object.freeze))])
));

export const LATIN_PREPOSITIONS = Object.freeze({
  a: { german: "von", latinCases: ["ablative"], germanCase: "dative" },
  ab: { german: "von", latinCases: ["ablative"], germanCase: "dative" },
  abs: { german: "von", latinCases: ["ablative"], germanCase: "dative" },
  ad: { german: "zu", latinCases: ["accusative"], germanCase: "dative" },
  adversus: { german: "gegen", latinCases: ["accusative"], germanCase: "accusative" },
  ante: { german: "vor", latinCases: ["accusative"], germanCase: "dative" },
  apud: { german: "bei", latinCases: ["accusative"], germanCase: "dative" },
  causa: { german: "wegen", latinCases: ["genitive"], germanCase: "genitive", postpositive: true },
  circum: { german: "um", latinCases: ["accusative"], germanCase: "accusative" },
  contra: { german: "gegen", latinCases: ["accusative"], germanCase: "accusative" },
  cum: { german: "mit", latinCases: ["ablative"], germanCase: "dative" },
  de: { german: "über", latinCases: ["ablative"], germanCase: "accusative" },
  e: { german: "aus", latinCases: ["ablative"], germanCase: "dative" },
  ex: { german: "aus", latinCases: ["ablative"], germanCase: "dative" },
  extra: { german: "außerhalb", latinCases: ["accusative"], germanCase: "genitive" },
  in: { german: "in", latinCases: ["accusative", "ablative"], germanCaseByLatin: { accusative: "accusative", ablative: "dative" } },
  infra: { german: "unterhalb", latinCases: ["accusative"], germanCase: "genitive" },
  inter: { german: "zwischen", latinCases: ["accusative"], germanCase: "accusative" },
  intra: { german: "innerhalb", latinCases: ["accusative"], germanCase: "genitive" },
  ob: { german: "wegen", latinCases: ["accusative"], germanCase: "genitive" },
  per: { german: "durch", latinCases: ["accusative"], germanCase: "accusative" },
  post: { german: "nach", latinCases: ["accusative"], germanCase: "dative" },
  prae: { german: "vor", latinCases: ["ablative"], germanCase: "dative" },
  pro: { german: "für", latinCases: ["ablative"], germanCase: "accusative" },
  propter: { german: "wegen", latinCases: ["accusative"], germanCase: "genitive" },
  sine: { german: "ohne", latinCases: ["ablative"], germanCase: "accusative" },
  sub: { german: "unter", latinCases: ["accusative", "ablative"], germanCaseByLatin: { accusative: "accusative", ablative: "dative" } },
  super: { german: "über", latinCases: ["accusative", "ablative"], germanCaseByLatin: { accusative: "accusative", ablative: "dative" } },
  trans: { german: "über", latinCases: ["accusative"], germanCase: "accusative" }
});

export const COORDINATORS = Object.freeze({
  ac: "und",
  atque: "und",
  aut: "oder",
  autem: "aber",
  et: "und",
  neque: "und nicht",
  nec: "und nicht",
  sed: "aber",
  at: "aber",
  vel: "oder",
  nam: "denn"
});

export const SUBORDINATORS = Object.freeze({
  cum: "als",
  dum: "während",
  postquam: "nachdem",
  antequam: "bevor",
  priusquam: "bevor",
  quia: "weil",
  quoniam: "weil",
  quod: "weil",
  si: "wenn",
  nisi: "wenn nicht",
  ut: "dass",
  ne: "damit nicht",
  quamquam: "obwohl",
  etsi: "obwohl"
});

export const RELATIVE_FORMS = new Set([
  "qui", "quae", "quod", "cuius", "cui", "quem", "quam", "quo", "qua",
  "quorum", "quarum", "quibus", "quos", "quas"
]);

export const INTERROGATIVE_FORMS = new Set([
  "quis", "quid", "qui", "quae", "quod", "cur", "quare", "quomodo", "quando",
  "quem", "cui", "cuius", "quos", "quas", "ubi", "unde", "quo", "quantus", "qualis", "num", "utrum"
]);

export const PERSONAL_PRONOUNS = Object.freeze({
  ego: { nominative: "ich", accusative: "mich", dative: "mir", genitive: "meiner" },
  mei: { genitive: "meiner" },
  mihi: { dative: "mir" },
  me: { accusative: "mich", ablative: "mir" },
  tu: { nominative: "du", accusative: "dich", dative: "dir", genitive: "deiner" },
  tui: { genitive: "deiner" },
  tibi: { dative: "dir" },
  te: { accusative: "dich", ablative: "dir" },
  nos: { nominative: "wir", accusative: "uns", dative: "uns", ablative: "uns" },
  nostri: { genitive: "unser" },
  nostrum: { genitive: "von uns" },
  vos: { nominative: "ihr", accusative: "euch", dative: "euch", ablative: "euch" },
  vestri: { genitive: "euer" },
  vestrum: { genitive: "von euch" },
  se: { accusative: "sich", ablative: "sich" },
  sese: { accusative: "sich", ablative: "sich" },
  sui: { genitive: "seiner" },
  sibi: { dative: "sich" }
});

/** Common governing-verb classes used for construction recognition. */
export const VERB_CLASSES = Object.freeze({
  speechThought: new Set([
    "accipio", "affirmo", "aio", "arbitror", "audio", "censeo", "cognosco", "comperio",
    "confiteor", "credo", "dico", "existimo", "fateor", "intellego", "iudico", "memoro",
    "nego", "nescio", "nuntio", "promitto", "puto", "reor", "respondeo", "scio", "scribo",
    "sentio", "spero", "suspicor", "trado", "video"
  ]),
  command: new Set(["cogo", "impero", "iubeo", "moneo", "peto", "rogo", "veto"]),
  modal: new Set(["audeo", "cupio", "debeo", "desidero", "possum", "soleo", "volo", "nolo", "malo"]),
  motion: new Set(["abeo", "accedo", "advenio", "curro", "discedo", "eo", "fugio", "proficiscor", "redeo", "venio"]),
  fearing: new Set(["metuo", "timeo", "vereor"]),
  knowing: new Set(["cognosco", "intellego", "nescio", "quaero", "scio", "video"])
});

/**
 * General verb valency. `senses` selects among dictionary meanings by the
 * observed complement frame, never by a complete sentence.
 */
export const VERB_FRAMES = Object.freeze({
  abutor: { cases: ["ablative"], deponent: true, germanAblativeCase: "accusative", defaultSense: "missbrauchen" },
  audeo: { allowsInfinitive: true, germanInfinitiveWithZu: true, semideponent: true, defaultSense: "wagen" },
  adiuvo: { cases: ["accusative"], germanDirectCase: "dative", defaultSense: "helfen" },
  adsum: { cases: ["dative"], defaultSense: "beistehen" },
  appropinquo: { cases: ["dative"], defaultSense: "sich nähern" },
  credo: { cases: ["dative"], defaultSense: "glauben" },
  defendo: { cases: ["accusative"], defaultSense: "verteidigen" },
  dico: { cases: ["accusative"], allowsAci: true, defaultSense: "sagen" },
  discedo: { defaultSense: "weggehen" },
  differo: {
    cases: ["ablative"],
    germanAblativePreposition: "in",
    germanAblativeCase: "dative",
    nominalSenses: { lingua: "Sprache" },
    defaultSense: "sich unterscheiden"
  },
  divido: {
    cases: ["accusative"],
    defaultSense: "teilen",
    senses: [{ withPreposition: "ab", german: "trennen" }, { withPreposition: "a", german: "trennen" }]
  },
  do: { cases: ["dative", "accusative"], defaultSense: "geben" },
  doceo: { cases: ["accusative", "accusative"], defaultSense: "lehren" },
  facio: {
    cases: ["accusative"],
    defaultSense: "tun",
    senses: [
      { objectLemmas: ["pons"], german: "bauen" },
      { objectLemmas: ["opus"], german: "verrichten" }
    ]
  },
  fugio: {
    defaultSense: "fliehen",
    senses: [{ subjectLemmas: ["tempus"], german: "vergehen" }]
  },
  gero: { cases: ["accusative"], defaultSense: "führen" },
  impero: { cases: ["dative"], allowsUt: true, defaultSense: "befehlen" },
  insto: { defaultSense: "drohen" },
  iubeo: { cases: ["accusative"], allowsInfinitive: true, defaultSense: "befehlen" },
  noceo: { cases: ["dative"], defaultSense: "schaden" },
  parco: { cases: ["dative"], defaultSense: "schonen" },
  pareo: { cases: ["dative"], defaultSense: "gehorchen" },
  persuadeo: { cases: ["dative"], allowsUt: true, defaultSense: "überzeugen" },
  pergo: {
    defaultSense: "weitergehen",
    senses: [{ withDirectObject: true, german: "fortsetzen" }]
  },
  pateo: { defaultSense: "offen stehen" },
  peto: {
    cases: ["accusative"],
    defaultSense: "aufsuchen",
    senses: [
      { withPreposition: "ab", german: "erbitten" },
      { objectLemmas: ["auxilium", "pax", "venia"], german: "erbitten" },
      { objectLemmas: ["hostis", "castra"], german: "angreifen" }
    ]
  },
  praesum: { cases: ["dative"], defaultSense: "vorstehen" },
  praecedo: {
    cases: ["accusative", "ablative"],
    germanAblativePreposition: "an",
    germanAblativeCase: "dative",
    defaultSense: "übertreffen"
  },
  quaero: { cases: ["accusative"], allowsIndirectQuestion: true, defaultSense: "suchen" },
  rogo: { cases: ["accusative"], allowsUt: true, defaultSense: "bitten" },
  sequor: { cases: ["accusative"], deponent: true, germanDirectCase: "dative", defaultSense: "folgen" },
  sentio: {
    cases: ["accusative"],
    nominalSenses: { consilium: "Plan" },
    senses: [{ withConstruction: "aci", german: "bemerken" }]
  },
  timeo: {
    defaultSense: "sich fürchten",
    senses: [{ withDirectObject: true, german: "fürchten" }]
  },
  utor: { cases: ["ablative"], deponent: true, germanAblativeCase: "accusative", defaultSense: "benutzen" },
  video: { cases: ["accusative"], allowsAci: true, defaultSense: "sehen" },
  vinco: {
    cases: ["accusative"],
    defaultSense: "siegen",
    senses: [{ withDirectObject: true, german: "besiegen" }]
  }
});

/** Extensible lemma patterns for idioms; no complete source sentence appears. */
export const LATIN_IDIOMS = Object.freeze([
  { id: "gratias-agere", lemmas: ["gratia", "ago"], german: "danken", head: "ago", consumes: ["gratia"] },
  { id: "auxilium-ferre", lemmas: ["auxilium", "fero"], german: "Hilfe leisten", head: "fero", consumes: ["auxilium"] },
  { id: "bellum-gerere", lemmas: ["bellum", "gero"], german: "Krieg führen", head: "gero", consumes: ["bellum"] },
  { id: "consilium-capere", lemmas: ["consilium", "capio"], german: "beschließen", head: "capio", consumes: ["consilium"] },
  { id: "iter-facere", lemmas: ["iter", "facio"], german: "reisen", head: "facio", consumes: ["iter"] },
  { id: "sacrum-facere", lemmas: ["sacrum", "facio"], german: "ein Opfer darbringen", head: "facio", consumes: ["sacrum"] },
  { id: "memoria-tenere", lemmas: ["memoria", "teneo"], german: "im Gedächtnis behalten", head: "teneo", consumes: ["memoria"] },
  { id: "finem-facere", lemmas: ["finis", "facio"], german: "ein Ende machen", head: "facio", consumes: ["finis"] },
  { id: "curae-esse", lemmas: ["cura", "sum"], german: "wichtig sein", head: "sum", consumes: ["cura"] },
  {
    id: "opus-esse",
    lemmas: ["opus", "sum"],
    german: "brauchen",
    head: "sum",
    consumes: ["opus"],
    subjectRole: "indirectObject",
    directObjectRole: "ablative",
    germanDirectCase: "accusative",
    directObjectIndefinite: true
  }
]);

/**
 * Short, reusable expressions. They are data rather than branches in the
 * parser, so further idioms can be added without teaching the generator a
 * particular source sentence.
 */
export const LATIN_EXPRESSIONS = Object.freeze([
  { id: "qua-de-causa", tokens: ["qua", "de", "causa"], german: "aus diesem Grund", kind: "adverbial" },
  { id: "quo-usque-tandem", tokens: ["quo", "usque", "tandem"], german: "wie lange noch", kind: "interrogative" },
  { id: "quo-usque", tokens: ["quo", "usque"], german: "wie lange", kind: "interrogative" },
  { id: "inter-se", tokens: ["inter", "se"], german: "voneinander", kind: "adverbial" },
  { id: "inter-sese", tokens: ["inter", "sese"], german: "voneinander", kind: "adverbial" }
]);

export const DISCOURSE_ADVERBS = Object.freeze({
  deinde: "danach",
  etiam: "auch",
  ergo: "daher",
  iam: "schon",
  igitur: "also",
  itaque: "deshalb",
  iterum: "wieder",
  nunc: "jetzt",
  saepe: "oft",
  semper: "immer",
  sic: "so",
  subito: "plötzlich",
  tamen: "dennoch",
  tam: "so",
  tum: "dann",
  tunc: "damals",
  valde: "sehr",
  quoque: "auch"
});

export const GERMAN_IRREGULAR_PRESENT = Object.freeze({
  sein: [["bin", "bist", "ist"], ["sind", "seid", "sind"]],
  haben: [["habe", "hast", "hat"], ["haben", "habt", "haben"]],
  werden: [["werde", "wirst", "wird"], ["werden", "werdet", "werden"]],
  können: [["kann", "kannst", "kann"], ["können", "könnt", "können"]],
  müssen: [["muss", "musst", "muss"], ["müssen", "müsst", "müssen"]],
  wollen: [["will", "willst", "will"], ["wollen", "wollt", "wollen"]],
  sollen: [["soll", "sollst", "soll"], ["sollen", "sollt", "sollen"]],
  dürfen: [["darf", "darfst", "darf"], ["dürfen", "dürft", "dürfen"]],
  mögen: [["mag", "magst", "mag"], ["mögen", "mögt", "mögen"]],
  wissen: [["weiß", "weißt", "weiß"], ["wissen", "wisst", "wissen"]],
  geben: [["gebe", "gibst", "gibt"], ["geben", "gebt", "geben"]],
  nehmen: [["nehme", "nimmst", "nimmt"], ["nehmen", "nehmt", "nehmen"]],
  sehen: [["sehe", "siehst", "sieht"], ["sehen", "seht", "sehen"]],
  sprechen: [["spreche", "sprichst", "spricht"], ["sprechen", "sprecht", "sprechen"]],
  lesen: [["lese", "liest", "liest"], ["lesen", "lest", "lesen"]],
  laufen: [["laufe", "läufst", "läuft"], ["laufen", "lauft", "laufen"]],
  fahren: [["fahre", "fährst", "fährt"], ["fahren", "fahrt", "fahren"]],
  fallen: [["falle", "fällst", "fällt"], ["fallen", "fallt", "fallen"]],
  fangen: [["fange", "fängst", "fängt"], ["fangen", "fangt", "fangen"]],
  halten: [["halte", "hältst", "hält"], ["halten", "haltet", "halten"]],
  lassen: [["lasse", "lässt", "lässt"], ["lassen", "lasst", "lassen"]],
  schlafen: [["schlafe", "schläfst", "schläft"], ["schlafen", "schlaft", "schlafen"]],
  tragen: [["trage", "trägst", "trägt"], ["tragen", "tragt", "tragen"]],
  helfen: [["helfe", "hilfst", "hilft"], ["helfen", "helft", "helfen"]],
  treffen: [["treffe", "triffst", "trifft"], ["treffen", "trefft", "treffen"]],
  werfen: [["werfe", "wirfst", "wirft"], ["werfen", "werft", "werfen"]],
  essen: [["esse", "isst", "isst"], ["essen", "esst", "essen"]],
  vergessen: [["vergesse", "vergisst", "vergisst"], ["vergessen", "vergesst", "vergessen"]],
  wachsen: [["wachse", "wächst", "wächst"], ["wachsen", "wachst", "wachsen"]],
  stoßen: [["stoße", "stößt", "stößt"], ["stoßen", "stoßt", "stoßen"]]
});

export const GERMAN_IRREGULAR_PAST = Object.freeze({
  sein: [["war", "warst", "war"], ["waren", "wart", "waren"]],
  haben: [["hatte", "hattest", "hatte"], ["hatten", "hattet", "hatten"]],
  werden: [["wurde", "wurdest", "wurde"], ["wurden", "wurdet", "wurden"]],
  kommen: [["kam", "kamst", "kam"], ["kamen", "kamt", "kamen"]],
  gehen: [["ging", "gingst", "ging"], ["gingen", "gingt", "gingen"]],
  laufen: [["lief", "liefst", "lief"], ["liefen", "lieft", "liefen"]],
  fliehen: [["floh", "flohst", "floh"], ["flohen", "floht", "flohen"]],
  sehen: [["sah", "sahst", "sah"], ["sahen", "saht", "sahen"]],
  geben: [["gab", "gabst", "gab"], ["gaben", "gabt", "gaben"]],
  nehmen: [["nahm", "nahmst", "nahm"], ["nahmen", "nahmt", "nahmen"]],
  sprechen: [["sprach", "sprachst", "sprach"], ["sprachen", "spracht", "sprachen"]],
  schreiben: [["schrieb", "schriebst", "schrieb"], ["schrieben", "schriebt", "schrieben"]],
  lesen: [["las", "last", "las"], ["lasen", "last", "lasen"]],
  schließen: [["schloss", "schlossest", "schloss"], ["schlossen", "schlosst", "schlossen"]],
  bleiben: [["blieb", "bliebst", "blieb"], ["blieben", "bliebt", "blieben"]],
  fallen: [["fiel", "fielst", "fiel"], ["fielen", "fielt", "fielen"]],
  brechen: [["brach", "brachst", "brach"], ["brachen", "bracht", "brachen"]],
  weichen: [["wich", "wichst", "wich"], ["wichen", "wicht", "wichen"]],
  rufen: [["rief", "riefst", "rief"], ["riefen", "rieft", "riefen"]],
  wissen: [["wusste", "wusstest", "wusste"], ["wussten", "wusstet", "wussten"]],
  tun: [["tat", "tatest", "tat"], ["taten", "tatet", "taten"]],
  bringen: [["brachte", "brachtest", "brachte"], ["brachten", "brachtet", "brachten"]],
  finden: [["fand", "fandest", "fand"], ["fanden", "fandet", "fanden"]],
  halten: [["hielt", "hieltest", "hielt"], ["hielten", "hieltet", "hielten"]],
  lassen: [["ließ", "ließest", "ließ"], ["ließen", "ließt", "ließen"]],
  siegen: [["siegte", "siegtest", "siegte"], ["siegten", "siegtet", "siegten"]],
  fahren: [["fuhr", "fuhrst", "fuhr"], ["fuhren", "fuhrt", "fuhren"]],
  schlafen: [["schlief", "schliefst", "schlief"], ["schliefen", "schlieft", "schliefen"]],
  tragen: [["trug", "trugst", "trug"], ["trugen", "trugt", "trugen"]],
  bitten: [["bat", "batst", "bat"], ["baten", "batet", "baten"]],
  helfen: [["half", "halfst", "half"], ["halfen", "halft", "halfen"]],
  treffen: [["traf", "trafst", "traf"], ["trafen", "traft", "trafen"]],
  stehen: [["stand", "standst", "stand"], ["standen", "standet", "standen"]],
  sitzen: [["saß", "saßest", "saß"], ["saßen", "saßt", "saßen"]],
  liegen: [["lag", "lagst", "lag"], ["lagen", "lagt", "lagen"]],
  ziehen: [["zog", "zogst", "zog"], ["zogen", "zogt", "zogen"]],
  trinken: [["trank", "trankst", "trank"], ["tranken", "trankt", "tranken"]],
  werfen: [["warf", "warfst", "warf"], ["warfen", "warft", "warfen"]],
  essen: [["aß", "aßest", "aß"], ["aßen", "aßt", "aßen"]],
  vergessen: [["vergaß", "vergaßest", "vergaß"], ["vergaßen", "vergaßt", "vergaßen"]],
  wachsen: [["wuchs", "wuchsest", "wuchs"], ["wuchsen", "wuchst", "wuchsen"]],
  stoßen: [["stieß", "stießest", "stieß"], ["stießen", "stießt", "stießen"]],
  fangen: [["fing", "fingst", "fing"], ["fingen", "fingt", "fingen"]],
  können: [["konnte", "konntest", "konnte"], ["konnten", "konntet", "konnten"]],
  müssen: [["musste", "musstest", "musste"], ["mussten", "musstet", "mussten"]],
  dürfen: [["durfte", "durftest", "durfte"], ["durften", "durftet", "durften"]],
  mögen: [["mochte", "mochtest", "mochte"], ["mochten", "mochtet", "mochten"]],
  sollen: [["sollte", "solltest", "sollte"], ["sollten", "solltet", "sollten"]],
  wollen: [["wollte", "wolltest", "wollte"], ["wollten", "wolltet", "wollten"]]
});

export const GERMAN_PARTICIPLES = Object.freeze({
  sein: "gewesen", haben: "gehabt", werden: "geworden", kommen: "gekommen", gehen: "gegangen",
  laufen: "gelaufen", fliehen: "geflohen", sehen: "gesehen", geben: "gegeben", nehmen: "genommen",
  finden: "gefunden", sprechen: "gesprochen", schreiben: "geschrieben", lesen: "gelesen", rufen: "gerufen",
  bringen: "gebracht", wissen: "gewusst", bitten: "gebeten", helfen: "geholfen", treffen: "getroffen", nennen: "genannt", verwunden: "verwundet",
  tragen: "getragen", halten: "gehalten", lassen: "gelassen", schließen: "geschlossen", tun: "getan", stehen: "gestanden", weichen: "gewichen",
  überschreiten: "überschritten", führen: "geführt", bleiben: "geblieben", fallen: "gefallen", aufbrechen: "aufgebrochen", vergehen: "vergangen",
  sitzen: "gesessen", liegen: "gelegen", ziehen: "gezogen", siegen: "gesiegt", trinken: "getrunken", werfen: "geworfen",
  fahren: "gefahren", schlafen: "geschlafen", essen: "gegessen", vergessen: "vergessen", wachsen: "gewachsen", stoßen: "gestoßen", fangen: "gefangen",
  können: "gekonnt", müssen: "gemusst", dürfen: "gedurft", mögen: "gemocht", sollen: "gesollt", wollen: "gewollt"
});

export const KNOWN_GERMAN_NOUNS = Object.freeze({
  "Buch": { article: "das", plural: "Bücher" },
  "Bürger": { article: "der", plural: "Bürger" },
  "Feind": { article: "der", plural: "Feinde" },
  "Friede": { article: "der", plural: "Frieden", oblique: "Frieden" },
  "Freund": { article: "der", plural: "Freunde" },
  "Gesandter": { article: "der", plural: "Gesandten" },
  "Gott": { article: "der", plural: "Götter" },
  "Großvater": { article: "der", plural: "Großväter" },
  "Junge": { article: "der", plural: "Jungen" },
  "Geist": { article: "der", plural: "Geister" },
  "Körper": { article: "der", plural: "Körper" },
  "Mensch": { article: "der", plural: "Menschen", oblique: "Menschen" },
  "Kind": { article: "das", plural: "Kinder" },
  "Mann": { article: "der", plural: "Männer" },
  "Mädchen": { article: "das", plural: "Mädchen" },
  "Plan": { article: "der", plural: "Pläne" },
  "Rat": { article: "der", plural: "Räte" },
  "Römer": { article: "der", plural: "Römer" },
  "Krieg": { article: "der", plural: "Kriege" },
  "Schicksal": { article: "das", plural: "Schicksale" },
  "Teil": { article: "der", plural: "Teile" },
  "Sklave": { article: "der", plural: "Sklaven" },
  "Sklavin": { article: "die", plural: "Sklavinnen" },
  "Soldat": { article: "der", plural: "Soldaten" },
  "Sohn": { article: "der", plural: "Söhne" },
  "Tochter": { article: "die", plural: "Töchter" },
  "Frau": { article: "die", plural: "Frauen" },
  "Herr": { article: "der", plural: "Herren", oblique: "Herrn", genitive: "Herrn" },
  "Holz": { article: "das", plural: "Hölzer" },
  "Stadt": { article: "die", plural: "Städte" },
  "Wasser": { article: "das", plural: "Wässer" },
  "Würfel": { article: "der", plural: "Würfel" }
});

export const SUBSTANTIVIZED_ADJECTIVES = Object.freeze({
  amicus: { singular: "der Freund", plural: "die Freunde" },
  aquitanus: { singular: "der Aquitanier", plural: "die Aquitanier" },
  gallus: { singular: "der Gallier", plural: "die Gallier" },
  graecus: { singular: "der Grieche", plural: "die Griechen" },
  helvetius: { singular: "der Helvetier", plural: "die Helvetier" },
  nemo: { singular: "niemand", plural: "niemand", articleless: true },
  omne: { singular: "alles", plural: "alles", articleless: true },
  omnis: { singular: "jeder", plural: "alle", articleless: true },
  romanus: { singular: "der Römer", plural: "die Römer" },
  troianus: { singular: "der Trojaner", plural: "die Trojaner" }
});

export const LATIN_ETHNONYM_LEMMAS = new Set([
  "aquitanus", "belga", "gallus", "graecus", "helvetius", "romanus", "troianus"
]);

/** Lexical adjective senses not supplied by the compact fallback dictionary. */
export const GERMAN_ADJECTIVE_LEMMA_SENSES = Object.freeze({
  aquitanus: "aquitanisch",
  gallus: "gallisch",
  helvetius: "helvetisch",
  romanus: "römisch",
  troianus: "trojanisch"
});

/** Productive Latin locatives whose German form is not a normal noun phrase. */
export const LATIN_LOCATIVES = Object.freeze({
  domus: "zu Hause",
  humus: "auf dem Boden",
  rus: "auf dem Land"
});

/** Irregular German adjective degrees; regular adjectives use -er. */
export const GERMAN_ADJECTIVE_COMPARATIVES = Object.freeze({
  alt: "älter",
  groß: "größer",
  gut: "besser",
  hoch: "höher",
  jung: "jünger",
  nah: "näher",
  stark: "stärker",
  viel: "mehr"
});

export const GERMAN_ADJECTIVE_SUPERLATIVES = Object.freeze({
  alt: "ältest",
  groß: "größt",
  gut: "best",
  hoch: "höchst",
  jung: "jüngst",
  nah: "nächst",
  stark: "stärkst",
  viel: "meist"
});

/** Adjectives that are especially prone to nominal dictionary homographs. */
export const PRONOMINAL_ADJECTIVE_LEMMAS = new Set([
  "alius", "alter", "neuter", "nullus", "omne", "omnis", "solus", "totus", "ullus", "unus", "uter", "uterque"
]);

/** Coarse lexical semantics used only to rank ambiguous syntactic readings. */
export const ANIMATE_LEMMAS = new Set([
  "agricola", "amicus", "avus", "caesar", "civis", "discipulus", "domina", "dominus", "dux",
  "femina", "filius", "frater", "hostis", "legatus", "liberi", "magister", "mater", "miles",
  "nauta", "pater", "puella", "puer", "rex", "romanus", "senator", "servus", "vir"
]);
