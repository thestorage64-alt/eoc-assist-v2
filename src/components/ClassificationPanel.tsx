"use client";

/**
 * Classification panel for a circular.
 *
 * The rule it enforces visually: an AI suggestion is ALWAYS labelled as a
 * suggestion ("machine — not final") and a human decision as a human decision,
 * including who decided and when. Suggest calls /classify; Confirm/Correct call
 * /confirm and never appear for actors without the permission (the panel takes
 * booleans computed server-side from the frozen permissions module).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CELL_SPEC, SDG_NAMES, type Classification } from "@/lib/contracts";
import { ApiError, api } from "@/lib/client/api";
import { Icon, Pill, fmtDate } from "./ui";

export interface ClassificationPanelProps {
  circularId: string;
  suggestion: Classification | null;
  final: Classification | null;
  verdict: "confirmed" | "corrected" | null;
  /** Display name for whoever took the human decision, resolved server-side. */
  decidedByName: string | null;
  decidedAt: number | null;
  canSuggest: boolean;
  canConfirm: boolean;
}

const CONF_TONE = { high: "green", medium: "amber", low: "red" } as const;
const CONF_TEXT: Record<Classification["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

function cellLabel(id: string): string {
  const c = CELL_SPEC.find((x) => x.id === id);
  return c ? `${c.number}. ${c.name}` : id;
}

function sdgLabel(n: number): string {
  return `SDG ${n} · ${SDG_NAMES[n] ?? "Unknown"}`;
}

function SuggestionView({
  c,
  lockedHint,
}: {
  c: Classification;
  lockedHint?: string;
}) {
  return (
    <div className="inset" style={{ display: "grid", gap: "var(--sp-8)" }}>
      <div className="sect">
        <b style={{ fontSize: "var(--fs-sm)" }}>
          <Icon name="spark" size={14} /> AI suggestion — not final
        </b>
        <Pill tone={CONF_TONE[c.confidence]}>{CONF_TEXT[c.confidence]}</Pill>
      </div>
      {lockedHint ? <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>{lockedHint}</p> : null}
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>
        Nothing here takes effect until a human confirms or corrects it.
      </p>
      <dl style={{ margin: 0, display: "grid", gap: 6, fontSize: "var(--fs-sm)" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <dt style={{ color: "var(--muted)", fontWeight: 600, minWidth: 92 }}>Primary cell</dt>
          <dd style={{ margin: 0 }}>{cellLabel(c.primaryCell)}</dd>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <dt style={{ color: "var(--muted)", fontWeight: 600, minWidth: 92 }}>Related cells</dt>
          <dd style={{ margin: 0 }}>
            {c.relatedCells.length > 0 ? cellLabel(c.relatedCells[0]) : null}
            {c.relatedCells.length > 1 ? ", " + c.relatedCells.slice(1).map(cellLabel).join(", ") : null}
            {c.relatedCells.length === 0 ? <em>None</em> : null}
          </dd>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <dt style={{ color: "var(--muted)", fontWeight: 600, minWidth: 92 }}>Primary SDG</dt>
          <dd style={{ margin: 0 }}>{sdgLabel(c.primarySdg)}</dd>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <dt style={{ color: "var(--muted)", fontWeight: 600, minWidth: 92 }}>Related SDGs</dt>
          <dd style={{ margin: 0 }}>
            {c.relatedSdgs.length > 0 ? c.relatedSdgs.map(sdgLabel).join(", ") : <em>None</em>}
          </dd>
        </div>
      </dl>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>{c.reason}</p>
      {c.tags.length > 0 ? (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {c.tags.map((t) => (
            <span key={t} className="pill grey">
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DecisionView({
  verdict,
  by,
  at,
}: {
  verdict: "confirmed" | "corrected";
  by: string | null;
  at: number | null;
}) {
  return (
    <div className="inset" style={{ borderColor: "var(--ok)", display: "grid", gap: "var(--sp-8)" }}>
      <div className="sect">
        <b style={{ fontSize: "var(--fs-sm)" }}>
          <Icon name="check" size={14} /> Human decision — final
        </b>
        <Pill tone={verdict === "confirmed" ? "green" : "amber"}>
          {verdict === "confirmed" ? "Confirmed" : "Corrected"}
        </Pill>
      </div>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>
        Decided by <b style={{ color: "var(--text)" }}>{by ?? "an unknown user"}</b>
        {at != null ? <> · {fmtDate(at)}</> : null}.
      </p>
    </div>
  );
}

function DraftFrom(c: Classification | null): Classification | null {
  return c;
}

export default function ClassificationPanel({
  circularId,
  suggestion,
  final,
  verdict,
  decidedByName,
  decidedAt,
  canSuggest,
  canConfirm,
}: ClassificationPanelProps) {
  const router = useRouter();
  const [sug, setSug] = useState<Classification | null>(suggestion);
  const [busy, setBusy] = useState<"suggest" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiBlocked, setAiBlocked] = useState(false);
  const [editing, setEditing] = useState(false);

  // Manual-correction draft, seeded from whichever classification exists.
  const [primaryCell, setPrimaryCell] = useState("");
  const [primarySdg, setPrimarySdg] = useState("4");
  const [relatedCells, setRelatedCells] = useState<string[]>([]);
  const [relatedSdgs, setRelatedSdgs] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const [confidence, setConfidence] = useState<Classification["confidence"]>("medium");

  function seedDraft(c: Classification) {
    setPrimaryCell(c.primaryCell);
    setPrimarySdg(String(c.primarySdg));
    setRelatedCells(c.relatedCells);
    setRelatedSdgs(c.relatedSdgs);
    setReason(c.reason);
    setConfidence(c.confidence);
  }

  useEffect(() => {
    if (editing && !primaryCell) {
      const seed = sug ?? final ?? suggestion;
      if (seed) seedDraft(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  async function suggest() {
    setBusy("suggest");
    setError(null);
    setNotice(null);
    try {
      const res = await api.classify(circularId);
      setSug(res.suggestion);
      setNotice("A fresh AI suggestion is in — review it before deciding.");
      setAiBlocked(false);
      router.refresh();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code === "ai_not_configured") {
        setAiBlocked(true);
        setError("The AI annotator is not configured. Classify this circular manually below.");
        setEditing(true);
        router.refresh();
      } else {
        setError(err?.message ?? "Couldn't get a suggestion — try again.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function recordDecision(kind: "confirmed" | "corrected", value: Classification) {
    setBusy("confirm");
    setError(null);
    setNotice(null);
    try {
      await api.confirm(circularId, kind, value);
      setEditing(false);
      setNotice(
        kind === "confirmed"
          ? "Decision recorded — the AI suggestion was confirmed as final."
          : "Decision recorded — your correction is now the final classification."
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't record the decision — try again.");
    } finally {
      setBusy(null);
    }
  }

  const deciding = busy === "confirm";
  const reasonTrim = reason.trim();
  const canSubmitDraft =
    primaryCell !== "" &&
    reasonTrim.length >= 20 &&
    reasonTrim.length <= 600 &&
    !relatedCells.includes(primaryCell);

  const waitingCopy =
    canConfirm && sug != null
      ? "Confirm the suggestion as-is, or correct it — the human call is what counts."
      : canConfirm
        ? sug == null
          ? "No suggestion yet. Ask the annotator, or classify manually."
          : "No decision yet."
        : "Waiting for a chairperson or the cell head to take the decision.";

  return (
    <div className="pad" style={{ display: "grid", gap: "var(--sp-12)" }}>
      {error ? (
        <span className="form-error" role="alert">
          {error}
        </span>
      ) : null}
      {notice ? (
        <span role="status" style={{ color: "var(--ok)", fontWeight: 600, fontSize: "var(--fs-sm)" }}>
          {notice}
        </span>
      ) : null}

      {/* --- machine suggestion, always labelled --- */}
      {sug != null ? (
        <SuggestionView
          c={sug}
          lockedHint={verdict != null ? "Kept for the record — the human decision below is final." : undefined}
        />
      ) : null}

      {/* --- human decision, always labelled --- */}
      {verdict != null && final != null ? (
        <DecisionView verdict={verdict} by={decidedByName} at={decidedAt} />
      ) : final == null ? (
        <div className="inset">
          <p>
            <b>No human decision yet.</b> {waitingCopy}
          </p>
        </div>
      ) : null}

      {/* --- manual / correction form --- */}
      {editing && canConfirm ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmitDraft || busy != null) return;
            void recordDecision("corrected", {
              primaryCell,
              relatedCells: relatedCells.filter((c) => c !== primaryCell),
              primarySdg: Number(primarySdg),
              relatedSdgs: relatedSdgs.filter((s) => s !== Number(primarySdg)),
              reason: reasonTrim,
              confidence,
              tags: (sug?.tags ?? final?.tags ?? []).slice(0, 8),
            });
          }}
          style={{ display: "grid", gap: "var(--sp-12)" }}
          aria-label="Classify this circular manually"
        >
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="cls-primary-cell">Primary cell — required</label>
            <select
              id="cls-primary-cell"
              className="select"
              value={primaryCell}
              onChange={(e) => setPrimaryCell(e.target.value)}
              required
            >
              <option value="" disabled>
                Choose a cell…
              </option>
              {CELL_SPEC.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.number}. {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="cls-primary-sdg">Primary SDG — required</label>
            <select
              id="cls-primary-sdg"
              className="select"
              value={primarySdg}
              onChange={(e) => setPrimarySdg(e.target.value)}
            >
              {Object.keys(SDG_NAMES).map((n) => (
                <option key={n} value={n}>
                  {sdgLabel(Number(n))}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ margin: 0 }}>
            <span id="cls-related-cells-lbl" style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>
              Related cells
            </span>
            <select
              multiple
              size={4}
              aria-labelledby="cls-related-cells-lbl"
              className="select"
              value={relatedCells}
              onChange={(e) => setRelatedCells(Array.from(e.target.selectedOptions).map((o) => o.value))}
            >
              {CELL_SPEC.filter((c) => c.id !== primaryCell).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.number}. {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ margin: 0 }}>
            <span id="cls-related-sdgs-lbl" style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>
              Related SDGs
            </span>
            <select
              multiple
              size={4}
              aria-labelledby="cls-related-sdgs-lbl"
              className="select"
              value={relatedSdgs.map(String)}
              onChange={(e) =>
                setRelatedSdgs(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))
              }
            >
              {Object.keys(SDG_NAMES)
                .filter((n) => Number(n) !== Number(primarySdg))
                .map((n) => (
                  <option key={n} value={n}>
                    {sdgLabel(Number(n))}
                  </option>
                ))}
            </select>
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="cls-reason">Reason — 20 to 600 characters</label>
            <textarea
              id="cls-reason"
              className="textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              required
              minLength={20}
              maxLength={600}
              placeholder="Why does this circular land with this cell? Minimum 20 characters."
            />
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="cls-confidence">Confidence</label>
            <select
              id="cls-confidence"
              className="select"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value as Classification["confidence"])}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: "var(--sp-12)", justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={() => setEditing(false)} disabled={deciding}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={deciding || !canSubmitDraft}>
              {deciding ? "Recording…" : "Record corrected decision"}
            </button>
          </div>
        </form>
      ) : null}

      {/* --- action row --- */}
      {!editing || !canConfirm ? (
        <div style={{ display: "flex", gap: "var(--sp-12)", flexWrap: "wrap" }}>
          {canSuggest ? (
            <button type="button" className="btn sm" onClick={() => void suggest()} disabled={busy !== null}>
              <Icon name="spark" size={14} />
              {busy === "suggest"
                ? "Thinking…"
                : sug != null
                  ? "Suggest again"
                  : "Suggest a classification"}
            </button>
          ) : null}
          {canConfirm && sug != null ? (
            <button
              type="button"
              className="btn primary sm"
              onClick={() => void recordDecision("confirmed", sug as Classification)}
              disabled={busy !== null}
            >
              {deciding ? "Recording…" : "Confirm suggestion"}
            </button>
          ) : null}
          {canConfirm ? (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                const seed = sug ?? final ?? DraftFrom(sug);
                if (seed) seedDraft(seed);
                setEditing(true);
              }}
              disabled={busy !== null}
            >
              {sug != null ? "Correct…" : "Classify manually"}
            </button>
          ) : null}
        </div>
      ) : null}

      {!canSuggest && !canConfirm && sug == null && final == null ? (
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>
          This circular has not been classified yet — the chairperson routes it from here.
        </p>
      ) : null}
    </div>
  );
}
