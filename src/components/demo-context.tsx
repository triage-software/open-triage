"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DemoAction } from "@/lib/store";
import type { PublicState, User } from "@/lib/types";
import { isActiveUser, team } from "@/lib/team";
import { readApiResponse } from "@/lib/api-response";

export class ClientError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
/** Feature switches for the shared workspace shell: the demo driver enables
 *  everything; the API driver degrades backend-less features gracefully. */
export interface WorkspaceCapabilities {
  /** Live presence heartbeats + collaborator avatars. */
  presence: boolean;
  /** Demo-only "work as" user switcher. */
  impersonation: boolean;
  /** OpenRouter key management UI (demo stores the key locally). */
  aiKeyManagement: boolean;
  /** Prototype "check mail" IMAP sync button. */
  mailCheck: boolean;
  /** Per-user signature editor. */
  signatureSettings: boolean;
  /** Knowledge create/edit/approve (API mode: owner/admin only). */
  knowledgeEditing: boolean;
  /** AI model setting write access (API mode: owner/admin only). */
  aiModelEditing: boolean;
}
/** AI panel actions, provided by the active driver (demo store vs API). */
export interface WorkspaceAi {
  generateSuggestion: (
    conversationId: string,
    force?: boolean,
  ) => Promise<{ needsHuman: boolean }>;
  classify: (conversationId: string) => Promise<void>;
}
export const demoCapabilities: WorkspaceCapabilities = {
  presence: true,
  impersonation: true,
  aiKeyManagement: true,
  mailCheck: true,
  signatureSettings: true,
  knowledgeEditing: true,
  aiModelEditing: true,
};
export interface DemoContextValue {
  state: PublicState;
  user: User;
  sessionId: string;
  act: (action: DemoAction, requestId?: string) => Promise<PublicState>;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
  openConversation: (id: string, commentId?: string) => void;
  openKnowledge: (id?: string) => void;
  openSettings: () => void;
  capabilities: WorkspaceCapabilities;
  ai: WorkspaceAi;
}
export const DemoContext = createContext<DemoContextValue | null>(null);
export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("Missing demo context");
  return context;
}

export function useDemoData() {
  const [state, setState] = useState<PublicState | null>(null);
  const [selectedUserId, setUserId] = useState(team[0].id);
  const userId =
    state?.users.find(
      (user) => user.id === selectedUserId && isActiveUser(user),
    )?.id ??
    state?.users.find(isActiveUser)?.id ??
    team[0].id;
  const [sessionId, setSessionId] = useState("");
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const stateRef = useRef<PublicState | null>(null);
  const retiredGenerations = useRef(new Set<string>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(""), 4500);
  }, []);

  const accept = useCallback(
    (next: PublicState) => {
      const current = stateRef.current;
      if (retiredGenerations.current.has(next.generation)) return;
      if (
        current &&
        current.generation === next.generation &&
        current.revision > next.revision
      )
        return;
      if (current && current.generation !== next.generation) {
        retiredGenerations.current.add(current.generation);
        toast("Dane demo zostały przywrócone.");
      }
      if (current && current.aiSettings.version > next.aiSettings.version)
        next = { ...next, aiSettings: current.aiSettings };
      stateRef.current = next;
      setState(next);
      setConnected(true);
      setError("");
    },
    [toast],
  );
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/demo", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      accept(data);
    } catch (error) {
      setConnected(false);
      setError(
        (error as Error).message ||
          "Nie można połączyć się z lokalnym serwerem.",
      );
    }
  }, [accept]);
  useEffect(() => {
    setUserId(sessionStorage.getItem("triage-user") ?? team[0].id);
    setSessionId(crypto.randomUUID());
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refresh();
      if (!stopped) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh]);
  const selectUser = useCallback((id: string) => {
    sessionStorage.setItem("triage-user", id);
    setUserId(id);
  }, []);
  const generation = state?.generation;
  const act = useCallback(
    async (action: DemoAction, requestId = crypto.randomUUID()) => {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, userId, generation, action }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) await refresh();
        throw new ClientError(result.error, result.code);
      }
      accept(result);
      return result as PublicState;
    },
    [userId, generation, accept, refresh],
  );
  return {
    state,
    userId,
    selectUser,
    sessionId,
    connected,
    error,
    refresh,
    act,
    toast,
    toastMessage,
  };
}

export type DemoData = ReturnType<typeof useDemoData>;

/** Structural contract the shared workspace shell needs from a data driver
 *  (demo store or the API-backed workspace). */
export interface WorkspaceData {
  state: PublicState | null;
  userId: string;
  selectUser?: (id: string) => void;
  sessionId: string;
  connected: boolean;
  error: string;
  refresh: () => Promise<void>;
  act: (action: DemoAction, requestId?: string) => Promise<PublicState>;
  toast: (message: string) => void;
  toastMessage: string;
  loadConversation?: (id: string) => Promise<void>;
}

/** Demo-store AI driver: the prototype's local OpenRouter bridge. */
export function useDemoAi(data: DemoData): WorkspaceAi {
  const { userId, refresh, state } = data;
  const generation = state?.generation;
  return useMemo<WorkspaceAi>(
    () => ({
      async generateSuggestion(conversationId, force = false) {
        const response = await fetch("/api/ai/suggestion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, generation, userId, force }),
        });
        const result = await readApiResponse<{ needsHuman: boolean }>(response);
        await refresh();
        return { needsHuman: result.needsHuman };
      },
      async classify(conversationId) {
        await readApiResponse(
          await fetch("/api/ai/classification", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId, generation, userId }),
          }),
        );
        await refresh();
      },
    }),
    [generation, userId, refresh],
  );
}
