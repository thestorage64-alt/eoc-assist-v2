import { CELL_SPEC, SDG_NAMES, type Circular } from "@/lib/contracts";

function cellLines(): string {
  return CELL_SPEC.map((c) => `${c.id} — ${c.name}`).join("\n");
}

function sdgLines(): string {
  return Object.entries(SDG_NAMES)
    .map(([n, name]) => `${n} — ${name}`)
    .join("\n");
}

export function buildPrompt(
  titleOrCircular?: string | { title?: string; body?: string } | Circular | null,
  bodyArg?: string
): string {
  let title = "";
  let body = "";
  if (typeof titleOrCircular === "string") {
    title = titleOrCircular;
    body = bodyArg ?? "";
  } else if (titleOrCircular && typeof titleOrCircular === "object") {
    title = (titleOrCircular as any).title ?? "";
    body = (titleOrCircular as any).body ?? "";
  }

  const example1 = JSON.stringify({
    primaryCell: "cell_10",
    relatedCells: ["cell_07"],
    primarySdg: 4,
    relatedSdgs: [10],
    reason:
      "The circular concerns a scholarship scheme for students, routed to the National Service Scheme Cell for student welfare coordination.",
    confidence: "high",
    tags: ["scholarship", "students"],
  });

  const example2 = JSON.stringify({
    primaryCell: "cell_03",
    relatedCells: ["cell_08"],
    primarySdg: 5,
    relatedSdgs: [10],
    reason:
      "The circular addresses women's safety and gender sensitization on campus, routed to the Women's Cell.",
    confidence: "medium",
    tags: ["women", "safety"],
  });

  const parts: string[] = [];
  parts.push(
    "You are an expert classifier for an educational institution's Equal Opportunity Cell."
  );
  parts.push(
    "Classify the given circular into exactly one primary cell, related cells, one primary SDG, related SDGs, a reason, a confidence level, and tags."
  );
  parts.push(
    "Return ONLY a single JSON object with EXACTLY these keys and no others: primaryCell, relatedCells, primarySdg, relatedSdgs, reason, confidence, tags. No prose, no markdown fences."
  );
  parts.push("");
  parts.push("Allowed cells (id — name):");
  parts.push(cellLines());
  parts.push("");
  parts.push("Allowed SDGs (number — name):");
  parts.push(sdgLines());
  parts.push("");
  parts.push("Constraints:");
  parts.push("- primaryCell must be one of the cell ids above.");
  parts.push("- relatedCells must be a subset of cell ids, no duplicates, and must not include primaryCell.");
  parts.push("- primarySdg must be an integer 1-17.");
  parts.push("- relatedSdgs must be integers 1-17, no duplicates, and must not include primarySdg.");
  parts.push("- confidence must be one of: high, medium, low.");
  parts.push("- reason must be 20-600 characters.");
  parts.push("- tags must be an array of at most 8 strings, each at most 32 characters.");
  parts.push("");
  parts.push("Few-shot examples:");
  parts.push(example1);
  parts.push(example2);
  parts.push("");

  if (title || body) {
    parts.push("Circular to classify:");
    parts.push(`Title: ${title}`);
    if (body) parts.push(`Body: ${body}`);
    parts.push("");
    parts.push("Respond with the JSON object only.");
  } else {
    parts.push("Respond with the JSON object only.");
  }

  return parts.join("\n");
}