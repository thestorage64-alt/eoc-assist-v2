#!/usr/bin/env node
/**
 * Demo data for the pitch.
 *
 * Replaces the synthetic test records with a believable working week at HKBK:
 * ten real-shaped circulars spread across the lifecycle, one sealed POSH record,
 * confirmed classifications, a meeting with signed minutes and dated actions,
 * and one completed report.
 *
 *   node scripts/seed-demo.mjs            # add missing demo records
 *   node scripts/seed-demo.mjs --reset    # clear case data first, then seed
 *
 * Destructive only for case data (circulars and their children). Users, cells
 * and memberships are never touched.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL ?? "postgres://postgres:eoc@localhost:55433/eoc";
const reset = process.argv.includes("--reset");
const DAY = 86_400_000;
const now = Date.now();
const at = (days) => now + days * DAY;

const local = /(^|@)(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = new pg.Client({
  connectionString: url,
  ssl: local ? undefined : { rejectUnauthorized: false },
});
await client.connect();

if (reset) {
  await client.query(
    "DELETE FROM audit_events; DELETE FROM documents; DELETE FROM actions; DELETE FROM meetings; DELETE FROM classifications; DELETE FROM circulars;",
  );
  console.log("[demo] case data cleared");
}

const users = Object.fromEntries(
  (await client.query("SELECT id, email, name FROM users")).rows.map((u) => [u.email, u]),
);
const pick = (email) => users[email]?.id ?? null;

const CIRCULARS = [
  {
    ref: "EOC-2026-0101",
    title: "Merit-cum-Means Scholarship renewal 2026-27",
    source: "University Grants Commission · F.1-12/2026 (EO)",
    state: "route",
    cell: "cell_04",
    owner: "maaz@hkbk.edu.in",
    due: at(18),
    received: at(-2),
    body:
      "All Principals of affiliated institutions are informed that the renewal of Merit-cum-Means " +
      "scholarships for students belonging to minority communities for the academic year 2026-27 " +
      "shall be completed before 15 November 2026. Institutions must verify income certificates, " +
      "attendance and academic standing, and nominate a nodal officer from the Minority Cell. A " +
      "consolidated utilisation certificate and a summary of outreach conducted during the year " +
      "must also be submitted to this office.",
    classification: {
      primaryCell: "cell_04",
      relatedCells: ["cell_13"],
      primarySdg: 4,
      relatedSdgs: [10],
      reason:
        "The circular names minority-community students and requires a nodal officer from the Minority Cell. Verification of academic standing also involves Remedial Coaching.",
      confidence: "high",
      tags: ["scholarship", "minority", "renewal", "deadline"],
    },
    final: true,
  },
  {
    ref: "EOC-2026-0102",
    title: "AICTE accessibility audit — institutional reply",
    source: "AICTE · Accessibility Audit 2026",
    state: "implement",
    cell: "cell_05",
    owner: "naresh@hkbk.edu.in",
    due: at(-1),
    received: at(-9),
    body:
      "Institutions are required to submit the accessibility audit response covering ramps, " +
      "lifts, accessible washrooms, signage and examination accommodations. The reply must " +
      "include photographs, a remediation timeline and the name of the nodal officer for the " +
      "Differently Abled Cell.",
    classification: {
      primaryCell: "cell_05",
      relatedCells: [],
      primarySdg: 10,
      relatedSdgs: [4],
      reason:
        "The audit is explicitly about physical and examination accessibility, which is the Differently Abled Cell's mandate.",
      confidence: "high",
      tags: ["accessibility", "audit", "compliance"],
    },
    final: true,
  },
  {
    ref: "EOC-2026-0103",
    title: "She Innovate — call for entries",
    source: "Women's Cell · Internal",
    state: "meeting",
    cell: "cell_03",
    owner: "chair@hkbk.edu.in",
    due: at(5),
    received: at(-6),
    body:
      "The Women's Cell invites project abstracts from all departments for She Innovate 2026. " +
      "Teams of up to three students may submit. Abstracts close on 5 November; shortlisted " +
      "teams present on 18 November. A POSH refresher is mandatory for all student volunteers.",
    classification: {
      primaryCell: "cell_03",
      relatedCells: ["cell_09", "cell_14"],
      primarySdg: 5,
      relatedSdgs: [4, 8],
      reason:
        "An innovation programme run by the Women's Cell, with a mandatory POSH briefing for volunteers.",
      confidence: "high",
      tags: ["women", "innovation", "abstracts"],
    },
    final: true,
    meeting: {
      daysAgo: 2,
      notes:
        "Meeting held to plan She Innovate. Present: the Chairperson and Dr. Suraiya Tarannum. " +
        "Decision: abstract deadline extended to 5 November. Dr. Suraiya Tarannum will notify all " +
        "departments by 28 October. Nusrath-ul-Reshma will confirm certificate printing by 8 November. " +
        "The Chairperson will schedule a POSH refresher by 10 November.",
      minutes:
        "**She Innovate — planning meeting**\n\n**Present:** Chairperson, Dr. Suraiya Tarannum\n\n" +
        "**Decisions**\n- Abstract deadline extended to 5 November\n- Certificates confirmed for all valid submissions\n\n" +
        "**Actions**\n- Notify departments of the deadline\n- Confirm certificate printing\n- Schedule the POSH refresher",
      decisions: [
        "Abstract deadline extended to 5 November",
        "Certificates confirmed for all valid submissions",
      ],
      actions: [
        { title: "Notify all departments of the 5 November deadline", owner: "chair@hkbk.edu.in", due: at(1) },
        { title: "Confirm certificate printing with the vendor", owner: "chair@hkbk.edu.in", due: at(12) },
        { title: "Schedule the POSH refresher for student volunteers", owner: "chair@hkbk.edu.in", due: at(14) },
        { title: "Collect the remaining 26 abstracts", owner: "member@hkbk.edu.in", due: at(5) },
      ],
    },
  },
  {
    ref: "EOC-2026-0104",
    title: "Anti-Ragging Week — report and compliance note",
    source: "UGC · Anti-Ragging Regulations",
    state: "verify",
    cell: "cell_10",
    owner: "arshad@hkbk.edu.in",
    due: at(3),
    received: at(-12),
    body:
      "The institution must report activities conducted during Anti-Ragging Week, including the " +
      "pledge, poster presentation, open mic and role play, with attendance and photographs.",
    classification: {
      primaryCell: "cell_10",
      relatedCells: ["cell_07"],
      primarySdg: 16,
      relatedSdgs: [3],
      reason: "Anti-ragging awareness and student welfare activities sit with NSS and Counselling.",
      confidence: "medium",
      tags: ["anti-ragging", "awareness", "report"],
    },
    final: true,
  },
  {
    ref: "EOC-2026-0105",
    title: "POSH workshop — confidential scheduling note",
    source: "Internal · sealed",
    state: "pre_meeting",
    cell: "cell_09",
    owner: "chair@hkbk.edu.in",
    due: at(9),
    received: at(-3),
    body:
      "A confidential scheduling note for the POSH awareness workshop. Attendee names and the " +
      "case discussion are restricted to the POSH Cell and the Principal.",
    classification: {
      primaryCell: "cell_09",
      relatedCells: [],
      primarySdg: 5,
      relatedSdgs: [16],
      reason: "Sealed POSH matter; visible only to the POSH Cell, the Chair and the Principal.",
      confidence: "high",
      tags: ["posh", "confidential"],
    },
    final: true,
    confidential: true,
  },
  {
    ref: "EOC-2026-0106",
    title: "Constitution Day 2026 — reading of the Preamble",
    source: "Human Studies Cell · Internal",
    state: "convene",
    cell: "cell_11",
    owner: "chair@hkbk.edu.in",
    due: at(22),
    received: at(-4),
    body:
      "A campus-wide reading of the Preamble followed by a quiz on constitutional values. All " +
      "departments nominate two student representatives.",
    classification: {
      primaryCell: "cell_11",
      relatedCells: ["cell_12"],
      primarySdg: 16,
      relatedSdgs: [4],
      reason: "Constitutional values and civic education are the Human Studies Cell's core mandate.",
      confidence: "high",
      tags: ["constitution", "civic", "values"],
    },
    final: true,
  },
  {
    ref: "EOC-2026-0107",
    title: "Remedial coaching — attendance and outcomes",
    source: "Remedial Coaching Cell · Internal",
    state: "implement",
    cell: "cell_13",
    owner: "umme@hkbk.edu.in",
    due: at(7),
    received: at(-7),
    body:
      "Monthly attendance and outcome review for remedial coaching across first and second year " +
      "students, including the pass rate after the supplementary examination.",
    classification: {
      primaryCell: "cell_13",
      relatedCells: [],
      primarySdg: 4,
      relatedSdgs: [10],
      reason: "Remedial coaching outcomes are reported by the Remedial Coaching Cell.",
      confidence: "medium",
      tags: ["remedial", "attendance", "outcomes"],
    },
    final: true,
  },
  {
    ref: "EOC-2026-0108",
    title: "International students orientation — final report",
    source: "International Students Cell · Internal",
    state: "done",
    cell: "cell_06",
    owner: "sumaiya@hkbk.edu.in",
    due: at(-10),
    received: at(-30),
    body:
      "Orientation for the incoming international cohort, covering visa compliance, hostel " +
      "allocation, language support and cultural integration.",
    classification: {
      primaryCell: "cell_06",
      relatedCells: ["cell_07"],
      primarySdg: 4,
      relatedSdgs: [10, 17],
      reason: "The activity is run by the International Students Cell for the incoming cohort.",
      confidence: "high",
      tags: ["international", "orientation", "report"],
    },
    final: true,
    report: true,
  },
  {
    ref: "EOC-2026-0109",
    title: "Blood donation camp — NSS coordination",
    source: "NSS Cell · Internal",
    state: "route",
    cell: "cell_10",
    owner: "arshad@hkbk.edu.in",
    due: at(12),
    received: at(-1),
    body:
      "The NSS Cell will coordinate a blood donation camp with the district hospital. Target: " +
      "150 units. Requires volunteer rosters and a certificate list.",
    classification: {
      primaryCell: "cell_10",
      relatedCells: [],
      primarySdg: 3,
      relatedSdgs: [17],
      reason: "Community health camps are NSS activities.",
      confidence: "medium",
      tags: ["blood donation", "nss", "health"],
    },
    final: true,
  },
  {
    ref: "EOC-2026-0110",
    title: "Gender audit workshop — planning brief",
    source: "Gender Sensitization Cell · Internal",
    state: "intake",
    cell: null,
    owner: null,
    due: at(20),
    received: at(0),
    body:
      "A planning brief for the annual gender audit workshop, including the external facilitator, " +
      "departmental participation and a follow-up report to the Principal.",
    classification: {
      primaryCell: "cell_08",
      relatedCells: ["cell_03"],
      primarySdg: 5,
      relatedSdgs: [4],
      reason: "A gender audit workshop is the Gender Sensitization Cell's activity.",
      confidence: "high",
      tags: ["gender", "audit", "workshop"],
    },
    final: false,
  },
];

console.log(`[demo] seeding ${CIRCULARS.length} circulars`);
let inserted = 0;

for (const c of CIRCULARS) {
  const id = randomUUID();
  const createdAt = at(-Math.round((now - c.received) / DAY));
  const owner = c.owner ? pick(c.owner) : null;
  const creator = pick("chair@hkbk.edu.in");

  const exists = await client.query("SELECT 1 FROM circulars WHERE ref = $1", [c.ref]);
  if (exists.rowCount) continue;

  await client.query(
    `INSERT INTO circulars (id, ref, title, body, source, received_at, due_at, state, cell_id,
       assigned_to, created_by, confidential, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, c.ref, c.title, c.body ?? "", c.source ?? "", c.received, c.due, c.state, c.cell,
      owner, creator, Boolean(c.confidential), createdAt, createdAt],
  );

  const classification = c.final
    ? {
        suggestion: c.classification,
        final: c.classification,
        verdict: "confirmed",
        decided_by: pick("chair@hkbk.edu.in"),
        decided_at: createdAt + 3600_000,
      }
    : { suggestion: c.classification, final: null, verdict: null, decided_by: null, decided_at: null };

  await client.query(
    `INSERT INTO classifications (circular_id, suggestion, final, verdict, decided_by, decided_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, JSON.stringify(classification.suggestion),
      classification.final ? JSON.stringify(classification.final) : null,
      classification.verdict, classification.decided_by, classification.decided_at],
  );

  if (c.meeting) {
    const meetingId = randomUUID();
    const heldAt = at(-c.meeting.daysAgo);
    await client.query(
      `INSERT INTO meetings (id, circular_id, held_at, attendees, notes, status, minutes_md,
         decisions, proposed_actions, signed_by, signed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,'signed',$6,$7,$8,$9,$10,$11)`,
      [meetingId, id, heldAt, JSON.stringify([]), c.meeting.notes, c.meeting.minutes,
        JSON.stringify(c.meeting.decisions), JSON.stringify([]),
        pick("chair@hkbk.edu.in"), heldAt + 3600_000, heldAt],
    );
    for (const a of c.meeting.actions) {
      await client.query(
        `INSERT INTO actions (id, circular_id, meeting_id, title, owner_id, due_at, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'open',$7)`,
        [randomUUID(), id, meetingId, a.title, pick(a.owner), a.due, heldAt + 3600_000],
      );
    }
  }

  if (c.report) {
    await client.query(
      `INSERT INTO documents (id, circular_id, kind, version, content_md, created_by, approved_by, approved_at, created_at)
       VALUES ($1,$2,'final_report',1,$3,$4,$5,$6,$7)`,
      [randomUUID(), id, `# ${c.title}\n\nOrientation completed. 42 students attended across the week.\n`,
        creator, pick("principal@hkbk.edu.in"), at(-9), at(-10)],
    );
  }

  inserted++;
}

console.log(`[demo] inserted ${inserted} circulars (skipped ${CIRCULARS.length - inserted} existing)`);
await client.end();
