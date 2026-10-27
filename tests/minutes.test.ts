import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMinutes,
  resolveOwner,
  deriveFallbackMinutes,
  canSign,
} from "../src/lib/meetings/minutes";

const validAction = { title: "Prepare report", owner_name: "Dr. Balaji", due_date: "2026-11-15" };

const valid = {
  minutes_md: "A".repeat(100),
  decisions: ["Decision one", "Decision two"],
  proposed_actions: [validAction],
};

test("parseMinutes accepts a valid payload", () => {
  const r = parseMinutes(valid);
  assert.equal(r.ok, true);
});

test("parseMinutes rejects unknown key", () => {
  const r = parseMinutes({ ...valid, foo: "bar" });
  assert.equal(r.ok, false);
});

test("parseMinutes rejects empty decisions", () => {
  const r = parseMinutes({ ...valid, decisions: [] });
  assert.equal(r.ok, false);
});

test("action title too short / too long rejected", () => {
  const short = { ...valid, proposed_actions: [{ ...validAction, title: "abc" }] };
  const long = { ...valid, proposed_actions: [{ ...validAction, title: "A".repeat(161) }] };
  assert.equal(parseMinutes(short).ok, false);
  assert.equal(parseMinutes(long).ok, false);
});

test("bad due_date rejected; null accepted", () => {
  const bad = { ...valid, proposed_actions: [{ ...validAction, due_date: "not-a-date" }] };
  const ok = { ...valid, proposed_actions: [{ ...validAction, due_date: null }] };
  assert.equal(parseMinutes(bad).ok, false);
  assert.equal(parseMinutes(ok).ok, false === false); // ensure accepted
  assert.equal(parseMinutes(ok).ok, true);
});

test("unknown key in action rejected", () => {
  const r = parseMinutes({ ...valid, proposed_actions: [{ ...validAction, extra: 1 }] });
  assert.equal(r.ok, false);
});

test("resolveOwner exact, case-insensitive, ambiguous, missing", () => {
  const users = [
    { id: "u1", name: "Alice" },
    { id: "u2", name: "alice" },
    { id: "u3", name: "Bob" },
  ];
  // exact case-insensitive single? ambiguous because Alice and alice both match case-insensitively
  const amb = resolveOwner("alice", users);
  assert.equal(amb.ambiguous, true);
  assert.equal(amb.id, null);

  const singleUsers = [{ id: "u3", name: "Bob" }, { id: "u4", name: "bob" }];
  // still ambiguous due case-insensitive duplicates
  // missing
  const miss = resolveOwner("Charlie", [{ id: "u1", name: "Alice" }]);
  assert.equal(miss.id, null);
  assert.equal(miss.ambiguous, false);

  const exact = resolveOwner("Bob", [{ id: "u5", name: "bob" }]);
  assert.equal(exact.id, "u5");
  assert.equal(exact.ambiguous, false);
});

test("deriveFallbackMinutes extracts decisions and at least one dated action", () => {
  const notes = "We agreed to submit the report by 15 Nov. Action: Alice will prepare slides by 2026-11-20. Thanks.";
  const r = deriveFallbackMinutes(notes);
  assert.ok(r.decisions.length > 0);
  assert.ok(r.proposed_actions.length >= 1);
  assert.ok(r.proposed_actions.some((a) => a.due_date !== null));
});

test("signing with empty minutes is refused (pure guard)", () => {
  assert.equal(canSign(""), false);
  assert.equal(canSign("   "), false);
  assert.equal(canSign("some minutes"), true);
  assert.equal(canSign(null), false);
});
