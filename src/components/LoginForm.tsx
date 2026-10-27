"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (!res.ok) {
        // The API returns a single generic message: never reveal which part failed.
        setError("Invalid email or password");
        setBusy(false);
        document.getElementById("eoc-email")?.focus();
        return;
      }
      router.push("/command");
      router.refresh();
    } catch {
      setError("Network problem — check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div id="eoc-form-note" className="eyebrow" style={{ marginBottom: "var(--sp-4)" }}>
        Equal Opportunity Cell
      </div>
      {error ? (
        <div className="field">
          <span className="form-error" role="alert" id="eoc-form-error">
            {error}
          </span>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="eoc-email">Email address</label>
        <input
          id="eoc-email"
          className="input"
          type="email"
          name="email"
          autoComplete="user-id email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby={error ? "eoc-form-error" : undefined}
          placeholder="name@hkbk.edu.in"
        />
      </div>

      <div className="field">
        <label htmlFor="eoc-password">Password</label>
        <input
          id="eoc-password"
          className="input"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button className="btn primary" type="submit" disabled={busy || !email || !password} style={{ width: "100%", justifyContent: "center" }}>
        {busy ? (
          "Signing in…"
        ) : (
          <>
            <Icon name="logout" size={15} />
            Sign in
          </>
        )}
      </button>
    </form>
  );
}
