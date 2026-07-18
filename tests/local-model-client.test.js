import test from "node:test";
import assert from "node:assert/strict";
import { bookVocabularyHints, requestLocalModelTranslation } from "../local-model-client.js";

test("book vocabulary hints prefer the textbook over fallback meanings", () => {
  const hints = bookVocabularyHints({ matches: [{
    token: "petivit",
    entries: [
      { source: "fallback", latein: "peto", deutsch: "angreifen" },
      { source: "book", lektion: 12, latein: "petere", deutsch: "aufsuchen", grammatik: "peto, petivi" }
    ]
  }] });
  assert.deepEqual(hints, [{
    token: "petivit",
    latin: "petere",
    german: "aufsuchen",
    grammar: "peto, petivi",
    source: "Buch Lektion 12"
  }]);
});

test("ambiguous textbook meanings are all sent before local fallback senses", () => {
  const hints = bookVocabularyHints({ matches: [{
    token: "ignotum",
    entries: [{ source: "freedict", latein: "ignotus", deutsch: "unbekannt", grammatik: "-a, -um" }]
  }, {
    token: "pergere",
    entries: [
      { source: "book", lektion: 2, latein: "pergere", deutsch: "etwas weiter tun, fortsetzen", grammatik: "pergit" },
      { source: "book", lektion: 21, latein: "pergere", deutsch: "weitergehen", grammatik: "pergo, perrexi, perrectum" },
      { source: "freedict", latein: "pergo", deutsch: "aufbrechen", grammatik: "Verb" }
    ]
  }] });
  assert.deepEqual(hints, [{
    token: "pergere",
    latin: "pergere",
    german: "etwas weiter tun, fortsetzen",
    grammar: "pergit",
    source: "Buch Lektion 2"
  }, {
    token: "pergere",
    latin: "pergere",
    german: "weitergehen",
    grammar: "pergo, perrexi, perrectum",
    source: "Buch Lektion 21"
  }, {
    token: "ignotum",
    latin: "ignotus",
    german: "unbekannt",
    grammar: "-a, -um",
    source: "Lokales Wörterbuch"
  }]);
});

test("all dictionary meanings remain available when no textbook entry exists", () => {
  const hints = bookVocabularyHints({ matches: [{
    token: "ignotum",
    entries: [{ source: "freedict", lemma: "ignotus", meanings: ["unbekannt", "fremd"], grammatik: "-a, -um" }]
  }] });
  assert.deepEqual(hints.map(hint => hint.german), ["unbekannt", "fremd"]);
  assert.ok(hints.every(hint => hint.source === "Lokales Wörterbuch"));
});

test("local dictionary vocabulary fills gaps that are absent from the textbook", () => {
  const hints = bookVocabularyHints({ matches: [{
    token: "antrum",
    entries: [{ source: "freedict", latein: "antrum", deutsch: "Höhle", grammatik: "antri n." }]
  }] });
  assert.deepEqual(hints, [{
    token: "antrum",
    latin: "antrum",
    german: "Höhle",
    grammar: "antri n.",
    source: "Lokales Wörterbuch"
  }]);
});

test("the browser uses the same-origin model endpoint when it is available", async () => {
  let request;
  const result = await requestLocalModelTranslation({
    latinText: "Mater filio librum dedit.",
    rawOcrText: "Mater fili0 librum dedit.",
    imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    analysis: { matches: [] },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        translation: "Die Mutter gab dem Sohn das Buch.",
        normalizedLatin: "Mater filio librum dedit.",
        confidence: .96,
        warnings: [],
        model: "test-model"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.equal(request.url, "./api/translate");
  assert.equal(request.options.method, "POST");
  assert.equal(JSON.parse(request.options.body).rawOcrText, "Mater fili0 librum dedit.");
  assert.match(JSON.parse(request.options.body).image, /^data:image\/png;base64,/);
  assert.equal(result.translation, "Die Mutter gab dem Sohn das Buch.");
  assert.equal(result.confidence, .96);
});

test("GitHub Pages without an API keeps the static translator fallback", async () => {
  const result = await requestLocalModelTranslation({
    latinText: "Puella venit.",
    analysis: { matches: [] },
    fetchImpl: async () => new Response("not found", { status: 404 })
  });
  assert.equal(result, null);
});

test("a local vision server can recover an image even when browser OCR is empty", async () => {
  let requestBody;
  const result = await requestLocalModelTranslation({
    latinText: "",
    imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    analysis: { matches: [] },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        normalizedLatin: "Puella venit.",
        translation: "Das Mädchen kommt.",
        confidence: .9,
        warnings: [],
        model: "vision-test"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.equal(requestBody.latinText, "");
  assert.equal(result.normalizedLatin, "Puella venit.");
});
