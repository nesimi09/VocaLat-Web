import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractLatinDocument } from "../document-analysis.js";
import { tokenizeLatinText } from "../learning-engine.js";

const nessusOcr = `" ÜBUNGSKÓNIG

Hyginis: Nessus

In seinen Fabulae schreibt Hyginis, über den wenig bekannt ist, unter
Anderem über die griechische Mythologie. In dieser berichtet er von
Herkules und Deianeira, welche einen Fluss überqueren wollen.
Wáhrend Herkules es aus eigener Kraft schafft muss Deianeira auf den
Kentauren Nessus zurückgreifen.

Nessus

Nessus centaurus rogatus est ab Deianira, ut se flumen
Euhenum transferret: quam sublatam in flumine ipso
violare voluit. Hoc Hercules cum intervenisset et
Deianira cum fidem eius imploravisset, Nessum sagittis
confixit. Ille moriens, cum sciret sagittas hydrae veneno
tinctas quantam vim veneni habere, sanguinem suum
exceptum Deianirae dedit et id philtrum! esse dixit; si
vellet, ne se coniunx sperneret?, eo iuberet se vestem
eius attrahere. Id Deianira credens conditum diligenter

servavit.                                            (71 Wérter)

"philtrum, -i, n 7 Liebestrank

!spernere » verschmiühen`;

const latinWords = new Set(`ab attrahere centaurus conditum confixit coniunx credens cum dedit diligenter dixit eius eo esse est et exceptum fidem flumen habere hoc id ille imploravisset in intervenisset ipso iuberet moriens ne philtrum quantam quam rogatus sagittas sagittis sanguinem sciret se servavit si sperneret sublatam suum tinctas transferret ut vellet veneni veneno vestem violare vim voluit`.split(" "));
const morphology = new Map([...latinWords].map(word => [word, [{ forms: [word], morphology: {} }]]));
const triptolemusOcr = readFileSync(new URL("./fixtures/triptolemus-ocr.txt", import.meta.url), "utf8");
const triptolemusLatin = "Cum Ceres Proserpinam filiam suam quaereret, devenit ad Eleusinum regem, cuius uxor Cothonea puerum Triptolemum pepererat, seque nutricem lactantem esse simulavit. Hanc regina libens nutricem filio suo recepit. Ceres cum vellet puerum suum immortalem reddere, interdiu lacte divino alebat, noctu clam in igne ponebat. Itaque solebant mortales puerem crescere; et cum mirarentur parentes eum sic crescere, eam observaverunt. Cum Ceres eum vellet in ignem mittere, pater terruit. Illa irata Eleusinum exanimavit, at Triptolemo puero suo aeternum beneficium tribuit. Nam fructus in curro draconibus iuncto tradidit, quo vehens orbem terrarum fructibus obserere potest. Postquam domum rediit, Celeus* eum pro benefacto interfici iussit. Sed re cognita iussu Cereris Triptolemo regnum dedit, quod ex patris nomine Eleusinum nominavit, et Cereris sacrum instituit.";
const triptolemusMorphology = new Map(tokenizeLatinText(triptolemusLatin).map(token => [token.normalized, [{ forms: [token.normalized], morphology: {} }]]));
const phaedrusOcr = readFileSync(new URL("./fixtures/phaedrus-wolf-lamm-ocr.txt", import.meta.url), "utf8");
const phaedrusLatin = "Ad rivum eundem lupus et agnus venerant siti compulsi. Superior stabat lupus longeque inferior agnus. Tunc fauce improba latro incitatus iurgii causam intulit.,Cur\" inquit,turbulentam fecisti mihi aquam bibenti?\" Laniger contra timens:,Qui possum, quaeso, facere, quod quereris, lupe? A te decurrit ad meos haustüs liquor.\" Repulsus ille veritatis viribus:,Ante hos sex menses male\" ait, dixisti mihi.\" Respondit agnus:,Equidem natus non eram.\" Pater, hercle, tuus\" ille inquit, male dixit mihi.\" Atque ita correptum lacerat iniustà nece.";
const phaedrusMorphology = new Map(tokenizeLatinText(phaedrusLatin).map(token => [token.normalized, [{ forms: [token.normalized], morphology: {} }]]));
const familiaOcr = readFileSync(new URL("./fixtures/familia-avum-ocr.txt", import.meta.url), "utf8");
const familiaLatin = "Familia avum exspectat. Itaque domina servos vocat. Nam viri atrium purgare debent. Servae in culina sunt. Liberi non laborant, sed ludunt. Cornelia Aulum quaerit. Clamat: \"Aule!\". Frater non respondet. Subito puella avum videt. Ad avum currit et ridet. Cornelia et avus gaudent. Nunc etiam Aulus venit. Non iam tacet, sed clamat: Salve, avel*.";
const familiaMorphology = new Map(tokenizeLatinText(familiaLatin).map(token => [token.normalized, [{ forms: [token.normalized], morphology: {} }]]));

test("a mixed German-Latin page keeps only the Latin passage", () => {
  const result = extractLatinDocument(nessusOcr, morphology);
  assert.equal(result.detected, true);
  assert.match(result.latinText, /^Nessus centaurus rogatus est/);
  assert.match(result.latinText, /diligenter servavit\.$/);
  assert.doesNotMatch(result.latinText, /ÜBUNGSKÓNIG|Mythologie|Wérter|Liebestrank|verschmiühen/);
  assert.doesNotMatch(result.latinText, /philtrum!|sperneret\?/);
  assert.equal(tokenizeLatinText(result.latinText).length, 71);
});

test("the Latin passage is still isolated when OCR removes every blank line", () => {
  const denseOcr = nessusOcr.replace(/\n\s*\n+/g, "\n");
  const result = extractLatinDocument(denseOcr, morphology);
  assert.equal(result.detected, true);
  assert.match(result.latinText, /^Nessus centaurus rogatus est/);
  assert.match(result.latinText, /diligenter servavit\.$/);
  assert.equal(tokenizeLatinText(result.latinText).length, 71);
  assert.doesNotMatch(result.latinText, /ÜBUNGSKÓNIG|Mythologie|Wérter|Liebestrank/);
});

test("OCR footnotes become page-specific vocabulary", () => {
  const result = extractLatinDocument(nessusOcr, morphology);
  assert.deepEqual(result.glossary.map(entry => [entry.lemma, entry.meanings[0]]), [
    ["philtrum", "Liebestrank"],
    ["spernere", "verschmiühen"]
  ]);
});

test("document extraction separates content without silently rewriting uncertain words", () => {
  const result = extractLatinDocument(triptolemusOcr, triptolemusMorphology);
  assert.equal(result.detected, true);
  assert.equal(result.latinText, triptolemusLatin);
  assert.equal(tokenizeLatinText(result.latinText).length, 119);
  assert.doesNotMatch(result.latinText, /UBUNGSKÓNIG|Mythologie|Wórter|Keleos|sáugen|besüen/);
  assert.deepEqual(result.glossary.map(entry => [entry.lemma, entry.forms, entry.meanings[0]]), [
    ["lactare", ["lactare"], "sáugen"],
    ["nutrix", ["nutrix", "nutricis"], "Amme"],
    ["exanimare", ["exanimare"], "hier: tóten"],
    ["obserere", ["obserere", "obsero", "obsevi", "obsitum"], "besüen, bepflanzen"]
  ]);
});

test("widely spaced Latin paragraphs are kept as one document while line numbers are removed", () => {
  const result = extractLatinDocument(phaedrusOcr, phaedrusMorphology);
  assert.equal(result.detected, true);
  assert.equal(result.latinText, phaedrusLatin);
  assert.equal(tokenizeLatinText(result.latinText).length, 79);
  assert.doesNotMatch(result.latinText, /ÜBERSETZUNG|Jesper|\b18\b|\bn Respondit\b|5\^/);
});

test("generic page-noise cleanup leaves uncertain OCR word forms untouched", () => {
  const result = extractLatinDocument(familiaOcr, familiaMorphology);
  assert.equal(result.detected, true);
  assert.equal(result.latinText, familiaLatin);
  assert.equal(tokenizeLatinText(result.latinText).length, 53);
  assert.doesNotMatch(result.latinText, /Übersetzungsaufgabe|Hilfen|versteckten|\bs Cornelia\b/);
  assert.match(result.latinText, /Salve, avel\*\.$/);
});
