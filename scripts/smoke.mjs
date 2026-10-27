#!/usr/bin/env node
/**
 * End-to-end smoke test against a running server and a migrated database.
 *
 * Proves the journey a demo actually takes: sign in, create a circular, get an
 * AI suggestion, confirm it as a human, route it, meet, generate minutes, sign
 * them into actions, and export the record. Asserts on content, not just status.
 *
 *   node scripts/smoke.mjs                 # http://localhost:3001
 *   BASE=http://host:3000 node scripts/smoke.mjs
 */
const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.SMOKE_EMAIL ?? "chair@hkbk.edu.in";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "Eoc@2026";
const TIMEOUT = 90_000;

let cookie = "";
const rows = [];

function record(name, ok, detail = "") {
  rows.push({ name, ok });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
}

async function call(path, { method = "GET", body, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* markdown or binary */ }
  return { status: res.status, text, json, type: res.headers.get("content-type") ?? "" };
}

async function main() {
  const login = await call("/api/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
  record("login", login.status === 200 && Boolean(cookie), String(login.status));
  if (!cookie) throw new Error("no session cookie; cannot continue");

  const title = `Smoke test circular ${new Date().toISOString()}`;
  const bodyText =
    "UGC circular: renewal of Merit-cum-Means scholarships for students belonging to " +
    "minority communities for the academic year 2026-27, to be completed before 15 November " +
    "2026. A nodal officer must be nominated from the Minority Cell.";

  const created = await call("/api/circulars", { method: "POST", body: { title, body: bodyText, source: "UGC" } });
  const circular = created.json?.circular;
  record("create circular", created.status === 201 && Boolean(circular?.id), circular?.ref ?? "");
  if (!circular) throw new Error("cannot continue without a circular");

  const classify = await call(`/api/circulars/${circular.id}/classify`, { method: "POST", body: {} });
  const suggestion = classify.json?.suggestion;
  record(
    "ai classification",
    classify.status === 200 && /^cell_\d{2}$/.test(suggestion?.primaryCell ?? ""),
    `${classify.status} ${suggestion?.primaryCell ?? "-"} sdg ${suggestion?.primarySdg ?? "-"}`,
  );
  if (!suggestion) throw new Error("no suggestion to confirm");

  const confirm = await call(`/api/circulars/${circular.id}/confirm`, {
    method: "POST",
    body: { classification: suggestion, verdict: "confirmed" },
  });
  record("human confirmation", confirm.status === 200 && confirm.json?.classification?.verdict === "confirmed", String(confirm.status));

  const route = await call(`/api/circulars/${circular.id}/transition`, { method: "POST", body: { to: "route" } });
  record(
    "route to cell",
    route.status === 200 && route.json?.circular?.state === "route" && Boolean(route.json?.circular?.cellId),
    `${route.json?.circular?.cellId ?? "-"} / ${route.json?.circular?.assignedTo ?? "-"}`,
  );

  const meeting = await call(`/api/circulars/${circular.id}/meetings`, {
    method: "POST",
    body: {
      held_at: Date.now(),
      notes:
        "Meeting held to plan the scholarship renewal. Decision: verification closes on 5 November. " +
        "Dr. Maaz Ahmed will notify all departments by 28 October. The Chairperson will file the " +
        "utilisation certificate by 20 November.",
    },
  });
  const meetingId = meeting.json?.meeting?.id;
  record("create meeting", meeting.status === 201 && Boolean(meetingId), String(meeting.status));

  const minutes = await call(`/api/meetings/${meetingId}/minutes`, { method: "POST", body: {} });
  const actions = minutes.json?.proposedActions ?? [];
  record(
    "generate minutes",
    minutes.status === 200 && (minutes.json?.minutesMd?.length ?? 0) > 100 && actions.length >= 1,
    `${minutes.status} ${actions.length} proposed`,
  );

  const sign = await call(`/api/meetings/${meetingId}/sign`, { method: "POST", body: {} });
  const signedActions = sign.json?.actions ?? [];
  record(
    "sign minutes",
    sign.status === 200 && signedActions.length === actions.length && signedActions.every((a) => a.title),
    `${signedActions.length} actions`,
  );

  const list = await call(`/api/circulars/${circular.id}/actions`);
  record("actions on circular", list.status === 200 && (list.json?.actions?.length ?? 0) >= signedActions.length, String(list.status));

  const exported = await call(`/api/circulars/${circular.id}/export?format=md`);
  record("export markdown", exported.status === 200 && exported.text.includes(title), `${exported.text.length}b`);

  const dashboard = await call("/api/dashboard");
  record("dashboard", dashboard.status === 200 && typeof dashboard.json?.counts?.open === "number", String(dashboard.status));

  const failed = rows.filter((r) => !r.ok);
  console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
  if (failed.length) {
    console.error("failed: " + failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("smoke crashed:", e.message);
  process.exit(1);
});
