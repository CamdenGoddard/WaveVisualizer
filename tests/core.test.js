// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLyrics, activeLineIndex } from "../js/lyrics-parser.js";
import { base64UrlEncode, challengeFor, randomVerifier } from "../js/pkce.js";

test("parses .lrc lines into sorted, timed lines", () => {
  const out = parseLyrics("[00:16.10] second\n[00:12.30] first\n[01:02] third");
  assert.equal(out.type, "synced");
  assert.deepEqual(out.lines.map((l) => l.text), ["first", "second", "third"]);
  assert.equal(out.lines[0].time, 12.3);
  assert.equal(out.lines[2].time, 62);
});

test("drops empty timestamped lines but stays synced", () => {
  const out = parseLyrics("[00:01.00]\n[00:02.00] hello");
  assert.equal(out.type, "synced");
  assert.equal(out.lines.length, 1);
});

test("falls back to plain lyrics without timestamps", () => {
  const out = parseLyrics("line one\n\n  line two  \r\n");
  assert.deepEqual(out, { type: "plain", lines: ["line one", "line two"] });
});

test("finds the active line for a playback time", () => {
  const lines = [{ time: 5 }, { time: 10 }, { time: 15 }];
  assert.equal(activeLineIndex(lines, 0), -1);
  assert.equal(activeLineIndex(lines, 5), 0);
  assert.equal(activeLineIndex(lines, 12.4), 1);
  assert.equal(activeLineIndex(lines, 99), 2);
});

test("base64url encoding has no padding or unsafe characters", () => {
  assert.equal(base64UrlEncode(new Uint8Array([251, 255, 254]).buffer), "-__-");
});

test("PKCE challenge matches the RFC 7636 test vector", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(await challengeFor(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("random verifier is the requested length and URL-safe", () => {
  const v = randomVerifier(64);
  assert.equal(v.length, 64);
  assert.match(v, /^[A-Za-z0-9]+$/);
});
