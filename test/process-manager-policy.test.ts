import assert from "node:assert/strict";
import test from "node:test";
import { detectLoopbackUrls } from "../src/process-manager";

test("discovers only normalized loopback URLs in managed process output", () => {
  assert.deepEqual(detectLoopbackUrls([
    "ready at http://0.0.0.0:5173/path?token=hidden",
    "preview http://localhost:3000/app.",
    "remote https://example.com/not-allowed"
  ].join("\n")), [
    "http://127.0.0.1:5173/path",
    "http://localhost:3000/app"
  ]);
});

test("ignores malformed and out-of-range local URLs", () => {
  assert.deepEqual(detectLoopbackUrls("http://localhost:99999 http://127.0.0.1:abc"), []);
});
