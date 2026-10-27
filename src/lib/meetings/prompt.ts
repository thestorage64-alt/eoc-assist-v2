export function buildPrompt(notes?: string): string {
  const parts: string[] = [];
  parts.push("You are an expert note-taker for an Equal Opportunity Cell meeting.");
  parts.push("Convert the provided meeting notes into structured minutes as a single JSON object.");
  parts.push("Return ONLY a single JSON object with EXACTLY these keys and no others: minutes_md, decisions, proposed_actions. No prose, no markdown fences.");
  parts.push("");
  parts.push("Schema:");
  parts.push('- minutes_md: string, 100-8000 characters, concise markdown minutes of the meeting.');
  parts.push('- decisions: array of 1 to 12 strings, each a decision agreed in the meeting.');
  parts.push('- proposed_actions: array of 0 to 12 objects, each with keys title, owner_name, due_date.');
  parts.push("  - title: string, 5-160 characters.");
  parts.push("  - owner_name: string, free text name of the owner (resolved later).");
  parts.push("  - due_date: string in YYYY-MM-DD format, or null.");
  parts.push("");
  parts.push("Example (copy the exact key names; do NOT use the keys person or action):");
  parts.push('{"minutes_md":"## Minutes\\n- Discussed ...","decisions":["Decision one"],"proposed_actions":[{"title":"Prepare report","owner_name":"Dr. Maaz Ahmed","due_date":"2026-10-28"}]}');
  parts.push("");
  parts.push("Constraints:");
  parts.push("- minutes_md must be 100-8000 characters, concise.");
  parts.push("- Keep the entire JSON compact and valid.");
  parts.push("- decisions must have 1-12 entries.");
  parts.push("- proposed_actions must have 0-12 entries.");
  parts.push("- Each action title must be 5-160 characters.");
  parts.push("- due_date must be a valid ISO date (YYYY-MM-DD) or null.");
  parts.push("- Unknown keys are not allowed.");
  parts.push("- Use the keys title, owner_name, due_date for each proposed action. Do not use the keys person or action.");
  parts.push("- Extract EVERY commitment in the notes that names a person and a date as one proposed action.");
  parts.push("- One proposed action per commitment; if three people committed to three things, return three actions.");
  parts.push("- owner_name must be the person's name exactly as written in the notes.");
  parts.push("- due_date must be parsed from the text when present, otherwise null.");
  parts.push("");
  if (notes && notes.trim()) {
    parts.push("Meeting notes:");
    parts.push(notes.trim());
    parts.push("");
  }
  parts.push("Respond with the JSON object only.");
  return parts.join("\n");
}

export function buildMinutesPrompt(notes?: string): string {
  return buildPrompt(notes);
}
