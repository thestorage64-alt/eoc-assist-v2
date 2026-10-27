"use client";

/**
 * Application shell: navy rail (desktop drawer off-canvas on mobile),
 * topbar with breadcrumb + user + sign out, and <main id="main">.
 * Accessibility: skip link first in DOM, aria-current on the active nav
 * item, Escape/backdrop/focus-trap for the mobile drawer.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon, initials } from "./ui";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Shown but not yet navigable (screen under construction in a later pass). */
  soon?: boolean;
}

export interface ShellUser {
  name: string;
  designation: string;
  email: string;
  role: string;
}

const ROLE_LABEL: Record<string, string> = {
  principal: "Principal",
  chair: "Chairperson, EOC",
  head: "Cell head",
  member: "Cell member",
};

export default function Shell({
  user,
  nav,
  children,
}: {
  user: ShellUser;
  nav: NavItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const railId = useId().replace(/\W/g, "");
  const railRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes + focus trap inside the rail while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const rail = railRef.current;
    const toggle = toggleRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

    // Move focus into the rail immediately.
    const first = rail?.querySelector<HTMLElement>(selector);
    first?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (e.key === "Tab" && rail) {
        const list = Array.from(rail.querySelectorAll<HTMLElement>(selector));
        if (list.length === 0) return;
        const firstEl = list[0];
        const lastEl = list[list.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(href + "/");
  }

  const crumb =
    nav.find((n) => isActive(n.href))?.label ??
    (pathname.startsWith("/circulars/") ? "Circulars" : "Workspace");

  return (
    <>
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <div className="app">
        <div
          ref={railRef}
          id={`rail-${railId}`}
          className={open ? "rail open" : "rail"}
        >
          <div className="brand">
            <div className="crest" aria-hidden="true">EOC</div>
            <div>
              <b>EOC Assist</b>
              <span>HKBK · Bengaluru</span>
            </div>
            <button
              type="button"
              className="btn ghost icon-only rail-close"
              style={{ marginLeft: "auto", color: "#c9d5ea" }}
              aria-label="Close navigation menu"
              onClick={() => setOpen(false)}
            >
              <Icon name="x" />
            </button>
          </div>

          <nav className="nav" aria-label="Main navigation">
            <span className="nav-lbl" aria-hidden="true">Workspace</span>
            {nav.map((item) =>
              item.soon ? (
                <div
                  key={item.href}
                  className="navlink nav-soonlink"
                  aria-disabled="true"
                  title="This screen is coming in the next release"
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                  <span className="nav-soon">Soon</span>
                </div>
              ) : (
                <Link
                  key={item.href}
                  className="navlink"
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                </Link>
              )
            )}
          </nav>

          <div className="rail-user">
            <span className="avatar" aria-hidden="true">
              {initials(user.name)}
            </span>
            <div>
              <b>{user.name}</b>
              <span>{ROLE_LABEL[user.role] ?? user.designation}</span>
            </div>
          </div>
        </div>

        <div className="main-col">
          <header className="top">
            <button
              ref={toggleRef}
              type="button"
              className="btn ghost icon-only menu-btn"
              aria-expanded={open}
              aria-controls={`rail-${railId}`}
              aria-label={open ? "Close navigation menu" : "Open navigation menu"}
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name="menu" />
            </button>
            <p className="crumb">
              Workspace / <b>{crumb}</b>
            </p>
            <div className="top-user">
              <div className="who">
                <b>{user.name}</b>
                <span>{user.designation || user.email}</span>
              </div>
              <button type="button" className="btn sm" onClick={signOut}>
                <Icon name="logout" size={15} />
                Sign out
              </button>
            </div>
          </header>

          <main id="main" className="content">
            {children}
          </main>
        </div>
      </div>

      {open ? (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
