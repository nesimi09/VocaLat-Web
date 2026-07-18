import assert from "node:assert/strict";

const baseUrl = String(process.env.VOCALAT_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const latinText = [
  "Caesar dixit se hostes vicisse.",
  "Urbe capta, milites discesserunt.",
  "Puer librum legens per viam ambulabat.",
  "Ne hoc facias!",
  "Puella, quae in horto sedet, rosam tenet.",
  "Haec epistula discipulis legenda est.",
  "Cum hostes appropinquarent, cives portas clauserunt.",
  "Romani legatos miserunt ut pacem peterent.",
  "Dux, qui prima luce profectus erat, vesperi rediit.",
  "Milites tam fessi erant ut iter continuare non possent."
].join(" ");

const response = await fetch(`${baseUrl}/api/translate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ latinText, bookVocabulary: [] }),
  signal: AbortSignal.timeout(240_000)
});
if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
const result = await response.json();
const translation = String(result.translation || "").trim();
const oneLine = translation.replace(/\s+/g, " ");
console.log(`Modell: ${result.model || "unbekannt"}`);
console.log(translation);

assert.ok(translation.length > 180, "Die Übersetzung ist unerwartet kurz.");
assert.doesNotMatch(translation, /\[[^\]]+\]|nicht gefunden|wortwörtlich/i);
for (const expected of [
  /Caesar/i,
  /Feind/i,
  /Stadt/i,
  /Buch/i,
  /nicht/i,
  /Mädchen/i,
  /Brief/i,
  /Tor|Türen/i,
  /Frieden/i,
  /müde|erschöpft/i
]) assert.match(translation, expected);
for (const construction of [
  /Caesar.{0,50}(?:sagte|erklärte).{0,80}(?:Feind|Gegner).{0,60}(?:besiegt|geschlagen)/i,
  /(?:Stadt.{0,40}(?:erobert|eingenommen)|Eroberung der Stadt).{0,80}(?:Soldat|Truppen)/i,
  /Brief.{0,80}(?:(?:muss|musste|soll|sollte).{0,50}gelesen|ist.{0,30}zu lesen)/i,
  /(?:Gesandte|Boten).{0,80}(?:um|damit).{0,60}Frieden/i,
  /so (?:müde|erschöpft).{0,50}dass.{0,80}nicht/i
]) assert.match(oneLine, construction);
assert.doesNotMatch(translation, /\bdas Tempel\b|\beinen Opfer\b|aus (?:ihren|den) [^.!?]{0,30} aus\b/i);

const terminalCount = (translation.match(/[.!?](?:["'“”’»]|\s|$)/g) || []).length;
assert.ok(terminalCount >= 9, `Nur ${terminalCount} von 10 Sätzen wurden abgeschlossen.`);

console.log("\nBlindtest bestanden: 10 unbekannte Sätze und zentrale Grammatikstrukturen wurden abgedeckt.");
