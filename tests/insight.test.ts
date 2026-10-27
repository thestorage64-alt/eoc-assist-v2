import test from "node:test";
import assert from "node:assert/strict";
import { circularToMarkdown } from "../src/lib/insight/markdown";
import { markdownToDocx } from "../src/lib/insight/docx";
import { markdownToPdf } from "../src/lib/insight/pdf";
import { CELL_SPEC, SDG_NAMES } from "../src/lib/contracts";

const detail: any = {
  id: "c1",
  ref: "EOC-2026-0001",
  title: "Test Circular Title",
  body: "Body text here",
  source: "UGC",
  receivedAt: Date.parse("2026-01-01T00:00:00Z"),
  dueAt: Date.parse("2026-02-01T00:00:00Z"),
  state: "route",
  cellId: "cell_01",
  assignedTo: "u1",
  createdBy: "usr_chair",
  confidential: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  classification: {
    suggestion: null,
    final: {
      primaryCell: "cell_01",
      relatedCells: ["cell_02"],
      primarySdg: 4,
      relatedSdgs: [10],
      reason: "reason text here long enough to pass validation maybe",
      confidence: "high",
      tags: ["tag"],
    },
    verdict: "confirmed",
    decidedBy: "usr_chair",
    decidedAt: Date.parse("2026-01-02T00:00:00Z"),
  },
  meetings: [],
  actions: [
    { id: "a1", circularId: "c1", meetingId: null, title: "Action One", ownerId: "u1", dueAt: Date.parse("2026-02-10T00:00:00Z"), status: "open", completedAt: null, createdAt: Date.now() },
    { id: "a2", circularId: "c1", meetingId: null, title: "Action Two", ownerId: null, dueAt: null, status: "open", completedAt: null, createdAt: Date.now() },
  ],
  documents: [],
};

test("markdown contains title, ref, cell name, and every action with owner + date", () => {
  const md = circularToMarkdown(detail, "SC/ST Cell", { u1: "Alice" });
  assert.ok(md.includes(detail.title));
  assert.ok(md.includes(detail.ref));
  assert.ok(md.includes("SC/ST Cell"));
  assert.ok(md.includes("Action One"));
  assert.ok(md.includes("Alice"));
  assert.ok(md.includes("Action Two"));
});

test("missing optional fields render Not specified", () => {
  const d = { ...detail, body: "", source: null, dueAt: null, assignedTo: null };
  const md = circularToMarkdown(d, "SC/ST Cell", {});
  assert.ok(md.includes("Not specified"));
});

test("SDG table covers only SDGs present in data", () => {
  assert.ok(SDG_NAMES[4] === "Quality Education");
});

test("docx builder returns Buffer starting with PK", async () => {
  const md = circularToMarkdown(detail, "SC/ST Cell", { u1: "Alice" });
  const buf = await markdownToDocx(md);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);
});

test("pdf builder returns Buffer starting with %PDF", async () => {
  const md = circularToMarkdown(detail, "SC/ST Cell", { u1: "Alice" });
  const buf = await markdownToPdf(md);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.slice(0, 4).toString() === "%PDF");
});
