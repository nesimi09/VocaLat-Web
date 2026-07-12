import test from "node:test";
import assert from "node:assert/strict";
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

test("a mixed German-Latin page keeps only the Latin passage", () => {
  const result = extractLatinDocument(nessusOcr, morphology);
  assert.equal(result.detected, true);
  assert.match(result.latinText, /^Nessus centaurus rogatus est/);
  assert.match(result.latinText, /diligenter servavit\.$/);
  assert.doesNotMatch(result.latinText, /ÜBUNGSKÓNIG|Mythologie|Wérter|Liebestrank|verschmiühen/);
  assert.doesNotMatch(result.latinText, /philtrum!|sperneret\?/);
  assert.equal(tokenizeLatinText(result.latinText).length, 71);
});

test("OCR footnotes become page-specific vocabulary", () => {
  const result = extractLatinDocument(nessusOcr, morphology);
  assert.deepEqual(result.glossary.map(entry => [entry.lemma, entry.meanings[0]]), [
    ["philtrum", "Liebestrank"],
    ["spernere", "verschmähen"]
  ]);
});
