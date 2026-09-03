"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { readApiResponse } from "@/lib/api-response";
import { useDemo } from "./demo-context";

interface SignatureData { mjml: string; html: string; text: string; version: number; defaultMjml: string }

export function SignatureSettingsView() {
  const { state, user, refresh, toast } = useDemo();
  const [selected, setSelected] = useState(user.id);
  const [saved, setSaved] = useState<SignatureData | null>(null);
  const [mjml, setMjml] = useState("");
  const [preview, setPreview] = useState<{ html: string; text: string; mjml: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [mobile, setMobile] = useState(false);
  const dirty = !!saved && saved.mjml !== mjml;
  const latest = state.users.find((item) => item.id === selected)?.signature?.custom?.version ?? 0;
  const conflict = !!saved && latest > saved.version;

  useEffect(() => {
    let canceled = false;
    setBusy("load"); setError(""); setSaved(null); setPreview(null);
    fetch(`/api/settings/signatures?userId=${encodeURIComponent(selected)}`, { cache: "no-store" })
      .then((response) => readApiResponse<SignatureData>(response))
      .then((data) => { if (!canceled) { setSaved(data); setMjml(data.mjml); setPreview(data); } })
      .catch((error: Error) => { if (!canceled) setError(error.message); })
      .finally(() => { if (!canceled) setBusy(""); });
    return () => { canceled = true; };
  }, [selected, reload]);

  async function perform(action: "preview" | "save") {
    if (busy || !saved) return;
    setBusy(action); setError("");
    try {
      const response = await fetch("/api/settings/signatures", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId: selected, actorId: user.id, generation: state.generation, expectedVersion: saved.version, mjml }),
      });
      const data = await readApiResponse<SignatureData>(response);
      setPreview(data);
      if (action === "save") {
        setSaved({ ...data, defaultMjml: saved.defaultMjml });
        await refresh(); toast("Podpis zapisany. Będzie używany w kolejnych odpowiedziach.");
      }
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(""); }
  }

  return <section className="settings-card signature-settings" aria-labelledby="signatures-heading">
    <h2 id="signatures-heading">Podpisy pracowników</h2>
    <p className="settings-intro">Edytuj podpis jako pełny dokument MJML. Treść odpowiedzi zostanie dodana nad podpisem automatycznie.</p>
    <label className="settings-field" htmlFor="signature-user"><span>Pracownik</span>
      <select id="signature-user" value={selected} disabled={!!busy || dirty} onChange={(event) => setSelected(event.target.value)}>
        {state.users.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {dirty && <small>Zapisz lub porzuć zmiany przed zmianą pracownika.</small>}
    </label>
    {busy === "load" && <p role="status">Wczytuję podpis…</p>}
    {saved && <>
      <div className="signature-editor-grid">
        <label className="settings-field" htmlFor="signature-mjml"><span>Szablon MJML</span>
          <textarea id="signature-mjml" spellCheck={false} value={mjml} maxLength={50000} disabled={!!busy}
            onChange={(event) => { setMjml(event.target.value); setError(""); }} />
          <small>Edytuj imię, dane kontaktowe i wygląd bezpośrednio w kodzie. Wersja tekstowa powstaje automatycznie.</small>
        </label>
        <div className="signature-preview-panel">
          <div className="signature-preview-heading"><strong>Podgląd</strong><button type="button" className="text-button" onClick={() => setMobile(!mobile)}>{mobile ? "Pokaż komputer" : "Pokaż telefon"}</button></div>
          {preview && <iframe title="Podgląd podpisu MJML" sandbox="" referrerPolicy="no-referrer" srcDoc={preview.html}
            className={mobile ? "signature-frame signature-frame-mobile" : "signature-frame"} />}
          {preview?.mjml !== mjml && <small>Podgląd poprzedniej wersji. Kliknij „Odśwież podgląd”.</small>}
          {preview && <details><summary>Wersja tekstowa</summary><pre>{preview.text}</pre></details>}
        </div>
      </div>
      {conflict && <p className="settings-warning" role="status">Ktoś zapisał nowszy podpis. Skopiuj swoje zmiany i wczytaj aktualną wersję.</p>}
      <div className="settings-actions">
        <button className="button primary" disabled={!!busy || !dirty || conflict} onClick={() => void perform("save")}>{busy === "save" && <LoaderCircle size={13} className="ai-spinning" />}Zapisz podpis</button>
        <button className="button" disabled={!!busy} onClick={() => void perform("preview")}>{busy === "preview" && <LoaderCircle size={13} className="ai-spinning" />}Odśwież podgląd</button>
        <button className="text-button" disabled={!!busy} onClick={() => { setMjml(saved.defaultMjml); setError(""); }}>Wstaw domyślny szablon</button>
        {(dirty || conflict) && <button className="text-button" disabled={!!busy} onClick={() => setReload((value) => value + 1)}>Porzuć zmiany i wczytaj zapisany</button>}
      </div>
    </>}
    {error && <p className="settings-error" role="alert">{error}{!saved && <button className="text-button" onClick={() => setReload((value) => value + 1)}>Wczytaj ponownie</button>}</p>}
  </section>;
}
