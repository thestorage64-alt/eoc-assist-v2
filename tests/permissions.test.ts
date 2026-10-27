import test from "node:test";
import assert from "node:assert/strict";
import {
  cellRoleOf,
  isChair,
  isPrincipal,
  canReadCircular,
  canCreateCircular,
  canEditCircular,
  canConfirmClassification,
  canAdvance,
  canSignMinutes,
  canCloseAction,
  canExport,
  canReadAudit,
} from "../src/lib/core/permissions";

function actor(role: any, memberships: { cellId: string; role: "head" | "member" }[] = [], id = "u1") {
  return {
    user: { id, email: "x@x", name: "X", designation: "", phone: "", role, status: "active" as const },
    memberships,
  } as any;
}

test("member cannot confirm; head of that cell can; head of another cannot", () => {
  const member = actor("member", [{ cellId: "cell_01", role: "member" }]);
  const head = actor("head", [{ cellId: "cell_01", role: "head" }]);
  const otherHead = actor("head", [{ cellId: "cell_02", role: "head" }]);
  assert.equal(canConfirmClassification(member, "cell_01"), false);
  assert.equal(canConfirmClassification(head, "cell_01"), true);
  assert.equal(canConfirmClassification(otherHead, "cell_01"), false);
});

test("chair can confirm any cell", () => {
  const chair = actor("chair", []);
  assert.equal(canConfirmClassification(chair, "cell_01"), true);
  assert.equal(canConfirmClassification(chair, "cell_09"), true);
});

test("principal can confirm nothing and cannot create circulars", () => {
  const principal = actor("principal", []);
  assert.equal(canConfirmClassification(principal, "cell_01"), false);
  assert.equal(canCreateCircular(principal), false);
});

test("confidential circular visibility", () => {
  const memberOwn = actor("member", [{ cellId: "cell_01", role: "member" }], "m1");
  const memberOther = actor("member", [{ cellId: "cell_02", role: "member" }], "m2");
  const chair = actor("chair", [], "c1");
  const principal = actor("principal", [], "p1");
  const c = { cellId: "cell_01", confidential: true };
  assert.equal(canReadCircular(memberOther, c), false);
  assert.equal(canReadCircular(memberOwn, c), true);
  assert.equal(canReadCircular(chair, c), true);
  assert.equal(canReadCircular(principal, c), true);
});

test("canCloseAction allows owner and cell head, not unrelated member", () => {
  const owner = actor("member", [{ cellId: "cell_01", role: "member" }], "owner1");
  const head = actor("head", [{ cellId: "cell_01", role: "head" }], "head1");
  const unrelated = actor("member", [{ cellId: "cell_02", role: "member" }], "unrel");
  assert.equal(canCloseAction(owner, "owner1", "cell_01"), true);
  assert.equal(canCloseAction(head, "other", "cell_01"), true);
  assert.equal(canCloseAction(unrelated, "other", "cell_01"), false);
});

test("canReadAudit allows chair/principal, head only own cell", () => {
  const chair = actor("chair", []);
  const principal = actor("principal", []);
  const headOwn = actor("head", [{ cellId: "cell_01", role: "head" }]);
  const headOther = actor("head", [{ cellId: "cell_02", role: "head" }]);
  assert.equal(canReadAudit(chair, "cell_01"), true);
  assert.equal(canReadAudit(principal, "cell_01"), true);
  assert.equal(canReadAudit(headOwn, "cell_01"), true);
  assert.equal(canReadAudit(headOther, "cell_01"), false);
});

test("principal read-only writes", () => {
  const principal = actor("principal", []);
  const c = { cellId: "cell_01" };
  assert.equal(canEditCircular(principal, c), false);
  assert.equal(canAdvance(principal, c), false);
  assert.equal(canSignMinutes(principal, "cell_01"), false);
  assert.equal(canCloseAction(principal, "x", "cell_01"), false);
});

test("canExport anyone signed in", () => {
  const member = actor("member", []);
  assert.equal(canExport(member), true);
});
