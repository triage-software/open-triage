"use client";

import { useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import type { Conversation } from "@/lib/types";
import { useDemo } from "./demo-context";

export function AiClassificationPanel({ conversation: c }: { conversation: Conversation }) {
  const { state, refresh, openSettings, ai } = useDemo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const job = c.aiTriage;
  const pending = job?.status === "pending" && state.aiSettings.configured;

  async function classify() {
    if (busy || pending) return;
    setBusy(true); setError("");
    try {
      await ai.classify(c.id);
      await refresh();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="ai-suggestion ai-classification" aria-label="Klasyfikacja AI" aria-busy={busy || pending}>
    <div className="ai-heading">
      <span className="ai-icon" aria-hidden="true"><Sparkles size={15} /></span>
      <strong>Kategoria i priorytet</strong>
      <span className="ai-demo-label">Automatycznie</span>
      {!state.aiSettings.configured
        ? <button className="button ai-use" onClick={openSettings}>Skonfiguruj OpenRouter</button>
        : <button className="button ai-use" disabled={busy || pending} onClick={() => void classify()}>
          {(busy || pending) && <LoaderCircle size={13} className="ai-spinning" aria-hidden="true" />}
          {busy || pending ? "Klasyfikowanie…" : job?.status === "applied" ? "Przypisz ponownie AI" : "Przypisz kategorię i priorytet"}
        </button>}
    </div>
    <div className="ai-reply-content">
      <div className="ai-triage" role="status"><span>{c.category} · {c.priority}</span>
        <span>{!state.aiSettings.configured ? "Automatyczna klasyfikacja wymaga klucza OpenRouter."
          : pending ? "Oczekuje na wynik AI."
          : job?.status === "applied" ? "Przypisane przez AI"
          : job?.status === "manual" ? "Ustawione ręcznie"
          : job?.status === "error" ? "Klasyfikacja zostanie ponowiona automatycznie."
          : "Nowe maile są klasyfikowane automatycznie."}</span>
      </div>
      {job?.status === "applied" && job.result?.reason && <p className="ai-reason">{job.result.reason}</p>}
      {(error || job?.error) && <p className="settings-error" role="alert">{error || job?.error}</p>}
    </div>
  </section>;
}
