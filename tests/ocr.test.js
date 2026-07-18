import test from "node:test";
import assert from "node:assert/strict";
import { validateOcrImage } from "../ocr.js";

test("HEIC and HEIF files are accepted when the browser omits their MIME type", () => {
  assert.doesNotThrow(() => validateOcrImage(new File([new Uint8Array([1])], "scan.HEIC", { type: "" })));
  assert.doesNotThrow(() => validateOcrImage(new File([new Uint8Array([1])], "scan.heif", { type: "application/octet-stream" })));
});

test("an HEIC-looking filename cannot override a specific unsupported MIME type", () => {
  assert.throws(
    () => validateOcrImage(new File(["not an image"], "scan.heic", { type: "text/plain" })),
    /Unterstützt werden/
  );
});

test("a generic MIME type without a HEIC or HEIF extension stays unsupported", () => {
  assert.throws(
    () => validateOcrImage(new File([new Uint8Array([1])], "scan.bin", { type: "application/octet-stream" })),
    /Unterstützt werden/
  );
});
