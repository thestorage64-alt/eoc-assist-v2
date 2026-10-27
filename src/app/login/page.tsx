import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { actorFromSession } from "../(app)/actor";
import LoginForm from "@/components/LoginForm";
import { Icon } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  // Already signed in? Straight to the workspace.
  const actor = await actorFromSession();
  if (actor) redirect("/command");

  return (
    <div className="login-page">
      <a className="skip" href="#main">
        Skip to main content
      </a>

      <section className="login-hero" aria-label="About EOC Assist">
        <div className="crest-title">
          <div className="crest" aria-hidden="true">EOC</div>
          <div>
            <b style={{ display: "block", color: "#fff", fontWeight: 600 }}>EOC Assist</b>
            <span style={{ color: "var(--rail-muted)" }}>HKBK · Bengaluru</span>
          </div>
        </div>
        <h1>Every circular routed, decided and evidenced — in one workspace.</h1>
        <p className="mutable">
          The Equal Opportunity Cell&apos;s intake, routing, meetings and action tracking
          with a permanent audit trail. AI helps with classification; a human
          confirms every decision.
        </p>
        <p className="mutable" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="shield" size={15} />
          Access is tied to your role at the institution.
        </p>
      </section>

      <div className="login-panel">
        <main id="main">
          <div className="card pad">
            <h1 style={{ marginBottom: "var(--sp-12)" }}>Sign in</h1>
            <p className="sub" style={{ marginBottom: "var(--sp-16)" }}>
              Use your college email address.
            </p>
            <LoginForm />
          </div>
        </main>
      </div>
    </div>
  );
}
