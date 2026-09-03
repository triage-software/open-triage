"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { DemoAction } from "@/lib/store";
import type { PublicState, User } from "@/lib/types";
import { isActiveUser, team } from "@/lib/team";

export class ClientError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export interface DemoContextValue {
  state: PublicState;
  user: User;
  sessionId: string;
  act: (action: DemoAction, requestId?: string) => Promise<PublicState>;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
  openConversation: (id: string, commentId?: string) => void;
  openKnowledge: (id?: string) => void;
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
