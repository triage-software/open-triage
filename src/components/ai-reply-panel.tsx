"use client";

import { useState } from "react";
import { ArrowRight, BookOpen, ChevronDown, LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";
import type { Conversation } from "@/lib/types";
import { knowledgeStamp, type AiSuggestion } from "@/lib/ai-types";
import { readApiResponse } from "@/lib/api-response";
import { useDemo } from "./demo-context";

export function AiReplyPanel({ conversation: c, onUse }: { conversation: Conversation; onUse: (text: string) => void }) {
  const { state, user, act, refresh, toast, openKnowledge, openSettings } = useDemo();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const suggestion = c.aiSuggestion;
  const stale = !!suggestion && (suggestion.publicRevision !== c.publicRevision ||
    suggestion.settingsVersion !== state.aiSettings.version || suggestion.knowledgeStamp !== knowledgeStamp(state.knowledge, c.mailboxId));

  async function generate(force = false) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/ai/suggestion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: c.id, generation: state.generation, userId: user.id, force }),
      });
      const result = await readApiResponse<AiSuggestion>(response);
      await refresh();
      setOpen(true);
      toast(result.needsHuman ? "AI wskazuje sprawę do konsultacji z człowiekiem." : "Propozycja odpowiedzi gotowa do sprawdzenia.");
    } catch (error) { setError((error as Error).message); setOpen(true); await refresh(); }
    finally { setBusy(false); }
  }

  return <div className={`ai-suggestion ${suggestion?.needsHuman ? "ai-human" : ""}`} aria-busy={busy}>
    <div className="ai-heading">
      <span className="ai-icon" aria-hidden="true"><Sparkles size={15} /></span>
      <button className="ai-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <strong>{suggestion ? "Propozycja odpowiedzi" : "Asystent odpowiedzi"}</strong>
        <ChevronDown size={13} className={open ? "expanded" : ""} />
      </button>
      <span className="ai-demo-label">OpenRouter</span>
      {!state.aiSettings.configured ? <button className="button ai-use" onClick={openSettings}>Skonfiguruj OpenRouter</button> :
        !suggestion && <button className="button ai-use" disabled={busy} onClick={() => void generate()}>{busy && <LoaderCircle size={13} className="ai-spinning" aria-hidden="true" />}{busy ? "Generowanie…" : "Generuj propozycję"}</button>}
      {suggestion && <button className="icon-button" title="Odrzuć propozycję" disabled={busy}
        onClick={() => void act({ type: "suggestion", conversationId: c.id, dismissed: true }).catch((error) => toast(error.message))}><X size={14} /></button>}
    </div>
    {open && <div className="ai-reply-content">
      {error && <p className="settings-error" role="alert">{error}</p>}
      {!suggestion && !busy && <p>{state.aiSettings.configured ? "Wygeneruj odpowiedź ze źródłami oraz propozycję kategorii i priorytetu. Wynik sprawdzisz przed użyciem." : "Dodaj klucz API w ustawieniach, aby korzystać z odpowiedzi AI."}</p>}
      {suggestion && <>
        {stale && <p className="settings-warning" role="status">Rozmowa, wiedza lub ustawienia zmieniły się. Wygeneruj aktualną propozycję.</p>}
        {suggestion.needsHuman && <p className="ai-caution">Potrzebna pomoc człowieka. {suggestion.reason}</p>}
        {suggestion.text && <p className="ai-preview">{suggestion.text}</p>}
        {!suggestion.needsHuman && suggestion.reason && <p className="ai-reason">{suggestion.reason}</p>}
        <div className="ai-triage"><span>{suggestion.category} · {suggestion.priority}</span>
          {(c.category !== suggestion.category || c.priority !== suggestion.priority) && <button className="text-button" disabled={busy || stale || !state.aiSettings.configured}
            onClick={() => void act({ type: "updateConversation", conversationId: c.id, patch: { category: suggestion.category, priority: suggestion.priority } })
              .then(() => toast("Kategoria i priorytet zaktualizowane.")).catch((error) => toast(error.message))}>Zastosuj kategorię i priorytet</button>}
        </div>
        <div className="ai-sources"><BookOpen size={12} />
          {suggestion.sources.length ? suggestion.sources.map((source) => <button key={source.id} onClick={() => openKnowledge(source.id)}>{source.title} <span>v{source.version}</span></button>) : <span>Brak źródeł · <button onClick={() => openKnowledge()}>Uzupełnij wiedzę</button></span>}
        </div>
        <div className="ai-bottom">
          <small title={`Wygenerowano ${new Date(suggestion.generatedAt).toLocaleString("pl-PL")}`}>{suggestion.model} · sprawdź przed wysłaniem</small>
          <button className="button" disabled={busy || !state.aiSettings.configured} onClick={() => void generate(true)}>{busy ? <LoaderCircle size={13} className="ai-spinning" aria-hidden="true" /> : <RefreshCw size={13} />} {busy ? "Generowanie…" : "Wygeneruj ponownie"}</button>
          {suggestion.text && <button className="button ai-use" disabled={busy || stale || !state.aiSettings.configured} onClick={() => { onUse(suggestion.text); setOpen(false); }}>Użyj propozycji <ArrowRight size={13} /></button>}
        </div>
      </>}
    </div>}
  </div>;
}
