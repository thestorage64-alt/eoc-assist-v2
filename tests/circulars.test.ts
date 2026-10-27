import test from "node:test";
import assert from "node:assert/strict";
import { parseClassification } from "../src/lib/circulars/classify";
import { canTransition, isLegalEdge } from "../src/lib/circulars/state";
import { buildPrompt } from "../src/lib/circulars/prompt";
import { CELL_SPEC, SDG_NAMES } from "../src/lib/contracts";

const valid = {
  primaryCell: "cell_01",
  relatedCells: ["cell_02"],
  primarySdg: 4,
  relatedSdgs: [10],
  reason: "This circular concerns student welfare and mentoring support for first-year students.",
  confidence: "high",
  tags: ["students", "welfare"],
};

test("parseClassification accepts a valid object", () => {
  const r = parseClassification(valid);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value.primaryCell, "cell_01");
});

test("parseClassification rejects unknown cell id", () => {
  const r = parseClassification({ ...valid, primaryCell: "cell_99" });
  assert.equal(r.ok, false);
});

test("parseClassification rejects SDG 0, 18, 4.5 and unknown keys", () => {
  assert.equal(parseClassification({ ...valid, primarySdg: 0 }).ok, false);
  assert.equal(parseClassification({ ...valid, primarySdg: 18 }).ok, false);
  assert.equal(parseClassification({ ...valid, primarySdg: 4.5 }).ok, false);
  assert.equal(parseClassification({ ...valid, foo: "bar" }).ok, false);
});

test("parseClassification rejects final or verdict", () => {
  assert.equal(parseClassification({ ...valid, final: {} }).ok, false);
  assert.equal(parseClassification({ ...valid, verdict: "confirmed" }).ok, false);
});

test("relatedCells may not contain primaryCell", () => {
  const r = parseClassification({ ...valid, relatedCells: ["cell_01"] });
  assert.equal(r.ok, false);
});

test("transition table: legal edge accepted", () => {
  const r = canTransition("route", "convene");
  assert.equal(r.ok, true);
});

test("transition table: illegal edge rejected", () => {
  const r = canTransition("intake", "convene");
  assert.equal(r.ok, false);
});

test("intake->route requires final", () => {
  assert.equal(canTransition("intake", "route", { hasFinal: false }).ok, false);
  assert.equal(canTransition("intake", "route", { hasFinal: true }).ok, true);
});

test("report->done requires approved report", () => {
  assert.equal(canTransition("report", "done", { hasApprovedReport: false }).ok, false);
  assert.equal(canTransition("report", "done", { hasApprovedReport: true }).ok, true);
});

test("buildPrompt includes all 14 cell ids and all 17 SDG numbers", () => {
  const p = buildPrompt();
  for (const c of CELL_SPEC) assert.ok(p.includes(c.id), c.id);
  for (let i = 1; i <= 17; i++) assert.ok(p.includes(String(i)), String(i));
  // sdg names maybe
  assert.ok(p.includes(SDG_NAMES[1]));
});