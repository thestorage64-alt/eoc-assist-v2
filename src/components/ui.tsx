/**
 * Presentational primitives. Server-safe (no client hooks).
 * All styling comes from classes in globals.css.
 */
import type { ReactNode } from "react";
import { STATE_LABEL, type CircularState } from "@/lib/contracts";

/* ------------------------------------------------------------------ Page */

export function Page({
  title,
  eyebrow,
  sub,
  actions,
}: {
  title: string;
  eyebrow?: string;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="strap">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Card */

export function Card({
  title,
  header,
  aside,
  children,
  className,
  as: Tag = "section",
  testid,
}: {
  title?: string;
  header?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
  testid?: string;
}) {
  return (
    <Tag className={className ? `card ${className}` : "card"} data-testid={testid}>
      {title || header ? (
        <div className="pad" style={{ paddingBottom: 0, display: "block" }}>
          <div className="sect">
            <h2>{header ?? title}</h2>
            {aside ? <div className="actions" style={{ margin: 0 }}>{aside}</div> : null}
          </div>
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ Pill */

export function Pill({
  tone = "grey",
  children,
  title,
}: {
  tone?: "blue" | "green" | "amber" | "red" | "grey" | "gold";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`pill ${tone}`} title={title}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Empty */

export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <b>{title}</b>
      {hint ? <p>{hint}</p> : null}
      {action ? <div className="actions">{action}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------- Skeleton */

export function Skeleton({ h = 16, w = "100%" }: { h?: number | string; w?: number | string }) {
  return <span className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}

/* ----------------------------------------------------------------- Button */

export function Button({
  children,
  variant = "default",
  size,
  href,
  ariaLabel,
  disabled,
  type = "button",
  onClick,
  className,
}: {
  children: ReactNode;
  variant?: "default" | "primary" | "gold" | "ghost" | "danger";
  size?: "sm";
  href?: string;
  ariaLabel?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  className?: string;
}) {
  const cls = [
    "btn",
    variant === "primary" ? "primary" : variant === "gold" ? "gold" : variant === "ghost" ? "ghost" : variant === "danger" ? "danger" : "",
    size === "sm" ? "sm" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  if (href) {
    return (
      <a className={cls} href={href} aria-label={ariaLabel}>
        {children}
      </a>
    );
  }
  return (
    <button className={cls} type={type} aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Icons */

const ICONS: Record<string, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13h4l2 3h4l2-3h4" />
      <path d="M5 5h14l2 8v6H3v-6z" />
    </>
  ),
  flow: (
    <>
      <rect x="3" y="4" width="6" height="6" rx="1.5" />
      <rect x="15" y="14" width="6" height="6" rx="1.5" />
      <path d="M9 7h6a3 3 0 0 1 3 3v4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.7" />
      <path d="M18 14a5 5 0 0 1 3 4.6" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  doc: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
      <path d="M10 12h6M10 16h6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="M4 12l5 5 11-11" />,
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  logout: (
    <>
      <path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2" />
      <path d="M9 12h11M17 9l3 3-3 3" />
    </>
  ),
};

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS | string; size?: number }) {
  const body = ICONS[name as string];
  if (!body) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", flex: "0 0 auto", display: "block" }}
    >
      {body}
    </svg>
  );
}

/* ------------------------------------------------------------ formatting */

const DAY_FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const FULL_FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function fmtDate(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return FULL_FMT.format(new Date(ms));
}

export function fmtDay(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return DAY_FMT.format(new Date(ms));
}

export function fmtDue(ms: number | null | undefined): { label: string; tone: "red" | "amber" | "blue" | "grey" | "green" } {
  if (ms == null || !Number.isFinite(ms)) {
    return { label: "No due date", tone: "grey" };
  }
  const days = Math.round((ms - Date.now()) / 86_400_000);
  if (days < 0) return { label: `Overdue ${-days}d`, tone: "red" };
  if (days === 0) return { label: "Due today", tone: "red" };
  if (days <= 2) return { label: `Due in ${days}d`, tone: "amber" };
  return { label: `Due in ${days}d`, tone: "blue" };
}

export function StatePill({ state }: { state: CircularState }) {
  const tone: Record<CircularState, "blue" | "green" | "amber" | "red" | "grey" | "gold"> = {
    intake: "amber",
    route: "blue",
    convene: "blue",
    pre_meeting: "blue",
    meeting: "gold",
    implement: "blue",
    verify: "amber",
    report: "blue",
    done: "green",
  };
  return <Pill tone={tone[state]}>{STATE_LABEL[state]}</Pill>;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
