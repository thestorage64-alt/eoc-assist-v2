"use client";

/**
 * "+ New circular" composer. Client-only interaction; creates the record
 * through POST /api/circulars and refreshes the server-rendered list.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";

export interface ComposerCell {
  id: string;
  number: number;
  name: string;
}

export default function NewCircular({ cells }: { cells: ComposerCell[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [cellId, setCellId] = useState("");
  const [confidential, setConfidential] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * Read a PDF, Word file, text file or photo of the circular and put the text in
   * the box. Nothing is saved until the person reads it and presses Create.
   */
  async function onFile(file: File | null) {
    if (!file) return;
    setFileBusy(true);
    setFileError(null);
    setFileNote(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFileError(data?.error ?? "Couldn't read that file.");
        return;
      }
      setBody(data.text ?? "");
      if (!title.trim() && data.text) {
        const firstLine = String(data.text)
          .split(/\r?\n/)
          .map((l: string) => l.trim())
          .find((l: string) => l.length > 8);
        if (firstLine) setTitle(firstLine.slice(0, 120));
      }
      const where =
        data.method === "pdf"
          ? `PDF, ${data.pages ?? "?"} page(s)`
          : data.method === "docx"
            ? "Word document"
            : data.method === "vision"
              ? "photo, read by the vision model"
              : "text file";
      setFileNote(`Read ${data.chars?.toLocaleString?.() ?? data.chars} characters from ${file.name} (${where}). Check it before saving.`);
    } catch {
      setFileError("Network problem while uploading — try again.");
    } finally {
      setFileBusy(false);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || title.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const dueAt = due ? new Date(`${due}T12:00:00`).getTime() : null;
      const res = await fetch("/api/circulars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          source: source.trim(),
          due_at: Number.isFinite(dueAt) ? dueAt : null,
          cell_id: cellId || null,
          confidential,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Couldn't create the circular — try again.");
        setBusy(false);
        return;
      }
      setOpen(false);
      setBusy(false);
      setTitle("");
      setSource("");
      setBody("");
      setDue("");
      setCellId("");
      setConfidential(false);
      router.refresh();
    } catch {
      setError("Network problem — check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>
        <Icon name="plus" size={15} />
        New circular
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="drawer-backdrop"
            aria-label="Close the new circular composer"
            onClick={() => (busy ? undefined : setOpen(false))}
          />
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nc-title"
          >
            <div className="card">
              <div className="pad" style={{ borderBottom: "1px solid var(--line)" }}>
                <div className="sect">
                  <h2 id="nc-title">New circular</h2>
                  <button
                    type="button"
                    className="btn ghost icon-only"
                    aria-label="Close composer"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                  >
                    <Icon name="x" />
                  </button>
                </div>
              </div>
              <form className="pad" onSubmit={submit}>
                {error ? (
                  <span className="form-error" role="alert" style={{ marginBottom: "var(--sp-12)" }}>
                    {error}
                  </span>
                ) : null}

                <div className="field">
                  <label htmlFor="nc-title-input">Title — required</label>
                  <input
                    ref={titleRef}
                    id="nc-title-input"
                    className="input"
                    required
                    minLength={3}
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Merit-cum-Means scholarship renewal, 2026–27"
                  />
                </div>

                <div className="field">
                  <label htmlFor="nc-source">Source</label>
                  <input
                    id="nc-source"
                    className="input"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="e.g. UGC circular F.1-12/2026"
                  />
                </div>

                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="nc-due">Due date</label>
                    <input
                      id="nc-due"
                      className="input"
                      type="date"
                      value={due}
                      onChange={(e) => setDue(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="nc-cell">Primary cell</label>
                    <select
                      id="nc-cell"
                      className="select"
                      value={cellId}
                      onChange={(e) => setCellId(e.target.value)}
                    >
                      <option value="">Not yet routed (intake)</option>
                      {cells.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.number}. {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="nc-file">Or upload the circular</label>
                  <input
                    id="nc-file"
                    className="input"
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.markdown"
                    disabled={fileBusy || busy}
                    onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
                  />
                  <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", margin: "var(--sp-8) 0 0" }}>
                    PDF, Word or plain text. The text is read into the box below for you to check.
                  </p>
                  {fileBusy ? (
                    <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", margin: "var(--sp-8) 0 0" }} role="status">
                      Reading the file…
                    </p>
                  ) : null}
                  {fileNote ? (
                    <p style={{ fontSize: "var(--fs-sm)", color: "var(--ok)", margin: "var(--sp-8) 0 0" }} role="status">
                      {fileNote}
                    </p>
                  ) : null}
                  {fileError ? (
                    <span className="form-error" role="alert" style={{ marginTop: "var(--sp-8)" }}>
                      {fileError}
                    </span>
                  ) : null}
                </div>

                <div className="field">
                  <label htmlFor="nc-body">Circular text or summary</label>
                  <textarea
                    id="nc-body"
                    className="textarea"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Paste the circular text here so it can be classified."
                  />
                </div>

                <div className="checkline" style={{ marginBottom: "var(--sp-16)" }}>
                  <input
                    id="nc-confidential"
                    type="checkbox"
                    checked={confidential}
                    onChange={(e) => setConfidential(e.target.checked)}
                  />
                  <label htmlFor="nc-confidential">Confidential</label>
                </div>

                <div style={{ display: "flex", gap: "var(--sp-12)", justifyContent: "flex-end" }}>
                  <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
                    Cancel
                  </button>
                  <button type="submit" className="btn primary" disabled={busy || title.trim().length < 3}>
                    {busy ? "Creating…" : "Create circular"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
