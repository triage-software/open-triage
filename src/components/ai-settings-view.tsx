"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import type { AiKeyUsage, AiModel, AiSettingsPublic } from "@/lib/ai-types";
import { readApiResponse } from "@/lib/api-response";
import { useDemo } from "./demo-context";
import { SignatureSettingsView } from "./signature-settings-view";

export function AiSettingsView() {
  const { state, refresh, toast } = useDemo();
  const [saved, setSaved] = useState<AiSettingsPublic>(state.aiSettings);
  const [model, setModel] = useState(saved.model);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<AiModel[]>([]);
  const [modelError, setModelError] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [usage, setUsage] = useState<AiKeyUsage | null>(null);
  const [usageError, setUsageError] = useState("");
  const [usageBusy, setUsageBusy] = useState(false);
  const changedElsewhere = state.aiSettings.version > saved.version;
  const dirty = !!key.trim() || model !== saved.model;

  async function loadModels() {
    setLoadingModels(true); setModelError("");
    try {
      const response = await fetch("/api/settings/ai/models", { cache: "no-store" });
      const data = await readApiResponse<{ models: AiModel[] }>(response);
      setModels(data.models);
    } catch (error) { setModelError((error as Error).message); }
    finally { setLoadingModels(false); }
  }
  useEffect(() => { void loadModels(); }, []);

  async function loadUsage() {
    if (!state.aiSettings.configured) return;
    setUsageBusy(true); setUsageError("");
    try {
      const response = await fetch("/api/settings/ai/usage", { cache: "no-store" });
      const data = await readApiResponse<AiKeyUsage>(response);
      setUsage(data);
    } catch (error) { setUsageError((error as Error).message); }
    finally { setUsageBusy(false); }
  }
  useEffect(() => { if (state.aiSettings.configured) void loadUsage(); }, [state.aiSettings.configured, state.aiSettings.version, state.aiUsageSummary.requests]);

  async function perform(action: "save" | "test" | "remove") {
    if (busy) return;
    setBusy(action); setError(""); setNotice("");
    try {
      const response = await fetch(action === "test" ? "/api/settings/ai/test" : "/api/settings/ai", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "test" ? {} : {
          expectedVersion: saved.version, model,
          ...(action === "remove" ? { clearKey: true } : key.trim() ? { apiKey: key.trim() } : {}),
        }),
      });
      const data = await readApiResponse<AiSettingsPublic>(response);
      setSaved(data); setModel(data.model); setKey(""); setConfirmRemove(false);
      const message = action === "test" ? "Klucz działa, a model jest dostępny. Możesz generować propozycje w rozmowach." :
        action === "remove" ? "Klucz usunięty. Generowanie jest wyłączone." : "Ustawienia OpenRouter zapisane.";
      setNotice(message); toast(message);
      await refresh();
      if (data.configured) await loadUsage();
    } catch (error) { setError((error as Error).message); await refresh(); }
    finally { setBusy(""); }
  }

  return (
    <div className="ai-settings-view">
      <SignatureSettingsView />
      <section className="settings-card" aria-labelledby="openrouter-heading">
        <div className="settings-heading"><span className="settings-icon"><Sparkles size={22} /></span><div>
          <h2 id="openrouter-heading">OpenRouter</h2><p>Propozycje odpowiedzi i klasyfikacja zgłoszeń</p>
        </div><span className={`settings-status ${saved.configured ? "configured" : ""}`}>
          {saved.configured ? <><Check size={13} /> Klucz zapisany</> : "Nie skonfigurowano"}
        </span></div>
        <p className="settings-intro">Wybierz model i dodaj klucz. W rozmowie kliknij „Generuj propozycję”, sprawdź źródła i przenieś odpowiedź do edytora.</p>
        {saved.configured && (
          <div className="usage-panel" aria-label="Koszty OpenRouter">
            <div className="usage-heading"><div><strong>Koszty AI</strong><span>USD · dane rozliczeniowe OpenRouter</span></div>
              <button className="text-button" type="button" disabled={usageBusy} onClick={() => void loadUsage()}><RefreshCw size={13} className={usageBusy ? "ai-spinning" : ""} /> {usageBusy ? "Odświeżam…" : "Odśwież"}</button>
            </div>
            <div className="usage-grid">
              <div><span>Ten panel</span><strong>{usd(state.aiUsageSummary.cost)}</strong><small>{state.aiUsageSummary.requests} generowań · {integer(state.aiUsageSummary.totalTokens)} tokenów</small></div>
              <div><span>Ten klucz łącznie</span><strong>{usage ? usd(usage.usage) : "—"}</strong><small>{usage?.usageMonthly !== undefined ? `${usd(usage.usageMonthly)} w tym miesiącu` : "Według OpenRouter"}</small></div>
              <div><span>Pozostały limit klucza</span><strong>{usage?.remaining !== undefined ? usd(usage.remaining) : usage ? usage.limit === undefined ? "Bez limitu" : "Brak danych" : "—"}</strong><small>{usage?.limit !== undefined ? `Limit ${usd(usage.limit)}` : usage ? "Brak ustawionego limitu klucza" : "Oczekiwanie na OpenRouter"}</small></div>
            </div>
            {usageError && <p className="settings-error" role="alert">{usageError}</p>}
            <p className="usage-note">„Ten panel” liczy koszty zwrócone przez OpenRouter od włączenia rejestru, także dla odrzuconych propozycji. Dane klucza obejmują również użycie poza panelem. Pozostały limit jest budżetem klucza, a nie saldem całego konta.</p>
          </div>
        )}
        <form onSubmit={(event) => { event.preventDefault(); void perform("save"); }}>
          <label className="settings-field" htmlFor="openrouter-key">
            <span><KeyRound size={15} /> Klucz API OpenRouter</span>
            <input id="openrouter-key" type="password" autoComplete="new-password" spellCheck={false}
              value={key} onChange={(event) => { setKey(event.target.value); setNotice(""); }} disabled={!!busy}
              placeholder={saved.configured ? "Klucz zapisany — wklej nowy, aby go zastąpić" : "sk-or-v1-…"} />
            <small>Klucz jest zapisany wyłącznie na lokalnym serwerze. Puste pole zachowuje zapisany klucz. <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Utwórz klucz w OpenRouter ↗</a></small>
          </label>
          <label className="settings-field" htmlFor="openrouter-model">
            <span>Model odpowiedzi</span>
            <select id="openrouter-model" value={model} disabled={!!busy} onChange={(event) => { setModel(event.target.value); setNotice(""); }}>
              {!models.some((item) => item.id === model) && <option value={model}>{model}</option>}
              {models.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
            </select>
            <small>{loadingModels ? "Pobieranie modeli…" : "Modele obsługujące odpowiedzi ze źródłami. Opłaty za generowanie rozlicza OpenRouter."}</small>
          </label>
          {modelError && <p className="settings-warning" role="alert">{modelError} <button type="button" className="text-button" disabled={loadingModels} onClick={() => void loadModels()}>Pobierz ponownie</button></p>}
          {changedElsewhere && <div className="settings-warning" role="status">Ustawienia zmieniły się w innej karcie. <button type="button" className="text-button" disabled={!!busy}
            onClick={() => { setSaved(state.aiSettings); setModel(state.aiSettings.model); setNotice(""); setError(""); }}>Wczytaj aktualne ustawienia</button><small>Wpisany, niezapisany klucz pozostanie w polu.</small></div>}
          {error && <p className="settings-error" role="alert">{error}</p>}
          {notice && <p className="settings-success" role="status"><Check size={15} /> {notice}</p>}
          <div className="settings-actions">
            <button className="button primary" type="submit" disabled={!!busy || changedElsewhere || (!dirty && saved.version > 0)}>{busy === "save" ? "Zapisywanie…" : "Zapisz ustawienia"}</button>
            <button className="button" type="button" disabled={!!busy || !saved.configured || dirty || changedElsewhere} onClick={() => void perform("test")}>
              <RefreshCw size={14} className={busy === "test" ? "ai-spinning" : ""} />{busy === "test" ? "Sprawdzanie…" : "Sprawdź połączenie"}</button>
            {saved.configured && <button type="button" className="text-button settings-remove" disabled={!!busy || changedElsewhere} onClick={() => setConfirmRemove(!confirmRemove)}><Trash2 size={14} /> Usuń klucz</button>}
          </div>
          {confirmRemove && <div className="settings-warning">Usunąć klucz i wyłączyć generowanie? <button className="button" type="button" disabled={!!busy} onClick={() => void perform("remove")}>Tak, usuń klucz</button></div>}
          <p className="settings-note">Sprawdzenie połączenia weryfikuje klucz i dostępność modelu bez generowania płatnej odpowiedzi.{saved.verifiedAt && ` Ostatnio sprawdzono: ${new Date(saved.verifiedAt).toLocaleString("pl-PL")}.`}</p>
        </form>
      </section>
      <section className="settings-data-note">
        <h3>Co otrzymuje model?</h3>
        <p>Temat i ostatnie 12 publicznych wiadomości oraz do 8 zatwierdzonych dokumentów z wiedzy tej skrzynki. Długie wiadomości i dokumenty są skracane. Komentarze wewnętrzne i szkice pozostają w aplikacji.</p>
        <p>Każda propozycja czeka na sprawdzenie przez pracownika. Generowanie nie wysyła maila. Zapisany klucz i model są wspólne dla całego zespołu.</p>
      </section>
    </div>
  );
}

function usd(value: number) {
  if (value > 0 && value < 0.01) return `$${value.toFixed(6)}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}
function integer(value: number) { return new Intl.NumberFormat("pl-PL").format(value); }
