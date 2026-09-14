"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { DemoAction } from "@/lib/store";
import type { PublicState } from "@/lib/types";
import {
  mapApiConversationDetail,
  mapApiWorkspaceState,
  plPriorityToApi,
  plStatusToApi,
  toPriority,
  type ApiConversationDetail,
  type ApiSessionUser,
  type ApiWorkspacePayload,
} from "@/lib/workspace-map";
import {
  ClientError,
  type WorkspaceAi,
  type WorkspaceCapabilities,
  type WorkspaceData,
} from "../demo-context";
import { SupportWorkspace, type WorkspaceIdentity } from "../support-app";
import { TriageMark } from "../ui";

/** Polish operator messages for structured API error codes. */
function apiError(code: string, message: string, status: number): ClientError {
  const messages: Record<string, string> = {
    DRAFT_CONFLICT:
      "Ten szkic został zmieniony w innej karcie tego samego pracownika. Twój tekst pozostaje w edytorze.",
    DOCUMENT_CONFLICT:
      "Dokument zmienił się w innej karcie. Otwórz aktualną wersję przed zapisem.",
    MAIL_QUEUE_UNAVAILABLE:
      "Usługa wysyłki poczty jest niedostępna. Odpowiedź nie została wysłana — spróbuj ponownie za chwilę.",
    NOT_FOUND: "Nie znaleziono elementu. Odśwież panel.",
    FORBIDDEN: "Brak uprawnień do tej operacji.",
    UNAUTHENTICATED: "Sesja wygasła. Odśwież stronę i zaloguj się ponownie.",
    VALIDATION_ERROR: message || "Nieprawidłowe dane operacji.",
  };
  return new ClientError(
    messages[code] ?? `Nie udało się zapisać zmian (HTTP ${status}). Spróbuj ponownie.`,
    code,
  );
}

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/proxy${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let code = "";
    let message = "";
    try {
      const data = await response.json();
      code = String(data?.code ?? "");
      message = String(data?.message ?? "");
    } catch {
      // non-JSON error body — fall through with the generic message
    }
    throw apiError(code, message, response.status);
  }
  return (await response.json().catch(() => null)) as T;
}

/** Extracts the payload whether the proxy wraps it or the API returns {data}. */
async function fetchWorkspaceState(): Promise<ApiWorkspacePayload> {
  const response = await api<ApiWorkspacePayload | { data: ApiWorkspacePayload }>(
    "GET",
    "/workspace/state",
  );
  const payload =
    response && "data" in response && response.data
      ? (response.data as ApiWorkspacePayload)
      : (response as ApiWorkspacePayload);
  if (!payload || !Array.isArray(payload.users) || !Array.isArray(payload.conversations)) {
    throw new Error("Nieprawidłowa odpowiedź serwera.");
  }
  return payload;
}

const POLL_INTERVAL_MS = 15000;

export function useApiWorkspaceData(session: ApiSessionUser): {
  data: WorkspaceData;
  capabilities: WorkspaceCapabilities;
  ai: WorkspaceAi;
} {
  const [state, setState] = useState<PublicState | null>(null);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [sessionId, setSessionId] = useState("");
  const payloadRef = useRef<ApiWorkspacePayload | null>(null);
  const revisionRef = useRef(0);
  const dismissedRef = useRef(new Set<string>());
  const detailsRef = useRef(new Map<string, PublicState["conversations"][number]>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(""), 4500);
  }, []);

  const rebuild = useCallback((): PublicState | null => {
    const payload = payloadRef.current;
    if (!payload) return null;
    const mapped = mapApiWorkspaceState(payload, session, {
      revision: ++revisionRef.current,
      dismissed: dismissedRef.current,
      details: detailsRef.current,
    });
    return mapped.state;
  }, [session]);

  const fetchState = useCallback(async (): Promise<PublicState | null> => {
    try {
      const payload = await fetchWorkspaceState();
      payloadRef.current = payload;
      const next = rebuild();
      if (!next) return null;
      setState(next);
      setConnected(true);
      setError("");
      return next;
    } catch (error_) {
      setConnected(false);
      setError("Nie można połączyć się z serwerem open-triage.");
      throw error_;
    }
  }, [rebuild]);

  const refresh = useCallback(async () => {
    await fetchState().catch(() => undefined);
  }, [fetchState]);

  useEffect(() => {
    setSessionId(crypto.randomUUID());
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refresh();
      if (!stopped) timer = setTimeout(poll, POLL_INTERVAL_MS);
    }
    function onVisible() {
      if (!document.hidden) void refresh();
    }
    void poll();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  /** Loads the full message/comment timeline for one conversation and keeps it
   *  across state refreshes (summaries only carry the last message). */
  const loadConversation = useCallback(
    async (id: string) => {
      const detail = await api<{ data: ApiConversationDetail }>(
        "GET",
        `/conversations/${id}`,
      ).then((response) => response?.data);
      const current = rebuild();
      if (!detail || !current) return;
      const full = mapApiConversationDetail(
        detail,
        current.mailboxes,
        session,
        current.knowledge,
      );
      if (dismissedRef.current.has(id)) full.suggestionDismissed = true;
      detailsRef.current.set(id, full);
      const next = rebuild();
      if (next) setState(next);
    },
    [rebuild, session],
  );

  const act = useCallback(
    async (action: DemoAction): Promise<PublicState> => {
      switch (action.type) {
        case "updateConversation": {
          const patch: Record<string, unknown> = {};
          if (action.patch.status !== undefined)
            patch.status = plStatusToApi[action.patch.status];
          if (action.patch.priority !== undefined)
            patch.priority = plPriorityToApi[action.patch.priority];
          if (action.patch.assigneeId !== undefined)
            patch.assigneeId = action.patch.assigneeId;
          if (action.patch.category !== undefined)
            patch.category = action.patch.category;
          await api("PATCH", `/conversations/${action.conversationId}`, patch);
          break;
        }
        case "saveDraft":
          await api("PUT", `/conversations/${action.conversationId}/draft`, {
            mode: action.mode,
            text: action.text,
            baseRevision: action.basePublicRevision,
            expectedVersion: action.expectedVersion,
          });
          break;
        case "sendReply": {
          await api("POST", `/conversations/${action.conversationId}/messages`, {
            body: action.text,
            send: true,
          });
          // Prototype parity: after a reply the ball is in the customer's court.
          await api("PATCH", `/conversations/${action.conversationId}`, {
            status: "pending",
          }).catch(() => undefined);
          break;
        }
        case "addComment":
          await api("POST", `/conversations/${action.conversationId}/comments`, {
            body: action.text,
          });
          break;
        case "suggestion": {
          if (action.dismissed) dismissedRef.current.add(action.conversationId);
          else dismissedRef.current.delete(action.conversationId);
          const local = rebuild();
          if (local) setState(local);
          return local!;
        }
        case "knowledge":
          await api("PATCH", `/knowledge-items/${action.documentId}`, {
            title: action.title,
            content: action.body,
            status: action.status,
            expectedVersion: action.expectedVersion,
          });
          break;
        case "createKnowledge":
          await api("POST", "/knowledge-items", {
            title: action.title,
            content: action.body,
            mailboxId: action.mailboxId,
            category: action.category,
          });
          break;
        case "readNotifications":
          await api("POST", "/workspace/notifications-read", {
            ids: action.notificationIds,
          });
          break;
      }
      const next = await fetchState();
      return next!;
    },
    [fetchState, rebuild],
  );

  const data: WorkspaceData = useMemo(
    () => ({
      state,
      userId: session.id,
      sessionId,
      connected,
      error,
      refresh,
      act,
      toast,
      toastMessage,
      loadConversation: (id: string) => loadConversation(id).catch(() => undefined),
    }),
    [state, session.id, sessionId, connected, error, refresh, act, toast, toastMessage, loadConversation],
  );

  const isAdmin = session.role === "owner" || session.role === "admin";
  const capabilities: WorkspaceCapabilities = useMemo(
    () => ({
      presence: false,
      impersonation: false,
      aiKeyManagement: false,
      mailCheck: false,
      signatureSettings: false,
      knowledgeEditing: isAdmin,
      aiModelEditing: isAdmin,
    }),
    [isAdmin],
  );

  const ai: WorkspaceAi = useMemo(
    () => ({
      async generateSuggestion(conversationId) {
        const result = await api<{
          data: { draft: { needsHuman: boolean } };
        }>("POST", `/conversations/${conversationId}/ai-draft`, {});
        const draft = result?.data?.draft;
        return { needsHuman: Boolean(draft?.needsHuman) };
      },
      async classify(conversationId) {
        const result = await api<{
          data: { classification: { category: string | null; priority: string | null } | null };
        }>("POST", `/conversations/${conversationId}/ai-draft`, {});
        const classification = result?.data?.classification;
        if (!classification?.category) {
          throw new Error(
            "Klasyfikacja jest niedostępna. Poproś administratora o konfigurację klucza OpenRouter.",
          );
        }
        await api("PATCH", `/conversations/${conversationId}`, {
          category: classification.category,
          priority: plPriorityToApi[toPriority(classification.priority)],
        }).catch(() => undefined);
      },
    }),
    [],
  );

  return { data, capabilities, ai };
}

/** Client root: session-gated API-backed support workspace (mounted at /). */
export function ApiSupportApp({
  session,
  tenantName,
  logoutAction,
}: {
  session: ApiSessionUser;
  tenantName: string;
  logoutAction: () => Promise<void>;
}) {
  const { data, capabilities, ai } = useApiWorkspaceData(session);
  const params = useSearchParams();
  const selectedId = params.get("conversation");
  const stateLoaded = Boolean(data.state);

  // Hydrate the full timeline for deep-linked conversations (?conversation=).
  useEffect(() => {
    if (selectedId && stateLoaded) {
      void data.loadConversation?.(selectedId);
    }
  }, [selectedId, stateLoaded, data.loadConversation]);

  const user =
    data.state?.users.find((u) => u.id === session.id) ?? data.state?.users[0];
  const identity: WorkspaceIdentity | undefined = user && {
    name: user.name,
    email: session.email,
    role: user.role,
    logoutLabel: "Wyloguj się",
    onLogout: () => void logoutAction(),
  };

  if (!data.state || !user) {
    return (
      <div className="boot-screen">
        <div className="brand-symbol">
          <TriageMark size={25} />
        </div>
        <h1>Open Triage</h1>
        <p>{data.error || `Przygotowujemy przestrzeń „${tenantName}”…`}</p>
        {data.error && (
          <button className="button primary" onClick={() => void data.refresh()}>
            Spróbuj ponownie
          </button>
        )}
      </div>
    );
  }

  return (
    <SupportWorkspace
      data={data}
      ai={ai}
      capabilities={capabilities}
      identity={identity}
    />
  );
}
