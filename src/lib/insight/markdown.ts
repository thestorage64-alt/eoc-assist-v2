import type { CircularDetail } from "@/lib/contracts";

function fmtDate(ms: number | null | undefined): string {
  if (ms == null) return "Not specified";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "Not specified";
  return d.toISOString().slice(0, 10);
}

function ownerName(ownerId: string | null, ownerNames: any, index?: number): string {
  if (ownerId == null) return "Not specified";
  if (ownerNames instanceof Map) {
    const v = ownerNames.get(ownerId);
    if (v != null) return String(v);
  }
  if (Array.isArray(ownerNames)) {
    for (const item of ownerNames) {
      if (item && typeof item === "object" && (item as any).id === ownerId && (item as any).name != null) {
        return String((item as any).name);
      }
    }
    if (typeof ownerNames[index ?? -1] === "string") {
      return String(ownerNames[index as number]);
    }
  }
  if (ownerNames && typeof ownerNames === "object") {
    if (Object.prototype.hasOwnProperty.call(ownerNames, ownerId)) {
      const v = (ownerNames as any)[ownerId];
      if (v != null) return String(v);
    }
  }
  if (typeof ownerNames === "function") {
    try {
      const v = (ownerNames as any)(ownerId);
      if (v != null) return String(v);
    } catch {
      // ignore
    }
  }
  return String(ownerId);
}

function classificationBlock(c: CircularDetail["classification"]): string {
  const f = c.final;
  if (!f) return "Not specified";
  const lines: string[] = [];
  lines.push(`- Primary cell: ${f.primaryCell}`);
  lines.push(`- Related cells: ${f.relatedCells.length ? f.relatedCells.join(", ") : "Not specified"}`);
  lines.push(`- Primary SDG: ${f.primarySdg}`);
  lines.push(`- Related SDGs: ${f.relatedSdgs.length ? f.relatedSdgs.join(", ") : "Not specified"}`);
  lines.push(`- Confidence: ${f.confidence}`);
  lines.push(`- Reason: ${f.reason || "Not specified"}`);
  lines.push(`- Tags: ${f.tags.length ? f.tags.join(", ") : "Not specified"}`);
  if (c.verdict) lines.push(`- Verdict: ${c.verdict}`);
  if (c.decidedBy) lines.push(`- Decided by: ${c.decidedBy}`);
  if (c.decidedAt) lines.push(`- Decided at: ${fmtDate(c.decidedAt)}`);
  return lines.join("\n");
}

export function circularToMarkdown(detail: CircularDetail, cellName?: string, ownerNames?: any): string {
  const cell = cellName ? cellName : "Not specified";
  const parts: string[] = [];
  parts.push(`# ${detail.title}`);
  parts.push("");
  parts.push(`**Ref:** ${detail.ref}`);
  parts.push(`**Source:** ${detail.source || "Not specified"}`);
  parts.push(`**Received:** ${fmtDate(detail.receivedAt)}`);
  parts.push(`**Due:** ${fmtDate(detail.dueAt)}`);
  parts.push(`**State:** ${detail.state || "Not specified"}`);
  parts.push(`**Cell:** ${cell}`);
  parts.push(`**Confidential:** ${detail.confidential ? "Yes" : "No"}`);
  parts.push(`**Assigned to:** ${detail.assignedTo ? ownerName(detail.assignedTo, ownerNames) : "Not specified"}`);
  parts.push(`**Created by:** ${detail.createdBy || "Not specified"}`);
  parts.push("");

  parts.push("## Body");
  parts.push("");
  parts.push(detail.body && detail.body.trim() ? detail.body : "Not specified");
  parts.push("");

  parts.push("## Classification");
  parts.push("");
  parts.push(classificationBlock(detail.classification));
  parts.push("");

  // Meetings
  parts.push("## Meetings");
  parts.push("");
  if (!detail.meetings || detail.meetings.length === 0) {
    parts.push("Not specified");
  } else {
    for (const m of detail.meetings) {
      parts.push(`### Meeting held ${fmtDate(m.heldAt)}`);
      parts.push(`- Status: ${m.status || "Not specified"}`);
      parts.push(`- Attendees: ${m.attendees && m.attendees.length ? m.attendees.join(", ") : "Not specified"}`);
      parts.push(`- Notes: ${m.notes && m.notes.trim() ? m.notes : "Not specified"}`);
      parts.push(`- Decisions: ${m.decisions && m.decisions.length ? m.decisions.map((d) => `- ${d}`).join("\n") : "Not specified"}`);
      parts.push(`- Minutes: ${m.minutesMd && m.minutesMd.trim() ? m.minutesMd : "Not specified"}`);
      parts.push(`- Signed by: ${m.signedBy || "Not specified"}`);
      parts.push(`- Signed at: ${fmtDate(m.signedAt)}`);
      parts.push("");
    }
  }
  parts.push("");

  // Actions
  parts.push("## Actions");
  parts.push("");
  if (!detail.actions || detail.actions.length === 0) {
    parts.push("Not specified");
  } else {
    parts.push("| # | Title | Owner | Due | Status |");
    parts.push("|---|---|---|---|---|");
    detail.actions.forEach((a, i) => {
      const o = ownerName(a.ownerId, ownerNames, i);
      parts.push(`| ${i + 1} | ${a.title} | ${o} | ${fmtDate(a.dueAt)} | ${a.status} |`);
    });
  }
  parts.push("");

  // Documents
  parts.push("## Documents");
  parts.push("");
  if (!detail.documents || detail.documents.length === 0) {
    parts.push("Not specified");
  } else {
    for (const d of detail.documents) {
      parts.push(`- ${d.kind} v${d.version} — ${d.contentMd ? "available" : "Not specified"}`);
    }
  }
  parts.push("");

  return parts.join("\n");
}

export const toMarkdown = circularToMarkdown;
export default circularToMarkdown;
