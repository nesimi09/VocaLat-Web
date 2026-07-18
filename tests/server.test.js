import test from "node:test";
import assert from "node:assert/strict";
import { buildTranslationMessages, hasSufficientVisionCoverage, polishGermanTranslation, safeStaticPath, sanitizeImageDataUrl, splitTranslationChunks, translateWithOllama, translateWithTranslateGemma } from "../server.mjs";

test("the local model prompt requires natural syntax and textbook meanings", () => {
  const messages = buildTranslationMessages("Aeneas templum petivit.", [{
    token: "petivit", latin: "petere", german: "aufsuchen", grammar: "peto, petivi", source: "Buch Lektion 12"
  }]);
  const prompt = messages.map(message => message.content).join("\n");
  assert.match(prompt, /AcI\/NcI/);
  assert.match(prompt, /Buchbedeutungen haben Vorrang/);
  assert.match(prompt, /petere = aufsuchen/);
  assert.match(prompt, /<LATIN-ENTWURF>/);
  assert.match(prompt, /idiomatische deutsche Sätze/);
});

test("the server parses structured local-model translations", async () => {
  let ollamaRequest;
  const result = await translateWithOllama({
    latinText: "Cuncti e navibus exierunt.",
    bookVocabulary: [],
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.model === "translategemma:12b") return new Response("missing", { status: 404 });
      ollamaRequest = { url, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ message: { content: JSON.stringify({
        normalizedLatin: "Cuncti e navibus exierunt.",
        translation: "Alle stiegen aus den Schiffen.",
        confidence: .94,
        warnings: []
      }) } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.match(ollamaRequest.url, /\/api\/chat$/);
  assert.equal(ollamaRequest.body.stream, false);
  assert.equal(ollamaRequest.body.think, false);
  assert.equal(result.translation, "Alle stiegen aus den Schiffen.");
});

test("static file resolution refuses paths outside the app", () => {
  assert.match(safeStaticPath("/app.js"), /VocaLat-Web\/app\.js$/);
  assert.equal(safeStaticPath("/../private.txt"), null);
  assert.equal(safeStaticPath("/%2e%2e/private.txt"), null);
});

test("the vision prompt receives only validated image bytes and the OCR clue", async () => {
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const ollamaBodies = [];
  const result = await translateWithOllama({
    latinText: "Cunti e navibus exierunt.",
    rawOcrText: "Cunti e nàvibus exierunt.",
    image,
    bookVocabulary: [{ token: "Cunti", latin: "cuncti", german: "alle", source: "Buch" }],
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      ollamaBodies.push(body);
      if (body.model === "translategemma:12b") {
        return new Response("missing", { status: 404 });
      }
      if (body.model === "qwen3.5:9b" && ollamaBodies.filter(item => item.model === "qwen3.5:9b").length === 1) {
        return new Response(JSON.stringify({ message: { content: "5 Cuncti e navibus exierunt." } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ message: { content: JSON.stringify({
        normalizedLatin: "Cuncti e navibus exierunt.",
        translation: "Alle stiegen von den Schiffen.",
        confidence: .9,
        warnings: []
      }) } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.equal(ollamaBodies.length, 4);
  assert.deepEqual(ollamaBodies[0].messages[1].images, ["iVBORw0KGgo="]);
  assert.match(ollamaBodies[0].messages[1].content, /Cunti e nàvibus/);
  assert.match(ollamaBodies[0].messages[1].content, /<FORMEN-ENTWURF>/);
  assert.match(ollamaBodies[0].messages[1].content, /Cunti → cuncti/);
  assert.equal(ollamaBodies[1].model, "translategemma:12b");
  assert.match(ollamaBodies[2].messages[1].content, /Cuncti e navibus/);
  assert.match(ollamaBodies[3].messages[1].content, /DEUTSCHER-ENTWURF/);
  assert.equal(result.normalizedLatin, "Cuncti e navibus exierunt.");
  assert.equal(sanitizeImageDataUrl(image), "iVBORw0KGgo=");
  assert.throws(() => sanitizeImageDataUrl("data:image/png;base64,SGFsbG8="), /Dateityp/);
});

test("vision OCR rejects a clearly truncated result when a longer Latin clue exists", () => {
  assert.equal(hasSufficientVisionCoverage("Cuncti e navibus exierunt.", "Cuncti e navibus exierunt."), true);
  assert.equal(hasSufficientVisionCoverage("Cuncti e navibus exierunt.", "Cuncti e navibus exierunt. Aeneas templum petivit. Sibylla futura dicebat. Romani ad urbem contenderunt."), false);
  assert.equal(hasSufficientVisionCoverage("Cuncti e navibus exierunt."), true);
});

test("TranslateGemma receives the documented Latin-to-German prompt", async () => {
  let request;
  const translation = await translateWithTranslateGemma("Puella rosam tenet.", async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ message: { content: "Das Mädchen hält eine Rose." } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });
  assert.equal(request.model, "translategemma:12b");
  assert.equal(request.messages.length, 1);
  assert.match(request.messages[0].content, /Latin \(la\) to German \(de\)/);
  assert.match(request.messages[0].content, /\n\nPuella rosam tenet\./);
  assert.equal(translation, "Das Mädchen hält eine Rose.");
});

test("the specialist translation survives an uncertain vocabulary review", async () => {
  const result = await translateWithOllama({
    latinText: "Cuncti e navibus exierunt.",
    bookVocabulary: [{ token: "cuncti", latin: "cuncti", german: "alle", source: "Buch" }],
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.model === "translategemma:12b") {
        return new Response(JSON.stringify({ message: { content: "Alle stiegen von den Schiffen." } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ message: { content: JSON.stringify({
        translation: "Alle traten aus den Schiffen aus.",
        confidence: .7,
        warnings: []
      }) } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.equal(result.model, "translategemma:12b");
  assert.equal(result.translation, "Alle stiegen von den Schiffen.");
  assert.equal(result.normalizedLatin, "Cuncti e navibus exierunt.");
  assert.equal(result.confidence, .68);
});

test("the specialist translation survives a confident review that drops a sentence", async () => {
  const specialist = "Aeneas kam nach Italien. Dort suchte er den Tempel auf.";
  const result = await translateWithOllama({
    latinText: "Aeneas in Italiam venit. Ibi templum petivit.",
    bookVocabulary: [{ token: "petivit", latin: "petere", german: "aufsuchen", source: "Buch" }],
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.model === "translategemma:12b") {
        return new Response(JSON.stringify({ message: { content: specialist } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ message: { content: JSON.stringify({
        translation: "Aeneas kam nach Italien und suchte dort den Tempel auf.",
        confidence: .99,
        warnings: []
      }) } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.equal(result.translation, specialist);
});

test("a safe review may restore a sentence omitted by the specialist", async () => {
  const specialist = "Aeneas kam nach Italien. Danach kehrte er zurück.";
  const restored = "Aeneas kam nach Italien. Dort suchte er den Tempel auf. Danach kehrte er zurück.";
  const result = await translateWithOllama({
    latinText: "Aeneas in Italiam venit. Ibi templum petivit. Deinde rediit.",
    bookVocabulary: [{ token: "petivit", latin: "petere", german: "aufsuchen", source: "Buch" }],
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.model === "translategemma:12b") {
        return new Response(JSON.stringify({ message: { content: specialist } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ message: { content: JSON.stringify({
        translation: restored,
        confidence: .96,
        warnings: []
      }) } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.equal(result.translation, restored);
});

test("the final German pass repairs common model errors without a passage-specific translation", () => {
  const latin = "Cuncti e navibus exierunt. Aeneas templum petivit et sacrum fecit. Deinde Aeneas: ‘Tu, o vates, futura providere potes. Sine nos considere! Te obsecro.’";
  const draft = "Alle stiegen bei Cumae aus ihren Schiffen aus. Aeneas suchte das Tempel auf und brachte einen Opfer dar. Dann fragte Aeneas: ‘Du, o Seherin, kannst du uns die Zukunft vorhersehen? Lasst uns zur Ruhe kommen! Bitte dich: Hilf uns.’";
  const polished = polishGermanTranslation(latin, draft);
  assert.match(polished, /Alle gingen bei Cumae von Bord/);
  assert.match(polished, /suchte den Tempel auf und brachte ein Opfer dar/);
  assert.match(polished, /Dann sagte Aeneas/);
  assert.match(polished, /Du, o Seherin, kannst die Zukunft vorhersehen\./);
  assert.match(polished, /Lass uns zur Ruhe kommen/);
  assert.match(polished, /Ich bitte dich/);
});

test("the final German pass uses nominative gender at a sentence start", () => {
  assert.equal(polishGermanTranslation("Templum magnum est.", "Das Tempel ist groß."), "Der Tempel ist groß.");
  assert.equal(polishGermanTranslation("Templum stat.", "Er sagt, dass das Tempel steht."), "Er sagt, dass der Tempel steht.");
});

test("the final German pass preserves a cave, the gods' will and proper names", () => {
  const latin = "Ante templum Sibylla antrum habitabat. Aeneas ex ea voluntatem deorum cognoscere cupit. Ea Aeneam ad antrum vocavit.";
  const draft = "Vor dem Tempel wohnte die Sibylle. Äneas möchte ihren Willen erfahren. Sie rief Aeneas ins Innere.";
  const polished = polishGermanTranslation(latin, draft);
  assert.equal(polished, "Vor dem Tempel wohnte die Sibylle in einer Höhle. Aeneas möchte von ihr den Willen der Götter erfahren. Sie rief Aeneas zur Höhle.");
});

test("the final German pass applies grammar repairs to OCR text with macrons", () => {
  const latin = "Cūntī ē nāvibus exiērunt. Ibī hominibus futūra dīcēbat. Aenēās ex eā voluntātem deōrum cōgnōscere cupiō. Dēinde Aenēās: „Tū, ō vātēs, futūra prōvidēre potes. Sine nōs cōnsīdere!“";
  const draft = "Die Übrigen stiegen von den Schiffen. Dort erzählte sie den Menschen von der Zukunft. Äneas möchte ihren Willen und den der Götter erfahren. Dann sagte Äneas: „Du, oh Seherin, kannst du die Zukunft vorhersehen? Lasst uns zur Ruhe kommen!“";
  const polished = polishGermanTranslation(latin, draft);
  assert.equal(polished, "Alle stiegen von den Schiffen. Dort sagte sie den Menschen die Zukunft voraus. Aeneas möchte von ihr den Willen der Götter erfahren. Dann sagte Aeneas: „Du, o Seherin, kannst die Zukunft vorhersehen. Lass uns zur Ruhe kommen!“");
});

test("long Latin passages are split only at sentence or word boundaries", () => {
  const text = Array.from({ length: 12 }, (_, index) => `Sententia ${index + 1} satis longa est.`).join(" ");
  const chunks = splitTranslationChunks(text, 90);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(" "), text);
  assert.ok(chunks.every(chunk => chunk.length <= 90));
});

test("direct speech stays in one translation chunk until its closing quote", () => {
  const text = "Aeneas dixit: „Tu futura providere potes. Quis nos adiuvabit? Quando patriam habebimus? Dic mihi verum!“ Deinde discessit.";
  const chunks = splitTranslationChunks(text, 55);
  const speechChunk = chunks.find(chunk => chunk.includes("„Tu"));
  assert.match(speechChunk, /Dic mihi verum!“/);
  assert.equal(chunks.join(" "), text);
});

test("direct speech in single typographic quotes stays together", () => {
  const text = "Aeneas dixit: ‘Tu futura providere potes. Quis nos adiuvabit? Dic mihi verum!’ Deinde discessit.";
  const chunks = splitTranslationChunks(text, 55);
  const speechChunk = chunks.find(chunk => chunk.includes("‘Tu"));
  assert.match(speechChunk, /Dic mihi verum!’/);
  assert.equal(chunks.join(" "), text);
});
