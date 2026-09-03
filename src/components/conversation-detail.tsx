"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  Download,
  Eye,
  Link2,
  LockKeyhole,
  MessageSquare,
  MoreHorizontal,
  Send,
  Sparkles,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { ComposerMode, Conversation, Draft } from "@/lib/types";
import { isActiveUser } from "@/lib/team";
import {
  categories,
  draftKey,
  priorities,
  statuses,
  suggestReply,
} from "@/lib/types";
import { ClientError, useDemo } from "./demo-context";
import { Avatar, copyLink, dateTime, PriorityBadge, time } from "./ui";

export function ConversationDetail({
  conversation: c,
  onClose,
}: {
  conversation: Conversation;
  onClose: () => void;
}) {
  const { state, user, sessionId, act, toast, openKnowledge } = useDemo();
  const savedDraft = state.drafts.find(
    (draft) =>
      draft.conversationId === c.id &&
      draft.userId === user.id &&
      draft.text.trim(),
  );
  const [mode, setMode] = useState<ComposerMode>(savedDraft?.mode ?? "reply");
  const [composerOpen, setComposerOpen] = useState(!!savedDraft);
  const [aiOpen, setAiOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const [suggestionRequest, setSuggestionRequest] = useState<{
    text: string;
    token: number;
  } | null>(null);
  const [highlighted, setHighlighted] = useState("");
  const [linkError, setLinkError] = useState("");
  const [metadataBusy, setMetadataBusy] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const mailbox = state.mailboxes.find((b) => b.id === c.mailboxId)!;
  const suggestion = suggestReply(c, state.knowledge);
  const assignee = state.users.find((u) => u.id === c.assigneeId);
  const others = state.presence.filter(
    (p) => p.conversationId === c.id && p.sessionId !== sessionId,
  );
  const uniqueOthers = [...new Map(others.map((p) => [p.userId, p])).values()];
  const pulse = useRef({ mode, writing });
  pulse.current = { mode, writing };

  useEffect(() => {
    if (!sessionId) return;
    const payload = (remove = false) =>
      JSON.stringify({
        type: "presence",
        presence: {
          sessionId,
          userId: user.id,
          generation: state.generation,
          conversationId: remove ? null : c.id,
          mode: pulse.current.writing
            ? pulse.current.mode === "reply"
              ? "replying"
              : "commenting"
            : "viewing",
        },
      });
    const send = () => {
      if (!document.hidden)
        void fetch("/api/demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload(),
        }).catch(() => undefined);
    };
    const leave = () => {
      void fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload(true),
        keepalive: true,
      }).catch(() => undefined);
    };
    const visibility = () => {
      if (document.hidden) leave();
      else send();
    };
    send();
    const timer = setInterval(send, 15_000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [c.id, state.generation, user.id, sessionId]);
  useEffect(() => {
    if (!sessionId || document.hidden) return;
    void fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "presence",
        presence: {
          sessionId,
          userId: user.id,
          generation: state.generation,
          conversationId: c.id,
          mode: writing
            ? mode === "reply"
              ? "replying"
              : "commenting"
            : "viewing",
        },
      }),
    }).catch(() => undefined);
  }, [writing, mode, c.id, state.generation, user.id, sessionId]);

  useEffect(() => {
    function scrollToHash() {
      const hash = window.location.hash.slice(1);
      if (!hash.startsWith("comment-")) return;
      const element = document.getElementById(hash);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlighted(hash);
        setLinkError("");
      } else
        setLinkError("Nie znaleziono komentarza z tego linku w tej rozmowie.");
    }
    const timer = setTimeout(scrollToHash, 80);
    window.addEventListener("hashchange", scrollToHash);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", scrollToHash);
    };
  }, [c.id, c.comments.length]);
  useEffect(() => {
    if (highlighted) {
      const timer = setTimeout(() => setHighlighted(""), 6000);
      return () => clearTimeout(timer);
    }
  }, [highlighted]);

  async function update(patch: {
    assigneeId?: string | null;
    status?: Conversation["status"];
    category?: Conversation["category"];
    priority?: Conversation["priority"];
  }) {
    setMetadataBusy(true);
    try {
      await act({ type: "updateConversation", conversationId: c.id, patch });
      if (patch.status === "Zakończone")
        toast(
          "Rozmowa zakończona. Archiwum zapisane, propozycja wiedzy czeka na akceptację.",
        );
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setMetadataBusy(false);
    }
  }
  async function copy(commentId?: string) {
    try {
      await copyLink(c.id, commentId);
      toast(
        commentId
          ? "Link do komentarza skopiowany."
          : "Link do rozmowy skopiowany.",
      );
    } catch {
      toast("Nie udało się skopiować linku. Sprawdź uprawnienia schowka.");
    }
  }
  function scrollBottom() {
    timelineRef.current?.scrollTo({
      top: timelineRef.current.scrollHeight,
      behavior: "smooth",
    });
  }
  const timeline = [
    ...c.emails.map((email) => ({
      type: "email" as const,
      createdAt: email.createdAt,
      data: email,
    })),
    ...c.comments.map((comment) => ({
      type: "comment" as const,
      createdAt: comment.createdAt,
      data: comment,
    })),
    ...c.activities.map((activity) => ({
      type: "activity" as const,
      createdAt: activity.createdAt,
      data: activity,
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <article className="conversation-detail">
      <header className="detail-toolbar">
        <div className="detail-ticket">
          <span className="mailbox-dot" style={{ background: mailbox.color }} />
          <span title={mailbox.email}>{mailbox.name}</span>
          <span className="ticket-separator">/</span>
          <span>#{c.number}</span>
        </div>
        <div className="detail-actions">
          <button
            className="icon-button"
            title="Kopiuj link do rozmowy"
            onClick={() => void copy()}
          >
            <Link2 size={16} />
          </button>
          {c.closureVersion > 0 && (
            <a
              className="icon-button"
              title="Pobierz ostatnie archiwum Markdown"
              href={`/api/demo?archive=${c.id}`}
            >
              <Download size={16} />
            </a>
          )}
          <button
            className={`button close-ticket ${c.status === "Zakończone" ? "closed" : ""}`}
            disabled={metadataBusy}
            onClick={() =>
              void update({
                status: c.status === "Zakończone" ? "W toku" : "Zakończone",
              })
            }
          >
            <CheckCheck size={15} />
            {c.status === "Zakończone" ? "Otwórz ponownie" : "Zakończ"}
          </button>
          <button
            className="icon-button"
            title="Zamknij rozmowę"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="conversation-scroll" ref={timelineRef}>
        <section className="detail-heading">
          <h2>{c.subject}</h2>
          <div className="detail-customer">
            <span>{c.customer.company}</span>
            <i>·</i>
            <span>{c.customer.email}</span>
          </div>
          <div className="conversation-properties">
            <label>
              <span>Osoba</span>
              <div className="property-select">
                {assignee ? (
                  <Avatar user={assignee} size="tiny" />
                ) : (
                  <Users size={14} />
                )}
                <select
                  aria-label="Osoba odpowiedzialna"
                  disabled={metadataBusy}
                  value={c.assigneeId ?? ""}
                  onChange={(e) =>
                    void update({ assigneeId: e.target.value || null })
                  }
                >
                  <option value="">Nieprzypisane</option>
                  {assignee && !isActiveUser(assignee) && (
                    <option value={assignee.id} disabled>
                      {assignee.name} · poprzednie demo
                    </option>
                  )}
                  {state.users.filter(isActiveUser).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label>
              <span>Priorytet</span>
              <select
                aria-label="Priorytet rozmowy"
                disabled={metadataBusy}
                value={c.priority}
                onChange={(e) =>
                  void update({
                    priority: e.target.value as Conversation["priority"],
                  })
                }
              >
                {priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Kategoria</span>
              <select
                aria-label="Kategoria rozmowy"
                disabled={metadataBusy}
                value={c.category}
                onChange={(e) =>
                  void update({
                    category: e.target.value as Conversation["category"],
                  })
                }
              >
                {categories.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select
                aria-label="Status rozmowy"
                disabled={metadataBusy}
                value={c.status}
                onChange={(e) =>
                  void update({
                    status: e.target.value as Conversation["status"],
                  })
                }
              >
                {statuses.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="collaboration-row">
            {c.assigneeId !== user.id && (
              <button
                className="text-button"
                disabled={metadataBusy}
                onClick={() => void update({ assigneeId: user.id })}
              >
                <UserPlus size={13} /> Przypisz do mnie
              </button>
            )}
            <div className="presence-list">
              {uniqueOthers.length ? (
                uniqueOthers.map((p) => {
                  const u = state.users.find((item) => item.id === p.userId)!;
                  return (
                    <span
                      key={p.userId}
                      className={`presence-person ${p.mode !== "viewing" ? "typing" : ""}`}
                    >
                      <Avatar user={u} size="tiny" />
                      <span>
                        {u.name.split(" ")[0]}{" "}
                        {p.mode === "replying"
                          ? "pisze odpowiedź"
                          : p.mode === "commenting"
                            ? "pisze komentarz"
                            : "przegląda"}
                      </span>
                      {p.mode !== "viewing" && (
                        <i className="typing-dots">•••</i>
                      )}
                    </span>
                  );
                })
              ) : (
                <span className="presence-alone">
                  <Eye size={13} /> Tylko Ty przeglądasz tę rozmowę
                </span>
              )}
            </div>
          </div>
        </section>
        <div className="timeline">
          <div className="timeline-date">
            <span />
            {new Date(c.createdAt).toLocaleDateString("pl-PL", {
              day: "numeric",
              month: "long",
            })}
            <span />
          </div>
          {linkError && <div className="inline-warning">{linkError}</div>}
          {timeline.map((entry) =>
            entry.type === "activity" ? (
              <div key={entry.data.id} className="activity-entry">
                <span />
                <p>
                  <strong>
                    {state.users.find((u) => u.id === entry.data.userId)?.name}
                  </strong>{" "}
                  {entry.data.text}
                </p>
                <time>{time(entry.createdAt)}</time>
              </div>
            ) : entry.type === "comment" ? (
              <section
                id={`comment-${entry.data.id}`}
                key={entry.data.id}
                className={`message internal-comment ${highlighted === `comment-${entry.data.id}` ? "comment-highlighted" : ""}`}
              >
                <div className="message-head">
                  <Avatar
                    user={state.users.find((u) => u.id === entry.data.userId)}
                    size="small"
                  />
                  <div>
                    <strong>
                      {
                        state.users.find((u) => u.id === entry.data.userId)
                          ?.name
                      }
                    </strong>
                    <span className="internal-label">
                      <LockKeyhole size={11} /> Komentarz wewnętrzny
                    </span>
                  </div>
                  <time title={dateTime(entry.createdAt)}>
                    {time(entry.createdAt)}
                  </time>
                  <button
                    className="icon-button"
                    title="Kopiuj link do komentarza"
                    onClick={() => void copy(entry.data.id)}
                  >
                    <Link2 size={14} />
                  </button>
                </div>
                <div className="message-body">{entry.data.body}</div>
                <div className="internal-footer">
                  <Users size={12} /> Widoczne wyłącznie dla zespołu
                </div>
              </section>
            ) : (
              <section
                key={entry.data.id}
                className={`message ${entry.data.direction === "outbound" ? "outbound-message" : "inbound-message"}`}
                data-email-id={entry.data.id}
              >
                <div className="message-head">
                  <Avatar
                    name={entry.data.authorName}
                    user={state.users.find((u) => u.id === entry.data.userId)}
                    color={mailbox.color}
                    size="small"
                  />
                  <div>
                    <strong>{entry.data.authorName}</strong>
                    <span>
                      {entry.data.direction === "inbound"
                        ? `do ${mailbox.email}`
                        : `do ${entry.data.to}`}
                    </span>
                  </div>
                  <time title={dateTime(entry.createdAt)}>
                    {time(entry.createdAt)}
                  </time>
                </div>
                <div className="message-body">{entry.data.body}</div>
                {entry.data.imap && (
                  <div className="outbound-label">
                    <a href={`/api/mail/source?email=${encodeURIComponent(entry.data.id)}`}>
                      Pobierz oryginał .eml
                    </a>
                    {!!entry.data.attachments?.length && (
                      <span>
                        · Załączniki w oryginale: {entry.data.attachments.map((file) => file.name).join(", ")}
                      </span>
                    )}
                  </div>
                )}
                {entry.data.demo && (
                  <div className="outbound-label">
                    <CheckCheck size={12} /> Wysłano demonstracyjnie z{" "}
                    {entry.data.from}
                  </div>
                )}
              </section>
            ),
          )}
          {c.status === "Zakończone" && (
            <div className="resolved-banner">
              <CheckCheck size={16} />
              <div>
                <strong>Rozmowa zakończona</strong>
                <p>
                  {c.closureVersion
                    ? "Archiwum zapisane. Wnioski czekają w bazie wiedzy."
                    : "Przykładowa zakończona rozmowa."}
                </p>
              </div>
              {c.closureVersion > 0 && (
                <button
                  className="text-button"
                  onClick={() =>
                    openKnowledge(
                      state.knowledge
                        .filter((d) => d.conversationId === c.id)
                        .at(-1)?.id,
                    )
                  }
                >
                  Zobacz wnioski <ArrowRight size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="response-area">
        {!c.suggestionDismissed && (
          <div
            className={`ai-suggestion ${suggestion.needsHuman && !suggestion.text ? "ai-human" : ""}`}
          >
            <div className="ai-heading">
              <span className="ai-icon">
                <Sparkles size={15} />
              </span>
              <button
                className="ai-toggle"
                aria-expanded={aiOpen}
                onClick={() => setAiOpen(!aiOpen)}
              >
                <strong>
                  {suggestion.text
                    ? "Propozycja odpowiedzi"
                    : "Potrzebna pomoc człowieka"}
                </strong>
                <ChevronDown size={13} className={aiOpen ? "expanded" : ""} />
              </button>
              <span className="ai-demo-label">AI · DEMO</span>
              <button
                className="icon-button"
                title="Odrzuć propozycję"
                onClick={() =>
                  void act({
                    type: "suggestion",
                    conversationId: c.id,
                    dismissed: true,
                  }).catch((e) => toast(e.message))
                }
              >
                <X size={14} />
              </button>
            </div>
            <div hidden={!aiOpen}>
              {suggestion.text ? (
                <>
                  <p className="ai-preview">
                    {suggestion.text.replace(/^Dzień dobry,\s*/i, "")}
                  </p>
                  <div className="ai-bottom">
                    <div className="ai-sources">
                      <BookOpen size={12} />
                      {suggestion.sources.map((source) => (
                        <button
                          key={source.id}
                          onClick={() => openKnowledge(source.id)}
                        >
                          {source.title} <span>v{source.version}</span>
                        </button>
                      ))}
                    </div>
                    <button
                      className="button ai-use"
                      onClick={() => {
                        setMode("reply");
                        setComposerOpen(true);
                        setAiOpen(false);
                        setSuggestionRequest({
                          text: suggestion.text,
                          token: Date.now(),
                        });
                      }}
                    >
                      Użyj propozycji <ArrowRight size={13} />
                    </button>
                  </div>
                  {suggestion.needsHuman && (
                    <span className="ai-caution">
                      Wymaga weryfikacji technicznej przed odpowiedzią.
                    </span>
                  )}
                </>
              ) : (
                <p>
                  Brak zatwierdzonej wiedzy dla tej sprawy. Przypisz osobę i
                  skonsultuj temat w komentarzu wewnętrznym.
                </p>
              )}
            </div>
          </div>
        )}
        <div
          className={`composer ${mode === "comment" ? "comment-composer" : ""} ${composerOpen ? "" : "composer-collapsed"}`}
        >
          <div className="composer-tabs">
            <button
              className={composerOpen && mode === "reply" ? "active" : ""}
              aria-expanded={composerOpen && mode === "reply"}
              onClick={() => {
                setMode("reply");
                setComposerOpen(true);
                setWriting(false);
              }}
            >
              <Send size={14} /> Odpowiedź do klienta
              {state.drafts.some(
                (draft) =>
                  draft.key === draftKey(c.id, user.id, "reply") &&
                  draft.text.trim(),
              ) && <span className="draft-indicator">Szkic</span>}
            </button>
            <button
              className={composerOpen && mode === "comment" ? "active" : ""}
              aria-expanded={composerOpen && mode === "comment"}
              onClick={() => {
                setMode("comment");
                setComposerOpen(true);
                setWriting(false);
              }}
            >
              <LockKeyhole size={14} /> Komentarz wewnętrzny
              {state.drafts.some(
                (draft) =>
                  draft.key === draftKey(c.id, user.id, "comment") &&
                  draft.text.trim(),
              ) && <span className="draft-indicator">Szkic</span>}
            </button>
            {c.suggestionDismissed && (
              <button
                className="restore-ai"
                title="Przywróć propozycję AI"
                onClick={() =>
                  void act({
                    type: "suggestion",
                    conversationId: c.id,
                    dismissed: false,
                  }).catch((e) => toast(e.message))
                }
              >
                <Sparkles size={14} />
              </button>
            )}
            {composerOpen && (
              <button
                className="composer-collapse"
                title="Zwiń edytor — zachowaj szkic"
                aria-label="Zwiń edytor"
                onClick={() => {
                  setComposerOpen(false);
                  setWriting(false);
                }}
              >
                <ChevronDown size={15} />
              </button>
            )}
          </div>
          <DraftEditor
            conversation={c}
            mode="reply"
            active={composerOpen && mode === "reply"}
            suggestionRequest={suggestionRequest}
            onWriting={setWriting}
            onAdded={scrollBottom}
          />
          <DraftEditor
            conversation={c}
            mode="comment"
            active={composerOpen && mode === "comment"}
            suggestionRequest={null}
            onWriting={setWriting}
            onAdded={scrollBottom}
          />
        </div>
      </div>
    </article>
  );
}

function DraftEditor({
  conversation,
  mode,
  active,
  suggestionRequest,
  onWriting,
  onAdded,
}: {
  conversation: Conversation;
  mode: ComposerMode;
  active: boolean;
  suggestionRequest: { text: string; token: number } | null;
  onWriting: (value: boolean) => void;
  onAdded: () => void;
}) {
  const { state, user, act, toast, refresh } = useDemo();
  const key = draftKey(conversation.id, user.id, mode);
  const initialDraft = state.drafts.find((d) => d.key === key);
  const [text, setText] = useState(initialDraft?.text ?? "");
  const [baseRevision, setBaseRevision] = useState(
    initialDraft?.basePublicRevision ?? conversation.publicRevision,
  );
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replaceSuggestion, setReplaceSuggestion] = useState<string | null>(
    null,
  );
  const [conflictDraft, setConflictDraft] = useState<Draft | null>(null);
  const [retryRequired, setRetryRequired] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  const baseRef = useRef(baseRevision);
  const savedRef = useRef({
    text,
    base: baseRevision,
    version: initialDraft?.version ?? 0,
  });
  const savingQueue = useRef<Promise<void>>(Promise.resolve());
  const submitted = useRef(false);
  const requestId = useRef<string | null>(null);
  const frozenAction = useRef<Parameters<typeof act>[0] | null>(null);
  const lastSuggestionToken = useRef<number | null>(null);
  const hasNewReply =
    mode === "reply" &&
    text.trim().length > 0 &&
    baseRevision !== conversation.publicRevision;
  const mailbox = state.mailboxes.find((b) => b.id === conversation.mailboxId)!;

  function updateText(value: string) {
    textRef.current = value;
    setText(value);
    setSaveState("saving");
    setError("");
  }
  function updateBase(value: number) {
    baseRef.current = value;
    setBaseRevision(value);
  }

  const flush = useCallback(() => {
    const operation = async () => {
      if (
        savedRef.current.text === textRef.current &&
        savedRef.current.base === baseRef.current
      ) {
        setSaveState("saved");
        return;
      }
      while (
        savedRef.current.text !== textRef.current ||
        savedRef.current.base !== baseRef.current
      ) {
        setSaveState("saving");
        const captured = { text: textRef.current, base: baseRef.current };
        try {
          const result = await act({
            type: "saveDraft",
            conversationId: conversation.id,
            mode,
            text: captured.text,
            basePublicRevision: captured.base,
            expectedVersion: savedRef.current.version,
          });
          const draft = result.drafts.find((d) => d.key === key)!;
          savedRef.current = {
            text: captured.text,
            base: captured.base,
            version: draft.version,
          };
          setSaveState("saved");
        } catch (error) {
          setSaveState("error");
          setError((error as Error).message);
          throw error;
        }
      }
    };
    const pending = savingQueue.current.then(operation, operation);
    savingQueue.current = pending.catch(() => undefined);
    return pending;
  }, [act, conversation.id, key, mode]);

  useEffect(() => {
    if (retryRequired || conflictDraft) return;
    const timeout = setTimeout(() => {
      void flush().catch(() => undefined);
    }, 450);
    return () => clearTimeout(timeout);
  }, [text, baseRevision, flush, retryRequired, conflictDraft]);
  useEffect(
    () => () => {
      void flush().catch(() => undefined);
    },
    [flush],
  );
  useEffect(() => {
    const draft = state.drafts.find((d) => d.key === key);
    if (
      !draft ||
      draft.version <= savedRef.current.version ||
      submitted.current
    )
      return;
    if (textRef.current === savedRef.current.text) {
      savedRef.current = {
        text: draft.text,
        base: draft.basePublicRevision,
        version: draft.version,
      };
      textRef.current = draft.text;
      setText(draft.text);
      baseRef.current = draft.basePublicRevision;
      setBaseRevision(draft.basePublicRevision);
    } else setConflictDraft(draft);
  }, [state.drafts, key]);
  useEffect(() => {
    if (!textRef.current && !submitted.current) {
      baseRef.current = conversation.publicRevision;
      setBaseRevision(conversation.publicRevision);
    }
  }, [conversation.publicRevision]);
  useEffect(() => {
    if (
      !suggestionRequest ||
      mode !== "reply" ||
      suggestionRequest.token === lastSuggestionToken.current
    )
      return;
    lastSuggestionToken.current = suggestionRequest.token;
    if (textRef.current.trim()) setReplaceSuggestion(suggestionRequest.text);
    else {
      textRef.current = suggestionRequest.text;
      setText(suggestionRequest.text);
      textareaRef.current?.focus();
    }
  }, [suggestionRequest, mode]);

  async function submit() {
    if (
      submitted.current ||
      (!text.trim() && !retryRequired) ||
      hasNewReply ||
      conflictDraft
    )
      return;
    submitted.current = true;
    setBusy(true);
    setError("");
    try {
      if (!retryRequired) {
        await flush();
        requestId.current = crypto.randomUUID();
        frozenAction.current =
          mode === "reply"
            ? {
                type: "sendReply",
                conversationId: conversation.id,
                text: textRef.current,
                expectedPublicRevision: baseRef.current,
                draftVersion: savedRef.current.version,
              }
            : {
                type: "addComment",
                conversationId: conversation.id,
                text: textRef.current,
                draftVersion: savedRef.current.version,
              };
      }
      const result = await act(frozenAction.current!, requestId.current!);
      const draft = result.drafts.find((d) => d.key === key);
      const revision = result.conversations.find(
        (c) => c.id === conversation.id,
      )!.publicRevision;
      savedRef.current = {
        text: "",
        base: revision,
        version: draft?.version ?? 0,
      };
      textRef.current = "";
      setText("");
      updateBase(revision);
      setSaveState("saved");
      setRetryRequired(false);
      frozenAction.current = null;
      requestId.current = null;
      toast(
        mode === "reply"
          ? `Odpowiedź zapisana demonstracyjnie z ${mailbox.email}.`
          : "Komentarz wewnętrzny dodany. Widzi go tylko zespół.",
      );
      onWriting(false);
      setTimeout(onAdded, 100);
    } catch (error) {
      if (!(error instanceof ClientError) && frozenAction.current)
        setRetryRequired(true);
      setError((error as Error).message);
      if (error instanceof ClientError && error.code === "NEW_REPLY")
        await refresh();
    } finally {
      submitted.current = false;
      setBusy(false);
    }
  }
  return (
    <div hidden={!active} className="draft-editor">
      <div className="composer-recipient">
        {mode === "reply" ? (
          <>
            <span>Do:</span> {conversation.customer.email}
            <span className="composer-from">z {mailbox.email}</span>
          </>
        ) : (
          <>
            <LockKeyhole size={12} />
            <strong>Tylko zespół</strong>
            <span>Ten komentarz nigdy nie zostanie wysłany do klienta.</span>
          </>
        )}
      </div>
      {mode === "reply" && mailbox.mode !== "demo" && (
        <div className="inline-warning">
          {mailbox.mode === "imap"
            ? "Odbiór IMAP działa. Wysyłanie SMTP nie jest jeszcze podłączone. Możesz zapisać szkic lub dodać komentarz wewnętrzny."
            : "Skrzynka nie jest podłączona. Wysyłanie wiadomości jest niedostępne."}
        </div>
      )}
      {hasNewReply && (
        <div className="inline-warning new-reply-warning">
          <AlertCircle size={16} />
          <div>
            <strong>W rozmowie pojawiła się nowa wiadomość.</strong>
            <p>Przejrzyj najnowszą wiadomość, zanim wyślesz swój szkic.</p>
            <button
              className="text-button"
              onClick={() => {
                onAdded();
                updateBase(conversation.publicRevision);
                setError("");
              }}
            >
              Przejrzałem/am nową wiadomość — kontynuuj
            </button>
          </div>
        </div>
      )}
      {conflictDraft && (
        <div className="inline-warning">
          <strong>Szkic zmienił się w innej karcie tego pracownika.</strong>
          <p>
            Twój tekst pozostaje poniżej. Skopiuj go, jeśli chcesz go zachować.
          </p>
          <button
            className="text-button"
            onClick={() => {
              savedRef.current = {
                text: conflictDraft.text,
                base: conflictDraft.basePublicRevision,
                version: conflictDraft.version,
              };
              updateText(conflictDraft.text);
              updateBase(conflictDraft.basePublicRevision);
              setConflictDraft(null);
              setSaveState("saved");
            }}
          >
            Wczytaj szkic z drugiej karty
          </button>
        </div>
      )}
      {replaceSuggestion !== null && (
        <div className="inline-warning">
          <span>Zastąpić obecny szkic propozycją AI?</span>
          <button
            className="text-button"
            onClick={() => {
              updateText(replaceSuggestion);
              setReplaceSuggestion(null);
            }}
          >
            Zastąp szkic
          </button>
          <button
            className="text-button"
            onClick={() => setReplaceSuggestion(null)}
          >
            Zachowaj mój tekst
          </button>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        disabled={busy || retryRequired}
        aria-label={
          mode === "reply"
            ? "Treść odpowiedzi do klienta"
            : "Treść komentarza wewnętrznego"
        }
        placeholder={
          mode === "reply"
            ? "Napisz odpowiedź lub skorzystaj z propozycji AI…"
            : "Zapytaj zespół, zostaw kontekst lub ustal następny krok…"
        }
        onChange={(e) => {
          updateText(e.target.value);
          onWriting(true);
        }}
        onFocus={() => onWriting(true)}
        onBlur={() => {
          onWriting(false);
          void flush().catch(() => undefined);
        }}
      />
      {error && (
        <div className="editor-error" role="alert">
          {error}
          {!retryRequired && !conflictDraft && (
            <button
              className="text-button"
              onClick={() =>
                void flush()
                  .then(() => setError(""))
                  .catch(() => undefined)
              }
            >
              Ponów zapis szkicu
            </button>
          )}
        </div>
      )}
      <div className="composer-footer">
        <span
          className={`save-status ${saveState === "error" ? "save-error" : ""}`}
        >
          {saveState === "saving" ? (
            <>
              <span className="mini-spinner" /> Zapisuję szkic…
            </>
          ) : saveState === "error" ? (
            <>
              <AlertCircle size={12} /> Szkic niezapisany
            </>
          ) : (
            <>
              <Check size={13} /> Twój szkic zapisany
            </>
          )}
        </span>
        <button
          className={`button ${mode === "reply" ? "primary" : "internal-button"}`}
          disabled={
            busy ||
            (mode === "reply" && mailbox.mode !== "demo") ||
            (!text.trim() && !retryRequired) ||
            hasNewReply ||
            !!conflictDraft
          }
          onClick={() => void submit()}
        >
          {busy ? (
            "Zapisuję…"
          ) : retryRequired ? (
            "Sprawdź i ponów tę samą operację"
          ) : mode === "reply" ? (
            <>
              <Send size={14} />
              {mailbox.mode === "demo" ? "Wyślij demo" : "Wyślij odpowiedź"}
            </>
          ) : (
            <>
              <MessageSquare size={14} />
              Dodaj komentarz
            </>
          )}
        </button>
      </div>
    </div>
  );
}
