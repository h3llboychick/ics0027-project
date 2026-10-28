import assert from "node:assert/strict";
import test from "node:test";
import { createFileDownloadResponse } from "../src/lib/http/download-response.ts";

const originalBytes = new Uint8Array([0, 10, 13, 127, 128, 255]);

for (const filename of [
  "report.txt",
  "quarterly report 2026.txt",
  'report-"draft".txt',
  "report-\\draft.txt",
  "aruanne-õ.txt",
  "aruanne-õ-文件.txt",
  "report-🔒.txt",
  "report-'draft'(*).txt",
  "100% complete.txt",
]) {
  test(`downloads ${JSON.stringify(filename)} with intact bytes and an encoded filename`, async () => {
    const response = createFileDownloadResponse(new File([originalBytes], filename));
    const disposition = response.headers.get("Content-Disposition");

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/octet-stream");
    assert.match(disposition, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
    const encodedFilename = disposition.split("filename*=UTF-8''")[1];
    assert.equal(decodeURIComponent(encodedFilename), filename);
    assert.equal(/['()*]/.test(encodedFilename), false);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), originalBytes);
  });
}

test("quotes and backslashes cannot escape the ASCII filename fallback", () => {
  const response = createFileDownloadResponse(new File([], 'report-"draft"\\copy.txt'));
  const disposition = response.headers.get("Content-Disposition");

  assert.match(disposition, /^attachment; filename="report-_draft__copy.txt";/);
});

test("control characters cannot add response headers", () => {
  const response = createFileDownloadResponse(new File([], "report\r\nX-Injected: yes\u0000.txt"));
  const disposition = response.headers.get("Content-Disposition");

  assert.equal(response.headers.has("X-Injected"), false);
  assert.equal(/[\r\n\u0000]/.test(disposition), false);
  assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), "report__X-Injected: yes_.txt");
});

test("empty names receive a usable fallback", () => {
  const response = createFileDownloadResponse(new File([], ""));

  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="download"; filename*=UTF-8\'\'download');
});
