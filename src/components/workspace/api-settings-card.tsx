"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import type { AiSettingsPublic } from "@/lib/ai-types";
import { useDemo } from "../demo-context";

/**
 * OpenRouter settings for the API-backed workspace: the key is managed by the
 * self-host operator (OPENROUTER_API_KEY env), tenants configure the model via
 * PATCH /v1/settings/ai. Reuses the prototype settings-card look.
 */
export function ApiAiModelCard() {
  const { state, refresh, toast, capabilities } = useDemo();
  const [model, setModel] = useState(state.aiSettings.model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canEdit = capabilities.aiModelEditing;

  async function save() {
    if (busy || !model.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/proxy/settings/ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body?.code === "FORBIDDEN"
            ? "Tylko administrator może zmienić model."
            : "Nie udało się zapisać ustawień.",
        );
      }
      const saved = body?.data as AiSettingsPublic | undefined;
      if (saved?.model) setModel(saved.model);
      setNotice("Ustawienia OpenRouter zapisane.");
      toast("Ustawienia OpenRouter zapisane.");
      await refresh();
    } catch (error_) {
      setError((error_ as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card" aria-labelledby="openrouter-heading">
      <div className="settings-heading">
        <span className="settings-icon">
          <Sparkles size={22} />
        </span>
        <div>
          <h2 id="openrouter-heading">OpenRouter</h2>
          <p>Propozycje odpowiedzi i klasyfikacja zgłoszeń</p>
        </div>
        <span className={`settings-status ${state.aiSettings.configured ? "configured" : ""}`}>
          {state.aiSettings.configured ? (
            <>
              <Check size={13} /> Klucz aktywny
            </>
          ) : (
            "Brak klucza serwera"
          )}
        </span>
      </div>
      <p className="settings-intro">
        Klucz OpenRouter konfiguruje operator serwera (zmienna środowiskowa
        OPENROUTER_API_KEY). Twój zespół wybiera model używany do propozycji
        odpowiedzi i klasyfikacji.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="settings-field" htmlFor="openrouter-model">
          <span>Model klasyfikacji i odpowiedzi</span>
          <input
            id="openrouter-model"
            type="text"
            spellCheck={false}
            value={model}
            disabled={busy || !canEdit}
            onChange={(event) => {
              setModel(event.target.value);
              setNotice("");
            }}
          />
          <small>
            Identyfikator modelu OpenRouter, np. z-ai/glm-5.3. Opłaty rozlicza
            konto operatora.
          </small>
        </label>
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="settings-success" role="status">
            <Check size={15} /> {notice}
          </p>
        )}
        <div className="settings-actions">
          <button
            className="button primary"
            type="submit"
            disabled={busy || !canEdit || model.trim() === state.aiSettings.model}
          >
            {busy ? "Zapisywanie…" : "Zapisz ustawienia"}
          </button>
        </div>
        {!canEdit && (
          <p className="settings-note">
            Tylko właściciel lub administrator może zmienić model.
          </p>
        )}
      </form>
    </section>
  );
}

