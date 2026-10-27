#!/usr/bin/env node
/**
 * Multi-persona acceptance test against the RUNNING app (default http://localhost:3001).
 *
 *   node scripts/persona-test.mjs
 *
 * ESM, zero dependencies (global fetch + node:zlib). Never starts or stops the
 * server, never reads .env.local, never prints a secret.
 *
 * What it does
 *  - one cookie jar per persona (captures `set-cookie` on login, sends `cookie` after)
 *  - walks each persona through the brief in the order the brief lists the tasks
 *  - after every write it fetches the page the user would land on and asserts on
 *    that HTML's visible text / controls, not just on the API status
 *  - prints an assertion table plus a ranked DEFECTS list
 *
 * Mutations are all through the public HTTP API (same as a clicking user). The
 * script is additive and safe to re-run: it appends a meeting (and, if the AI
 * cooperates, its minutes + actions) to EOC-2026-0101 and creates one member
 * circular per run.
 */
import { inflateRawSync } from "node:zlib";

const BASE = process.env.EOC_BASE ?? "http://localhost:3001";
const PASSWORD = "Eoc@2026";

const REF_A = "EOC-2026-0101"; // Merit-cum-Means, cell_04, owner Maaz (state: route)
const REF_B = "EOC-2026-0110"; // Gender audit workshop, intake, no cell (chair must route)
const REF_POSH = "EOC-2026-0105"; // sealed POSH record, cell_09

const PERSONAS = {
  chair: { label: "Chairperson", email: "chair@hkbk.edu.in" },
  principal: { label: "Principal", email: "principal@hkbk.edu.in" },
  head: { label: "Cell head (Maaz)", email: "maaz@hkbk.edu.in" },
  memberA: { label: "Member A (Bharath)", email: "member@hkbk.edu.in" },
  memberB: { label: "Member B (Ayesha)", email: "member2@hkbk.edu.in" },
};

/* --------------------------------------------------------------- harness -- */

const results = [];
const observations = [];
const defects = [];

function check(persona, action, expected, observed, pass) {
  results.push({
    persona: PERSONAS[persona]?.label ?? persona,
    action,
    expected,
    observed,
    pass: pass === true,
  });
  return pass === true;
}

const note = (text) => observations.push(text);
const defect = (severity, title, evidence, where) => defects.push({ severity, title, evidence, where });

const jars = new Map();

function cookiePairs(jar) {
  return jar
    .split("; ")
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf("=");
      return [pair.slice(0, i), pair.slice(i + 1)];
    });
}

function storeCookies(key, list) {
  const map = new Map(cookiePairs(jars.get(key) ?? ""));
  for (const raw of list) {
    const first = String(raw).split(";")[0];
    const i = first.indexOf("=");
    if (i > 0) map.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  }
  jars.set(key, [...map].map(([k, v]) => `${k}=${v}`).join("; "));
}

async function http(key, path, opts = {}) {
  const { method = "GET", body, timeout = 30_000 } = opts;
  const headers = { accept: "text/html,application/json,*/*" };
  const jar = jars.get(key);
  if (jar) headers.cookie = jar;
  let payload;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: payload,
      redirect: "manual", // a redirect to /login must be visible, not followed
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    return { status: 0, error: String(e?.message ?? e), text: "", buf: Buffer.alloc(0), headers: new Headers(), json: null };
  }
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")]
        : [];
  if (setCookies.length) storeCookies(key, setCookies);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html, not json */
  }
  return { status: res.status, headers: res.headers, buf, text, json };
}

/** AI endpoints take 5-30s; the brief allows 90s and one retry on 502. */
async function aiPost(key, path, body) {
  let r = await http(key, path, { method: "POST", body: body ?? {}, timeout: 90_000 });
  let calls = 1;
  if (r.status === 502 || r.status === 504) {
    await new Promise((res) => setTimeout(res, 1_500));
    r = await http(key, path, { method: "POST", body: body ?? {}, timeout: 90_000 });
    r.retried = true;
    calls = 2;
  }
  r.calls = calls;
  return r;
}

/* ------------------------------------------------------------ html tools -- */

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
  "&hellip;": "...",
  "&mdash;": "-",
  "&ndash;": "-",
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z]+;|&#x27;|&#39;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** Visible text of an HTML document: no tags, no scripts, collapsed whitespace. */
function textOf(html) {
  return decodeEntities(
    String(html)
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Every interactive control (button / anchor / submit input) with its label. */
function controls(html) {
  const out = [];
  const src = String(html);
  for (const m of src.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    out.push({ tag: m[1].toLowerCase(), label: textOf(m[3]), attrs: m[2] });
  }
  for (const m of src.matchAll(/<input\b([^>]*)>/gi)) {
    if (!/type\s*=\s*"submit"/i.test(m[1])) continue;
    const v = /value\s*=\s*"([^"]*)"/i.exec(m[1]);
    out.push({ tag: "input", label: v ? decodeEntities(v[1]) : "submit", attrs: m[1] });
  }
  return out;
}

const labelsMatching = (html, re) =>
  controls(html)
    .map((c) => c.label)
    .filter((l) => l && re.test(l));

/** Slice of the workflow board for one column (aria-label="<Label> column, N ..."). */
function workflowColumn(html, label) {
  const src = String(html);
  const i = src.indexOf(`aria-label="${label} column`);
  if (i < 0) return "";
  const j = src.indexOf("</section>", i);
  return textOf(src.slice(i, j < 0 ? src.length : j));
}

const norm = (s) =>
  String(s ?? "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const includesNorm = (haystack, needle) => norm(haystack).includes(norm(needle));

const ascii = (s) => String(s ?? "").replace(/[^\x20-\x7e]/g, "-");

function trunc(s, n) {
  const v = ascii(String(s ?? "").replace(/\s+/g, " ").trim());
  return v.length > n ? `${v.slice(0, n - 3)}...` : v;
}

/* ------------------------------------------------------ docx (zip) reader -- */

/** Minimal ZIP local-header reader so we can unzip `word/document.xml` with no deps. */
function zipEntry(buf, want) {
  const SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  let off = 0;
  while ((off = buf.indexOf(SIG, off)) !== -1) {
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.toString("utf8", off + 30, off + 30 + nameLen);
    const dataStart = off + 30 + nameLen + extraLen;
    let dataEnd = compSize > 0 ? dataStart + compSize : -1;
    if (dataEnd < 0 || dataEnd > buf.length) {
      const next = buf.indexOf(SIG, dataStart);
      dataEnd = next === -1 ? buf.length : next;
    }
    if (name === want) {
      const data = buf.subarray(dataStart, dataEnd);
      try {
        return method === 0 ? data.toString("utf8") : inflateRawSync(data).toString("utf8");
      } catch {
        return null;
      }
    }
    off = dataEnd > dataStart ? dataEnd : dataStart;
  }
  return null;
}

/* ------------------------------------------------------------------ setup -- */

const log = (s = "") => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

log(`EOC persona acceptance test -> ${BASE}`);
log(`Started ${new Date().toISOString()}`);
log("");

/* 0. login every persona -------------------------------------------------- */

for (const [key, p] of Object.entries(PERSONAS)) {
  const r = await http(key, "/api/auth/login", { method: "POST", body: { email: p.email, password: PASSWORD } });
  const jar = jars.get(key) ?? "";
  check(
    key,
    "sign in",
    "200 + eoc_session cookie set",
    `HTTP ${r.status}, cookie ${/eoc_session=/.test(jar) ? "captured" : "MISSING"}`,
    r.status === 200 && /eoc_session=/.test(jar)
  );
  if (r.json?.user) {
    check(
      key,
      "session identity",
      `${p.email} with the expected role`,
      `${r.json.user.email} / role=${r.json.user.role} / cells=${(r.json.memberships ?? []).map((m) => `${m.cellId}:${m.role}`).join(",") || "none"}`,
      r.json.user.email === p.email
    );
  }
}

/* 1. discovery of the three named circulars (chair sees all) --------------- */

const chairList = await http("chair", "/api/circulars");
const all = chairList.json?.circulars ?? [];
const byRef = (ref) => all.find((c) => c.ref === ref);

const A = byRef(REF_A);
const B = byRef(REF_B);
const POSH = byRef(REF_POSH);

check(
  "chair",
  "discover the seeded records",
  `chair's register contains ${REF_A}, ${REF_B} and ${REF_POSH}`,
  `HTTP ${chairList.status}, ${all.length} circulars; ` +
    `${REF_A}=${A ? `found (state=${A.state}, cell=${A.cellId})` : "MISSING"}, ` +
    `${REF_B}=${B ? `found (state=${B.state}, cell=${B.cellId})` : "MISSING"}, ` +
    `${REF_POSH}=${POSH ? `found (cell=${POSH.cellId}, confidential=${POSH.confidential})` : "MISSING"}`,
  Boolean(A && B && POSH)
);

if (!A || !B || !POSH) {
  log("Seeded demo records are missing; cannot continue. Run `node scripts/seed-demo.mjs` first.");
  process.exit(2);
}

/* ============================================================ CHAIRPERSON = */

/* Task 1a: open circular B ------------------------------------------------- */

const bPage0 = await http("chair", `/circulars/${B.id}`);
check(
  "chair",
  "open circular B (Gender audit workshop)",
  "200 page with the title and the Intake stage",
  `HTTP ${bPage0.status}, title ${includesNorm(textOf(bPage0.text), B.title) ? "present" : "ABSENT"}, ` +
    `"No human decision yet" ${includesNorm(textOf(bPage0.text), "No human decision yet") ? "present" : "absent"}`,
  bPage0.status === 200 && includesNorm(textOf(bPage0.text), B.title)
);

/* Task 1b: request an AI suggestion --------------------------------------- */

// The walk below is a one-way move (intake -> route), so if an earlier run of
// this script already routed B we verify the resulting record instead of
// replaying. `node scripts/seed-demo.mjs --reset` restores a clean walk.
const bWasIntake = B.state === "intake";
let suggestion = null;

if (!bWasIntake) {
  note(
    `Circular B arrived in state "${B.state}" with cell=${B.cellId || "none"} (a previous run of this script already routed it), ` +
      `so the intake -> route walk was verified against the existing record instead of replayed. Reset the demo data with ` +
      `\`node scripts/seed-demo.mjs --reset\` for a clean walk.`
  );
  const bDetail = await http("chair", `/api/circulars/${B.id}`);
  const bc = bDetail.json?.circular?.classification ?? null;
  check(
    "chair",
    "B classification already decided (previous run)",
    "a final, human-confirmed classification exists",
    `final.primaryCell=${bc?.final?.primaryCell ?? "null"}, verdict=${bc?.verdict ?? "null"}, decidedBy=${bc?.decidedBy ?? "null"}`,
    Boolean(bc?.final) && bc.verdict === "confirmed" && Boolean(bc.decidedBy)
  );
  check(
    "chair",
    "B already routed (previous run)",
    "a cell and an owner are set on the record",
    `state=${bDetail.json?.circular?.state}, cell=${bDetail.json?.circular?.cellId ?? "null"}, owner=${bDetail.json?.circular?.assignedTo ?? "null"}`,
    bDetail.json?.circular?.state !== "intake" && Boolean(bDetail.json?.circular?.cellId)
  );
}

const classifyRes = bWasIntake
  ? await aiPost("chair", `/api/circulars/${B.id}/classify`)
  : { status: 200, json: null, skipped: true };
suggestion = classifyRes.json?.suggestion ?? null;
check(
  "chair",
  "request an AI suggestion on B",
  "200 + a validated classification suggestion",
  classifyRes.skipped
    ? "skipped: B was already routed by an earlier run"
    : classifyRes.status === 200
      ? `200; primaryCell=${suggestion?.primaryCell}, primarySdg=${suggestion?.primarySdg}, confidence=${suggestion?.confidence}`
      : `HTTP ${classifyRes.status} ${JSON.stringify(classifyRes.json ?? classifyRes.error)}`,
  classifyRes.status === 200 && (classifyRes.skipped === true || Boolean(suggestion?.primaryCell))
);

if (suggestion && bWasIntake) {
  const bPageSug = await http("chair", `/circulars/${B.id}`);
  check(
    "chair",
    "B page after the suggestion",
    "suggestion rendered and labelled as a machine suggestion, not as a decision",
    `"AI suggestion - not final" ${includesNorm(textOf(bPageSug.text), "AI suggestion") ? "present" : "ABSENT"}; ` +
      `"No human decision yet" ${includesNorm(textOf(bPageSug.text), "No human decision yet") ? "present" : "absent"}`,
    includesNorm(textOf(bPageSug.text), "AI suggestion")
  );

  /* Task 1c: confirm it */
  const confirmRes = await http("chair", `/api/circulars/${B.id}/confirm`, {
    method: "POST",
    body: { verdict: "confirmed", classification: suggestion },
  });
  const cls = confirmRes.json?.classification ?? null;
  check(
    "chair",
    "confirm the classification on B",
    "200 + final recorded, verdict=confirmed, decided_by the chair",
    confirmRes.status === 200
      ? `200; final.primaryCell=${cls?.final?.primaryCell}, verdict=${cls?.verdict}, decidedBy=${cls?.decidedBy}`
      : `HTTP ${confirmRes.status} ${JSON.stringify(confirmRes.json ?? confirmRes.error)}`,
    confirmRes.status === 200 && Boolean(cls?.final) && cls.verdict === "confirmed" && Boolean(cls.decidedBy)
  );

  const bPageConf = await http("chair", `/circulars/${B.id}`);
  check(
    "chair",
    "B page after confirming",
    "human decision labelled as final and attributed (who + when)",
    `"Human decision - final" ${includesNorm(textOf(bPageConf.text), "Human decision - final") ? "present" : "ABSENT"}; ` +
      `"Decided by" ${includesNorm(textOf(bPageConf.text), "Decided by") ? "present" : "absent"}`,
    includesNorm(textOf(bPageConf.text), "Human decision - final") && includesNorm(textOf(bPageConf.text), "Decided by")
  );

  /* Task 1d: advance intake -> route */
  const transRes = await http("chair", `/api/circulars/${B.id}/transition`, {
    method: "POST",
    body: { to: "route" },
  });
  const routed = transRes.json?.circular ?? null;
  check(
    "chair",
    "advance B from intake to route",
    "200 + state=route, a cell, and an owner",
    transRes.status === 200
      ? `200; state=${routed?.state}, cell=${routed?.cellId}, owner=${routed?.assignedTo ?? "null"}`
      : `HTTP ${transRes.status} ${JSON.stringify(transRes.json ?? transRes.error)}`,
    transRes.status === 200 && routed?.state === "route" && Boolean(routed.cellId)
  );
  B.cellId = routed?.cellId ?? null;
  B.assignedTo = routed?.assignedTo ?? null;
  B.state = routed?.state ?? B.state;
}

/* Task 2: B shows a cell + owner on its page, and sits in Routed ---------- */

const bPage1 = await http("chair", `/circulars/${B.id}`);
const bText1 = textOf(bPage1.text);
const ownerMatch = /owner\s+([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,4})/.exec(bText1);
const cellMatch = /(\d{1,2}\.\s+[A-Z][^-;|]{3,50})/.exec(bText1);
check(
  "chair",
  "B page after routing",
  "shows the cell it was routed to and the owner",
  `cell text=${cellMatch ? trunc(cellMatch[1], 40) : "none"}; owner text=${ownerMatch ? trunc(ownerMatch[1], 40) : "none"}; ` +
    `"Routed" stage ${includesNorm(bText1, "Routed") ? "shown" : "MISSING"}`,
  Boolean(B.cellId) && Boolean(B.assignedTo) && includesNorm(bText1, "owner ")
);

const wf = await http("chair", "/workflow");
const routedCol = workflowColumn(wf.text, "Routed");
const intakeCol = workflowColumn(wf.text, "Intake");
check(
  "chair",
  "/workflow board after routing B",
  "B listed in the Routed column, not in Intake",
  `HTTP ${wf.status}; Routed column ${includesNorm(routedCol, B.title) ? "CONTAINS" : "does NOT contain"} B; ` +
    `Intake column ${includesNorm(intakeCol, B.title) ? "still contains B" : "does not contain B"}`,
  wf.status === 200 && includesNorm(routedCol, B.title) && !includesNorm(intakeCol, B.title)
);

/* Task 3: export DOCX of circular A --------------------------------------- */

const docx = await http("chair", `/api/circulars/${A.id}/export?format=docx`, { timeout: 60_000 });
const docxType = docx.headers.get("content-type") ?? "";
const disposition = docx.headers.get("content-disposition") ?? "";
check(
  "chair",
  "export DOCX of circular A",
  "200, docx content-type, > 5 KB",
  `HTTP ${docx.status}, ${docx.buf.length} bytes (${(docx.buf.length / 1024).toFixed(1)} KB), ` +
    `type=${trunc(docxType, 55)}, filename=${trunc(disposition, 45)}`,
  docx.status === 200 && /wordprocessingml/.test(docxType) && docx.buf.length > 5 * 1024
);

const docXml = zipEntry(docx.buf, "word/document.xml");
const docText = docXml ? docXml.replace(/<[^>]+>/g, " ") : "";
check(
  "chair",
  "DOCX body contains the circular title",
  `title "${trunc(A.title, 45)}" readable inside the exported .docx`,
  docXml ? `document.xml unzipped (${docXml.length} chars); title ${includesNorm(docText, A.title) ? "FOUND" : "NOT FOUND"}` : "could not unzip word/document.xml",
  Boolean(docXml) && includesNorm(docText, A.title)
);
note(
  docx.buf.includes(Buffer.from(A.title, "utf8"))
    ? "DOCX: the raw bytes also contain the title in plain text."
    : "DOCX raw bytes do not contain the title as plain text -- expected for OOXML (the body is deflated inside the zip), so the title check is done on the unzipped word/document.xml. Please treat the brief's 'contains the title' literally on the decompressed document, not on the .docx bytes."
);

const md = await http("chair", `/api/circulars/${A.id}/export?format=md`);
check(
  "chair",
  "export MD of circular A (cross-check)",
  "200 markdown from the same record, carrying the title",
  `HTTP ${md.status}, ${md.buf.length} bytes, title ${includesNorm(md.text, A.title) ? "present" : "ABSENT"}`,
  md.status === 200 && includesNorm(md.text, A.title)
);

/* Task 4: chair opens the sealed POSH record ------------------------------ */

const poshChair = await http("chair", `/circulars/${POSH.id}`);
const poshChairText = textOf(poshChair.text);
check(
  "chair",
  "open the sealed POSH circular 0105",
  "200 + content visible to the chair (sealed = cell + chair + principal)",
  `HTTP ${poshChair.status}, title ${includesNorm(poshChairText, POSH.title) ? "visible" : "NOT visible"}, ` +
    `"confidential" ${includesNorm(poshChairText, "confidential") ? "flagged" : "not flagged"}`,
  poshChair.status === 200 && includesNorm(poshChairText, POSH.title)
);

const poshChairApi = await http("chair", `/api/circulars/${POSH.id}`);
check(
  "chair",
  "sealed POSH record via the API",
  "200 with the detail payload",
  `HTTP ${poshChairApi.status}, body ${poshChairApi.json?.circular?.body ? "returned" : "empty"}`,
  poshChairApi.status === 200 && Boolean(poshChairApi.json?.circular)
);

/* =============================================================== CELL HEAD = */

/* Task 5: open A (his cell), create a meeting, generate minutes ----------- */

const aPageHead = await http("head", `/circulars/${A.id}`);
const aHeadText = textOf(aPageHead.text);
const headWriteControls = labelsMatching(aPageHead.text, /confirm|correct|advance to|generate minutes|add meeting/i);
check(
  "head",
  "open circular A (his own cell)",
  "200 + the head's own write affordances are present",
  `HTTP ${aPageHead.status}; controls: ${headWriteControls.length ? trunc(headWriteControls.join(" | "), 80) : "none"}`,
  aPageHead.status === 200 && includesNorm(aHeadText, A.title) && includesNorm(aHeadText, "Add meeting")
);

const RUN_STAMP = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const MEETING_NOTES =
  "Minority Cell meeting held on 2026-11-02 to review the Merit-cum-Means renewal for 2026-27. " +
  "Present: Dr. Maaz Ahmed (head, Minority Cell) and Prof. Ayesha Anjum (member). " +
  "Decision: the cell will verify all 118 pending income certificates before the UGC deadline. " +
  "Decision: a nodal officer list will be circulated to every department. " +
  "Dr. Maaz Ahmed will submit the consolidated utilisation certificate to the UGC by 2026-11-20. " +
  "Prof. Ayesha Anjum will complete the attendance and academic-standing verification for all applicants by 2026-11-15. " +
  `(Recorded during acceptance run ${RUN_STAMP}.)`;

const SHORT_NOTES =
  "Minority Cell met on 2026-11-02. Dr. Maaz Ahmed will file the consolidated utilisation certificate with the UGC by 2026-11-20. " +
  "Prof. Ayesha Anjum will complete verification of all 118 income certificates by 2026-11-15. " +
  `(Acceptance run ${RUN_STAMP}.)`;

async function createMeetingOnA(notes) {
  let r = await http("head", `/api/circulars/${A.id}/meetings`, {
    method: "POST",
    body: { held_at: "2026-11-02T10:30:00.000Z", attendees: ["usr_maaz", "usr_member2"], notes },
  });
  if (r.status === 400 && /invalid attendees/.test(r.text)) {
    r = await http("head", `/api/circulars/${A.id}/meetings`, {
      method: "POST",
      body: { held_at: "2026-11-02T10:30:00.000Z", attendees: [], notes },
    });
  }
  return r;
}

const meetRes = await createMeetingOnA(MEETING_NOTES);
const meeting = meetRes.json?.meeting ?? null;
check(
  "head",
  "create a meeting on A with realistic notes (2 people, 2 dates)",
  "201 + meeting stored as held (notes present)",
  meetRes.status === 201
    ? `201; id=${meeting?.id?.slice(0, 8)}, status=${meeting?.status}, attendees=${(meeting?.attendees ?? []).length}, notes=${meeting?.notes?.length ?? 0} chars`
    : `HTTP ${meetRes.status} ${JSON.stringify(meetRes.json ?? meetRes.error)}`,
  meetRes.status === 201 && Boolean(meeting?.id)
);

const minutesStatuses = [];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
let minutesRes = { status: 0, json: null, calls: 0 };
let minutesMeeting = null;

/** What a cell head needs from a minutes payload: 2+ decisions, 2+ owned and dated actions.
 *  The response carries snake_case keys (owner_name / due_date) even though
 *  client/api.ts declares camelCase, so accept both shapes here. */
function minutesQuality(r) {
  const decisions = r?.json?.decisions ?? [];
  const proposed = r?.json?.proposedActions ?? [];
  const ownerOf = (p) => String(p?.ownerName ?? p?.owner_name ?? "").trim();
  const dueOf = (p) => String(p?.dueDate ?? p?.due_date ?? "");
  const owned = proposed.filter((p) => ownerOf(p).length > 0);
  const dated = proposed.filter((p) => ISO.test(dueOf(p)));
  return {
    decisions: decisions.length,
    proposed: proposed.length,
    owned: owned.length,
    dated: dated.length,
    ok: r?.status === 200 && decisions.length >= 2 && proposed.length >= 2 && owned.length >= 2 && dated.length >= 2,
    detail: proposed.map((p) => `${trunc(ownerOf(p) || "(empty)", 18)}@${dueOf(p) || "null"}`).join("; "),
  };
}

const qualityText = (q) =>
  `decisions=${q.decisions}, proposedActions=${q.proposed}, withOwnerName=${q.owned}, withIsoDate=${q.dated}`;

let q = { ok: false, decisions: 0, proposed: 0, owned: 0, dated: 0, detail: "" };

if (meeting) {
  minutesRes = await aiPost("head", `/api/meetings/${meeting.id}/minutes`, { notes: MEETING_NOTES });
  minutesStatuses.push(`long-notes:${minutesRes.status}${minutesRes.retried ? "(retried)" : ""}`);
  q = minutesQuality(minutesRes);
  check(
    "head",
    "generate minutes from those notes",
    "200 + >= 2 decisions AND >= 2 proposed actions with owner names and ISO due dates",
    minutesRes.status === 200
      ? `200; ${qualityText(q)} [${q.detail}]`
      : `HTTP ${minutesRes.status} ${JSON.stringify(minutesRes.json ?? minutesRes.error)}`,
    q.ok
  );
  if (minutesRes.status === 200) minutesMeeting = meeting;
}

/* Whether the model errored or answered too thinly, keep going: retry on shorter
   notes (up to 4 attempts) and continue the chain with whatever minutes we end
   up with, so tasks 6-7 are exercised for real either way. */
if (minutesRes.status === 200) {
  const first = minutesRes.json?.proposedActions?.[0] ?? null;
  const snake = Boolean(first && ("owner_name" in first || "due_date" in first));
  const camel = Boolean(first && ("ownerName" in first || "dueDate" in first));
  check(
    "head",
    "minutes response shape matches the client contract",
    "proposedActions entries expose ownerName / dueDate, as MinutesResult declares",
    first ? `first entry keys = ${Object.keys(first).join(",")}` : "no proposed actions to inspect",
    camel && !snake
  );
  if (snake && !camel) {
    defect(
      "LOW",
      "POST /minutes returns snake_case proposed actions while the client type declares camelCase",
      `The route returns validated.value.proposed_actions verbatim: {title, owner_name, due_date}. ` +
        `src/lib/client/api.ts declares MinutesResult.proposedActions as {title, ownerName, dueDate}[], and ` +
        `MeetingPanel discards the response body (it just calls router.refresh()), so nothing breaks today -- but any client ` +
        `that trusts the declared type reads undefined owner and due date for every proposed action.`,
      "src/app/api/meetings/[id]/minutes/route.ts (returns proposedActions: validated.value.proposed_actions) vs src/lib/client/api.ts MinutesResult"
    );
  }
}

if (!q.ok) {
  if (minutesRes.status !== 200) {
    defect(
      "HIGH",
      "Generate minutes is unreliable: 502 ai_failed on realistic notes, with no manual fallback",
      `POST /api/meetings/${meeting.id}/minutes with ${MEETING_NOTES.length} characters of realistic notes returned ` +
        `HTTP ${minutesRes.status} {error:"ai_failed"} after ${minutesRes.calls} client call(s); the retry ladder then produced ` +
        `${minutesStatuses.join(" | ")}. A side probe at the same notes returned 4 x 502 in a row, while POST /classify succeeded ` +
        `on every attempt in the same window, so the failure is specific to the minutes call and intermittent, not a dead ` +
        `provider. Signing requires minutes, so when this happens the head cannot reach actions at all, and there is no manual ` +
        `path: deriveFallbackMinutes() in src/lib/meetings/minutes.ts is never called and the panel cannot record decisions by hand. ` +
        `The browser shows the raw code "ai_failed" (client/api.ts surfaces data.error verbatim; MeetingPanel prints e.message).`,
      "src/app/api/meetings/[id]/minutes/route.ts (502 path) + src/lib/ai/client.ts (max_tokens 700 vs minutes_md 100-8000 chars) + src/lib/meetings/minutes.ts deriveFallbackMinutes (unused)"
    );
  } else if (q.proposed < 2) {
    defect(
      "MEDIUM",
      "Minutes extract fewer commitments than the notes contain",
      `Notes that name two people and two dates came back as ${q.proposed} proposed action(s) ` +
        `(${q.detail}) even though the prompt asks for one action per named commitment. The head signs what the model ` +
        `produced, so a real commitment silently never becomes a tracked action -- and nothing on the page says an action is missing.`,
      "src/lib/meetings/prompt.ts (buildPrompt) + src/lib/ai/client.ts (temperature 0, max_tokens 700)"
    );
  }

  let retryMeeting = minutesMeeting;
  if (!retryMeeting) {
    const shortMeetRes = await createMeetingOnA(SHORT_NOTES);
    retryMeeting = shortMeetRes.json?.meeting ?? null;
    check(
      "head",
      "create a second meeting with shorter notes (same two people, same two dates)",
      "201",
      shortMeetRes.status === 201
        ? `201; id=${retryMeeting?.id?.slice(0, 8)}`
        : `HTTP ${shortMeetRes.status} ${trunc(shortMeetRes.text, 60)}`,
      shortMeetRes.status === 201
    );
  }

  if (retryMeeting) {
    let best = minutesMeeting ? minutesRes : null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const r = await aiPost("head", `/api/meetings/${retryMeeting.id}/minutes`, { notes: SHORT_NOTES });
      minutesStatuses.push(`short-notes#${attempt}:${r.status}`);
      if (r.status === 200) {
        best = r;
        if (minutesQuality(r).ok) break;
      }
      await sleep(1_200);
    }
    const qb = minutesQuality(best);
    check(
      "head",
      "retry minutes on shorter notes (up to 4 attempts)",
      "eventually 200 + >= 2 decisions, >= 2 proposed actions with owners and ISO dates",
      `${minutesStatuses.join(" | ")}${best?.status === 200 ? ` => ${qualityText(qb)} [${qb.detail}]` : ""}`,
      qb.ok
    );
    if (best?.status === 200) {
      minutesMeeting = retryMeeting;
      minutesRes = best;
      q = qb;
    }
  }
}

if (!minutesMeeting) {
  for (const [action, expected] of [
    ["sign the minutes", "200 + actions created with owners and due dates"],
    ["actions on the circular after signing", "each signed action exists with owner + due date"],
    ["close one action as done", "200 + the open count drops"],
  ]) {
    check("head", action, expected, "BLOCKED: no minutes could be generated in any attempt (see defect 1)", false);
  }
} else {
  const aPageMin = await http("head", `/circulars/${A.id}`);
  const t = textOf(aPageMin.text);
  check(
    "head",
    "A page after minutes are generated",
    "decisions and 'not yet trackable' proposed actions visible on the page",
    `"Decisions" ${includesNorm(t, "Decisions") ? "present" : "ABSENT"}; ` +
      `"Proposed actions" ${includesNorm(t, "Proposed actions") ? "present" : "ABSENT"}; ` +
      `"Generate minutes" control ${labelsMatching(aPageMin.text, /generate minutes/i).length ? "present" : "absent"}; ` +
      `"Sign minutes" control ${labelsMatching(aPageMin.text, /sign minutes/i).length ? "present" : "absent"}`,
    includesNorm(t, "Decisions") && includesNorm(t, "Proposed actions")
  );

  /* Task 6: sign the minutes --------------------------------------------- */
  const signRes = await http("head", `/api/meetings/${minutesMeeting.id}/sign`, { method: "POST", body: {} });
  const signed = signRes.json?.actions ?? [];
  const withOwner = signed.filter((a) => a.ownerId);
  const withDue = signed.filter((a) => a.dueAt != null);
  check(
    "head",
    "sign the minutes",
    "200 + every proposed action becomes an action with an owner and a due date",
    signRes.status === 200
      ? `200; ${signed.length} actions, ${withOwner.length} with owner, ${withDue.length} with due date`
      : `HTTP ${signRes.status} ${JSON.stringify(signRes.json ?? signRes.error)}`,
    signRes.status === 200 && signed.length >= 2 && withOwner.length === signed.length && withDue.length === signed.length
  );

  const aDetail = await http("head", `/api/circulars/${A.id}`);
  const actionsNow = aDetail.json?.circular?.actions ?? [];
  const openNow = actionsNow.filter((a) => a.status === "open");
  const ownedNow = actionsNow.filter((a) => a.ownerId);
  const datedNow = actionsNow.filter((a) => a.dueAt != null);
  check(
    "head",
    "actions on the circular after signing",
    "each signed action exists on the circular with owner + due date",
    `${actionsNow.length} actions on the record; ${ownedNow.length} with owner; ${datedNow.length} with due date; ${openNow.length} open`,
    actionsNow.length >= 2 && ownedNow.length === actionsNow.length && datedNow.length === actionsNow.length
  );

  const aPageSigned = await http("head", `/circulars/${A.id}`);
  const signedText = textOf(aPageSigned.text);
  // Count on visible text: React SSR inserts <!-- --> between adjacent text
  // nodes, so "Owner: {name}" is not contiguous in the raw HTML.
  const ownerChips = (signedText.match(/Owner:\s*[A-Z]/g) ?? []).length;
  const noOwnerChips = (signedText.match(/No owner/g) ?? []).length;
  check(
    "head",
    "A page after signing",
    "actions listed with named owners, meeting marked Signed, no 'No owner' rows",
    `"Owner:" rows=${ownerChips}, "No owner" rows=${noOwnerChips}, "Signed" ${includesNorm(signedText, "Signed") ? "shown" : "ABSENT"}`,
    ownerChips >= 2 && noOwnerChips === 0 && includesNorm(signedText, "Signed")
  );

  /* Task 7: close one action as done -------------------------------------- */
  const target = signed.find((a) => a.status === "open") ?? openNow.find((a) => !a.meetingId || a.meetingId === minutesMeeting.id);
  if (target) {
    const closeRes = await http("head", `/api/actions/${target.id}`, { method: "PATCH", body: { status: "done" } });
    const afterDetail = await http("head", `/api/circulars/${A.id}`);
    const afterActions = afterDetail.json?.circular?.actions ?? [];
    const openAfter = afterActions.filter((a) => a.status === "open");
    check(
      "head",
      "close one action as done",
      `200 + open count drops from ${openNow.length} to ${openNow.length - 1}`,
      closeRes.status === 200
        ? `200; status=${closeRes.json?.action?.status}, completedAt=${closeRes.json?.action?.completedAt ? "set" : "null"}; open on the record now ${openAfter.length}`
        : `HTTP ${closeRes.status} ${JSON.stringify(closeRes.json ?? closeRes.error)}`,
      closeRes.status === 200 && openAfter.length === openNow.length - 1
    );

    const aPageClosed = await http("head", `/circulars/${A.id}`);
    const closedText = textOf(aPageClosed.text);
    const openPill = (/(\d+) open\b/.exec(closedText) ?? [])[0] ?? "none";
    check(
      "head",
      "A page after closing one action",
      `Actions card shows ${openAfter.length} open, and the closed row offers Reopen`,
      `pill="${openPill}", "Reopen" ${includesNorm(closedText, "Reopen") ? "present" : "ABSENT"}, ` +
        `"Mark done" buttons=${labelsMatching(aPageClosed.text, /mark done/i).length}`,
      includesNorm(closedText, `${openAfter.length} open`) && includesNorm(closedText, "Reopen")
    );
  } else {
    check("head", "close one action as done", "an open action to close", "no open action found", false);
  }
}

/* Task 8: a circular belonging to someone else's cell --------------------- */

const foreign = all.find(
  (c) => c.ref !== REF_A && c.ref !== REF_B && c.ref !== REF_POSH && c.cellId && c.cellId !== "cell_04" && !c.confidential
);

if (foreign) {
  const fPage = await http("head", `/circulars/${foreign.id}`);
  const fText = textOf(fPage.text);
  const fConfirmControls = labelsMatching(fPage.text, /confirm|correct/i);
  check(
    "head",
    `open ${foreign.ref} (${foreign.cellId}, another cell's circular)`,
    "readable (register is institution-wide for non-confidential records) but with no decide/advance controls",
    `HTTP ${fPage.status}, title ${includesNorm(fText, foreign.title) ? "visible" : "hidden"}, ` +
      `confirm/correct controls=${fConfirmControls.length ? trunc(fConfirmControls.join("|"), 40) : "none"}, ` +
      `"Advance to"=${labelsMatching(fPage.text, /advance to/i).length}`,
    fPage.status === 200 && fConfirmControls.length === 0 && labelsMatching(fPage.text, /advance to/i).length === 0
  );
  note(
    `Cell head on another cell's circular: he can OPEN ${foreign.ref} (${foreign.cellId}) and read the full body, minutes and actions, ` +
      `and the page still offers him "Suggest again" (an AI write). He gets no Confirm/Advance control there. See defect 3 on how wide read access is.`
  );

  const fTrans = await http("head", `/api/circulars/${foreign.id}/transition`, { method: "POST", body: { to: "verify" } });
  check("head", `advance ${foreign.ref} (not his cell)`, "403 Forbidden", `HTTP ${fTrans.status} ${trunc(fTrans.text, 50)}`, fTrans.status === 403);

  const fPatch = await http("head", `/api/circulars/${foreign.id}`, {
    method: "PATCH",
    body: { title: `${foreign.title} (QA)` },
  });
  check("head", `edit ${foreign.ref} (not his cell)`, "403 Forbidden", `HTTP ${fPatch.status} ${trunc(fPatch.text, 50)}`, fPatch.status === 403);

  /* Probe: confirm on a foreign circular with a body whose primaryCell is his own cell. */
  const foreignDetail = await http("head", `/api/circulars/${foreign.id}`);
  const foreignFinal = foreignDetail.json?.circular?.classification?.final ?? null;
  if (foreignFinal) {
    const hijackPayload = {
      ...foreignFinal,
      primaryCell: "cell_04",
      relatedCells: (foreignFinal.relatedCells ?? []).filter((c) => c !== "cell_04"),
    };
    const hijack = await http("head", `/api/circulars/${foreign.id}/confirm`, {
      method: "POST",
      body: { verdict: "corrected", classification: hijackPayload },
    });
    check(
      "head",
      `confirm a classification on ${foreign.ref} (not his cell)`,
      "403 Forbidden - the submitted primaryCell must not be what decides permission",
      hijack.status === 403
        ? "HTTP 403"
        : `HTTP ${hijack.status}: final classification on ${foreign.ref} is now primaryCell=` +
          `${hijack.json?.classification?.final?.primaryCell}, decidedBy=${hijack.json?.classification?.decidedBy}`,
      hijack.status === 403
    );
    if (hijack.status !== 403) {
      defect(
        "HIGH",
        "A cell head can overwrite the final classification of ANOTHER cell's circular",
        `POST /api/circulars/${foreign.id}/confirm with primaryCell="cell_04" returned HTTP ${hijack.status} and rewrote ` +
          `final.primaryCell from ${foreignFinal.primaryCell} to ${hijack.json?.classification?.final?.primaryCell}, ` +
          `decidedBy ${hijack.json?.classification?.decidedBy}. The check authorises against the classification in the request ` +
          `body, not the circular's own cell, and canReadCircular() lets any signed-in user read any non-confidential circular, so ` +
          `any cell head can rewrite the decision record of any circular in the institution - and the audit row is filed under ` +
          `the victim circular's cell.`,
        "src/app/api/circulars/[id]/confirm/route.ts -> canConfirmClassification(actor, parsed.value.primaryCell)"
      );
      const restore = await http("chair", `/api/circulars/${foreign.id}/confirm`, {
        method: "POST",
        body: { verdict: foreignDetail.json?.circular?.classification?.verdict ?? "confirmed", classification: foreignFinal },
      });
      note(`Restored ${foreign.ref} classification to primaryCell=${foreignFinal.primaryCell} through the API as the chair (restore HTTP ${restore.status}).`);
    }
  }
}

/* ================================================================ PRINCIPAL */

for (const [key, c] of [
  ["A", A],
  ["B", B],
]) {
  const p = await http("principal", `/circulars/${c.id}`);
  const t = textOf(p.text);
  check(
    "principal",
    `open circular ${key}`,
    "200 + content visible",
    `HTTP ${p.status}, title ${includesNorm(t, c.title) ? "visible" : "NOT visible"}, page text ${t.length} chars`,
    p.status === 200 && includesNorm(t, c.title)
  );
}

const pPageA = await http("principal", `/circulars/${A.id}`);
const pTextA = textOf(pPageA.text);
const writeRe = /confirm|advance to|generate minutes|sign minutes|add meeting|add action|mark done|reopen|correct|new circular|classify manually|record corrected/i;
const pWriteControls = labelsMatching(pPageA.text, writeRe);
check(
  "principal",
  "write affordances on circular A",
  "no Confirm / Advance to / Generate minutes / New circular control",
  pWriteControls.length ? `found ${trunc(pWriteControls.join(" | "), 90)}` : "none of the write controls rendered",
  pWriteControls.length === 0
);
check(
  "principal",
  "write affordance text on the page",
  'page does not offer "New circular" or "Advance to"',
  `"New circular" ${includesNorm(pTextA, "New circular") ? "PRESENT" : "absent"}; "Advance to" ${includesNorm(pTextA, "Advance to") ? "PRESENT" : "absent"}`,
  !includesNorm(pTextA, "New circular") && !includesNorm(pTextA, "Advance to")
);

const pList = await http("principal", "/circulars");
check(
  "principal",
  "circular register as a read-only role",
  'page says read-only and offers no "New circular" composer',
  `HTTP ${pList.status}; "Read-only view" ${includesNorm(textOf(pList.text), "Read-only view") ? "shown" : "ABSENT"}; ` +
    `"New circular" control ${labelsMatching(pList.text, /new circular/i).length ? "PRESENT" : "absent"}`,
  pList.status === 200 && includesNorm(textOf(pList.text), "Read-only view") && labelsMatching(pList.text, /new circular/i).length === 0
);

const pClass = await http("principal", `/api/circulars/${A.id}`);
const aFinal = pClass.json?.circular?.classification?.final ?? pClass.json?.circular?.classification?.suggestion;

const pConfirm = await http("principal", `/api/circulars/${A.id}/confirm`, {
  method: "POST",
  body: { verdict: "confirmed", classification: aFinal },
});
check("principal", "direct write: confirm a classification", "403 Forbidden", `HTTP ${pConfirm.status} ${trunc(pConfirm.text, 50)}`, pConfirm.status === 403);

const pTrans = await http("principal", `/api/circulars/${B.id}/transition`, { method: "POST", body: { to: "convene" } });
check("principal", "direct write: transition a circular", "403 Forbidden", `HTTP ${pTrans.status} ${trunc(pTrans.text, 50)}`, pTrans.status === 403);

const pCreate = await http("principal", "/api/circulars", {
  method: "POST",
  body: { title: "QA principal write attempt", body: "should be rejected", source: "qa" },
});
check("principal", "direct write: create a circular", "403 Forbidden", `HTTP ${pCreate.status} ${trunc(pCreate.text, 50)}`, pCreate.status === 403);

/* =============================================================== MEMBER A  */

const mA = await http("memberA", `/circulars/${A.id}`);
const mAText = textOf(mA.text);
const mAConfirmControls = labelsMatching(mA.text, /confirm|correct|classify manually/i);
check(
  "memberA",
  "open circular A (cell_04, not his cell, non-confidential)",
  "200 + readable, and NO Confirm control",
  `HTTP ${mA.status}, title ${includesNorm(mAText, A.title) ? "visible" : "hidden"}, ` +
    `confirm-ish controls=${mAConfirmControls.length ? trunc(mAConfirmControls.join("|"), 50) : "none"}`,
  mA.status === 200 && includesNorm(mAText, A.title) && mAConfirmControls.length === 0
);

const aFinalForMember = mA.json?.circular?.classification?.final ?? aFinal;
const mConfirm = await http("memberA", `/api/circulars/${A.id}/confirm`, {
  method: "POST",
  body: { verdict: "confirmed", classification: aFinalForMember },
});
check("memberA", "direct write: confirm a classification on A", "403 Forbidden", `HTTP ${mConfirm.status} ${trunc(mConfirm.text, 50)}`, mConfirm.status === 403);

const mPosh = await http("memberA", `/circulars/${POSH.id}`);
const mPoshText = textOf(mPosh.text);
check(
  "memberA",
  "open sealed POSH circular 0105",
  "404 Not Found (not 403) and no trace of the record",
  `HTTP ${mPosh.status}; title ${includesNorm(mPoshText, POSH.title) ? "LEAKED" : "not present"}; ` +
    `body snippet ${includesNorm(mPoshText, "confidential scheduling note") ? "LEAKED" : "not present"}`,
  mPosh.status === 404 && !includesNorm(mPoshText, POSH.title)
);

const mPoshApi = await http("memberA", `/api/circulars/${POSH.id}`);
check("memberA", "sealed POSH record via the API", "404 Not Found", `HTTP ${mPoshApi.status} ${trunc(mPoshApi.text, 50)}`, mPoshApi.status === 404);

const mCreate = await http("memberA", "/api/circulars", {
  method: "POST",
  body: {
    title: "SC/ST post-matric scholarship portal - closure notice",
    body: "Filed by an ordinary member during an acceptance test: a student reported that the SC/ST post-matric scholarship portal closes on 30 November.",
    source: `QA acceptance run ${RUN_STAMP}`,
    due_at: Date.parse("2026-11-30T12:00:00.000Z"),
    confidential: false,
  },
});
const created = mCreate.json?.circular ?? null;
check(
  "memberA",
  "create a circular of his own",
  "201 Created (members may create)",
  mCreate.status === 201
    ? `201; ref=${created?.ref}, state=${created?.state}, createdBy=${created?.createdBy}`
    : `HTTP ${mCreate.status} ${trunc(mCreate.text, 80)}`,
  mCreate.status === 201 && Boolean(created?.id)
);

if (created?.ref) {
  const seq = Number((/-(\d+)$/.exec(created.ref) ?? [])[1]);
  const seededSeq = Number((/-(\d+)$/.exec(REF_A) ?? [])[1]);
  check(
    "memberA",
    "reference numbering of a newly created circular",
    "a new ref that continues the institution's EOC-2026 series",
    `new ref ${created.ref}; the live series runs ${REF_A}..${REF_B} (new record is ${seq < seededSeq ? "BELOW" : "above"} it)`,
    !(Number.isFinite(seq) && seq < seededSeq)
  );
  if (Number.isFinite(seq) && seq < seededSeq) {
    defect(
      "MEDIUM",
      "New circular references are numbered from COUNT(*), so a fresh record gets a ref below the live series",
      `The member's new circular is ${created.ref} while the register already runs to ${REF_A}..${REF_B}. createCircular computes ` +
        `seq = COUNT(*) + 1 over refs LIKE 'EOC-2026-%' and pads to 4 digits, so arrival order is lost and the sequence collides ` +
        `(unique violation -> 500 after one retry) once the count reaches the seeded 0101+ range. Every citation, sort and ` +
        `"oldest first" view built on the ref is wrong today.`,
      "src/lib/circulars/repo.ts createCircular (COUNT(*) + 1 -> EOC-<year>-00nn)"
    );
  }
}

/* =============================================================== MEMBER B  */

const mB = await http("memberB", `/circulars/${A.id}`);
const mBText = textOf(mB.text);
const mBConfirm = labelsMatching(mB.text, /confirm|correct|classify manually/i);
check(
  "memberB",
  "open circular A (her own cell, cell_04)",
  "200 + visible, and still no Confirm control",
  `HTTP ${mB.status}, title ${includesNorm(mBText, A.title) ? "visible" : "hidden"}, ` +
    `confirm-ish controls=${mBConfirm.length ? trunc(mBConfirm.join("|"), 50) : "none"}`,
  mB.status === 200 && includesNorm(mBText, A.title) && mBConfirm.length === 0
);

const mBConfirmApi = await http("memberB", `/api/circulars/${A.id}/confirm`, {
  method: "POST",
  body: { verdict: "confirmed", classification: aFinalForMember },
});
check(
  "memberB",
  "direct write: confirm a classification on A",
  "403 Forbidden (members never confirm, even in their own cell)",
  `HTTP ${mBConfirmApi.status} ${trunc(mBConfirmApi.text, 50)}`,
  mBConfirmApi.status === 403
);

const mBPosh = await http("memberB", `/circulars/${POSH.id}`);
check(
  "memberB",
  "open sealed POSH circular 0105",
  "404 Not Found (it is cell_09)",
  `HTTP ${mBPosh.status}; title ${includesNorm(textOf(mBPosh.text), POSH.title) ? "LEAKED" : "not present"}`,
  mBPosh.status === 404 && !includesNorm(textOf(mBPosh.text), POSH.title)
);

const mBCells = await http("memberB", "/cells");
const cellCards = (mBCells.text.match(/data-testid="cell-card"/g) ?? []).length;
const cellsText = textOf(mBCells.text);
check(
  "memberB",
  "open /cells",
  "scoped to her own cell only (1 card, Minority Cell, no other cells)",
  `HTTP ${mBCells.status}, ${cellCards} cell card(s); "Minority Cell" ${includesNorm(cellsText, "Minority Cell") ? "present" : "ABSENT"}; ` +
    `"SC/ST Cell" ${includesNorm(cellsText, "SC/ST Cell") ? "PRESENT (leak)" : "absent"}`,
  mBCells.status === 200 && cellCards === 1 && includesNorm(cellsText, "Minority Cell") && !includesNorm(cellsText, "SC/ST Cell")
);

const mBCommand = await http("memberB", "/command");
const mBCommandText = textOf(mBCommand.text);
const otherCellTitles = all
  .filter((c) => !c.confidential && c.cellId && c.cellId !== "cell_04")
  .filter((c) => includesNorm(mBCommandText, c.title));
check(
  "memberB",
  "open /command (dashboard)",
  "greets her and stays inside her own cell",
  `HTTP ${mBCommand.status}; greeting ${includesNorm(mBCommandText, "Ayesha") ? "her name" : "NOT her name"}; ` +
    `other cells' circulars on the page=${otherCellTitles.length}`,
  mBCommand.status === 200 && includesNorm(mBCommandText, "Ayesha") && otherCellTitles.length === 0
);

const mBList = await http("memberB", "/circulars");
const mBListText = textOf(mBList.text);
const foreignOnRegister = all
  .filter((c) => !c.confidential && c.cellId && c.cellId !== "cell_04")
  .filter((c) => includesNorm(mBListText, c.title));
const poshOnRegister = includesNorm(mBListText, POSH.title);
check(
  "memberB",
  "open /circulars (register)",
  "consistent with /cells and /command: her cell's records",
  `HTTP ${mBList.status}; ${foreignOnRegister.length} other-cell circulars listed on her register ` +
    `(${trunc(foreignOnRegister.map((c) => c.ref).join(", "), 55)}); sealed POSH ${poshOnRegister ? "PRESENT (leak)" : "absent"}`,
  foreignOnRegister.length === 0
);

if (foreignOnRegister.length > 0) {
  note(
    `MEMBER-VIEW INCONSISTENCY: /cells and /command are scoped to cell_04, but /circulars and /workflow list every non-confidential ` +
      `circular in the institution - ${foreignOnRegister.length} other-cell records appear on her register ` +
      `(${foreignOnRegister.map((c) => c.ref).join(", ")}). Same person, same session, two different definitions of "her work".`
  );
  defect(
    "MEDIUM",
    "A member's register is institution-wide while her dashboard and cells page are scoped to her cell",
    `Signed in as member2 (cell_04), /cells renders 1 card and /command shows no other-cell circular, but /circulars lists ` +
      `${foreignOnRegister.length} circulars owned by other cells: ${foreignOnRegister.map((c) => `${c.ref} (${c.cellId})`).join(", ")}. ` +
      `listCirculars() and canReadCircular() have no cell filter at all for non-confidential records, so "visibility is by cell ` +
      `membership" (AGENTS.md) is only true for the two screens that hand-roll their own scope.`,
    "src/lib/circulars/repo.ts listCirculars + src/lib/core/permissions.ts canReadCircular (no cell membership test for non-confidential)"
  );
}
if (poshOnRegister) {
  defect("CRITICAL", "The sealed POSH record appears on an ordinary member's register", "/circulars rendered the sealed 0105 title for a cell_04 member.", "src/lib/circulars/repo.ts listCirculars");
}

/* ================================================================= output = */

const W = { p: 19, a: 46, e: 44, o: 62 };
const line = "-".repeat(W.p + W.a + W.e + W.o + 20);

log(line);
log(`${"PERSONA".padEnd(W.p)} | ${"ACTION".padEnd(W.a)} | ${"EXPECTED".padEnd(W.e)} | ${"OBSERVED".padEnd(W.o)} | RESULT`);
log(line);
for (const r of results) {
  log(
    `${trunc(r.persona, W.p).padEnd(W.p)} | ${trunc(r.action, W.a).padEnd(W.a)} | ${trunc(r.expected, W.e).padEnd(W.e)} | ${trunc(
      r.observed,
      W.o
    ).padEnd(W.o)} | ${r.pass ? "PASS" : "FAIL"}`
  );
}
log(line);

const fails = results.filter((r) => !r.pass);
log("");
log(`ASSERTIONS: ${results.length} total, ${results.length - fails.length} pass, ${fails.length} fail`);
if (fails.length) {
  log("");
  log("FAILED ASSERTIONS");
  for (const f of fails) {
    log(`  - [${f.persona}] ${f.action}`);
    log(`      expected: ${ascii(f.expected)}`);
    log(`      observed: ${ascii(f.observed)}`);
  }
}

log("");
log("OBSERVATIONS");
if (observations.length === 0) log("  (none)");
for (const o of observations) log(`  - ${ascii(o)}`);

log("");
log("DEFECTS (ranked)");
if (defects.length === 0) log("  none found");
const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
defects
  .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
  .forEach((d, i) => {
    log("");
    log(`${i + 1}. [${d.severity}] ${ascii(d.title)}`);
    log(`   evidence: ${ascii(d.evidence)}`);
    log(`   where:    ${ascii(d.where)}`);
  });

log("");
log(`Finished ${new Date().toISOString()}`);
process.exitCode = fails.length > 0 ? 1 : 0;
