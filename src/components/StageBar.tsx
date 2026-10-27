"use client";

/**
 * Stage timeline for a circular plus the single legal "advance" control.
 * All nine stages are always shown; the current one is marked, past ones get
 * a check, future ones are muted. Advance calls /transition and refreshes.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  nextState,
  STATES,
  STATE_LABEL,
  type CircularState,
} from "@/lib/contracts";
import { ApiError, api } from "@/lib/client/api";
import { Icon } from "./ui";

export interface StageBarProps {
  circularId: string;
  state: CircularState;
  /** Pre-computed server-side with permissions.canAdvance. */
  canAdvance: boolean;
  /** Why the next move is gated (missing final classification / report), if it is. */
  gate?: string | null;
}

export default function StageBar({ circularId, state, canAdvance, gate }: StageBarProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Includes the two gated edges (intake→route, report→done). Using NEXT_STATE
  // directly made both stages render no control at all.
  const next = nextState(state);
  const currentIdx = STATES.indexOf(state);

  async function advance() {
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      await api.transition(circularId, next);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Couldn't move the circular forward — try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pad" style={{ display: "grid", gap: "var(--sp-12)" }}>
      {error ? (
        <span className="form-error" role="alert">
          {error}
        </span>
      ) : null}
      <div style={{ display: "flex", gap: "var(--sp-12)", flexWrap: "wrap", alignItems: "center" }}>
        <ol
          className="stages"
          style={{ listStyle: "none", display: "flex", flexWrap: "wrap", gap: 6, margin: 0, padding: 0 }}
          aria-label="Lifecycle stages"
        >
          {STATES.map((s, i) => {
            const done = i < currentIdx;
            const current = s === state;
            return (
              <li
                key={s}
                aria-current={current ? "step" : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "var(--fs-sm)",
                  padding: "3px 10px",
                  borderRadius: "var(--r-pill)",
                  fontWeight: current ? 700 : 600,
                  whiteSpace: "nowrap",
                  background: current
                    ? "var(--accent-soft)"
                    : done
                      ? "var(--ok-soft)"
                      : "var(--hair)",
                  color: current
                    ? "var(--accent)"
                    : done
                      ? "var(--ok)"
                      : "var(--muted)",
                  border: current ? "1px solid var(--accent)" : "1px solid transparent",
                }}
              >
                {done ? <Icon name="check" size={12} /> : <span aria-hidden="true">{i + 1}</span>}
                {STATE_LABEL[s]}
              </li>
            );
          })}
        </ol>
        {canAdvance && next ? (
          <>
            {gate ? (
              <span
                className="pill amber"
                title={gate}
                style={{ fontSize: "var(--fs-sm)" }}
              >
                {gate}
              </span>
            ) : null}
            <button
              type="button"
              className="btn sm primary"
              onClick={() => void advance()}
              disabled={busy || gate != null}
              title={gate ?? undefined}
              style={{ marginLeft: "auto" }}
            >
              {busy ? "Moving…" : `Advance to ${STATE_LABEL[next]}`}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
