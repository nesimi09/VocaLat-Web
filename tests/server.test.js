import test from "node:test";
import assert from "node:assert/strict";
import { safeStaticPath } from "../server.mjs";

test("static file resolution maps the root and app files", () => {
  assert.match(safeStaticPath("/"), /VocaLat-Web\/index\.html$/);
  assert.match(safeStaticPath("/app.js"), /VocaLat-Web\/app\.js$/);
});

test("static file resolution refuses paths outside the app", () => {
  assert.equal(safeStaticPath("/../private.txt"), null);
  assert.equal(safeStaticPath("/%2e%2e/private.txt"), null);
  assert.equal(safeStaticPath("/%E0%A4%A"), null);
});
