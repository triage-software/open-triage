"use client";

import { useRef, useState } from "react";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  History,
  LockKeyhole,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { categories, latestVersion } from "@/lib/types";
import type {
  Category,
  KnowledgeDocument,
  KnowledgeVersion,
} from "@/lib/types";
import { useDemo } from "./demo-context";
import { Avatar, dateTime, relativeTime } from "./ui";

const statusLabels = {
  pending: "Do zatwierdzenia",
  approved: "Zatwierdzony",
  rejected: "Odrzucony",
};

export function KnowledgeView({
  selectedDocumentId,
}: {
  selectedDocumentId: string | null;
}) {
  const { state, openKnowledge, act, toast, capabilities } = useDemo();
  const [mailbox, setMailbox] = useState("all");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [newMailbox, setNewMailbox] = useState(
    state.mailboxes.find((box) => box.id === "test")?.id ??
      state.mailboxes[0]?.id ??
      "",
  );
  const [newCategory, setNewCategory] = useState<Category>("Support");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const docs = state.knowledge.filter(
    (d) =>
      (mailbox === "all" || d.mailboxId === mailbox) &&
      (filter === "all" || latestVersion(d).status === filter) &&
      `${latestVersion(d).title} ${latestVersion(d).body}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selected = state.knowledge.find((d) => d.id === selectedDocumentId);
  const pending = state.knowledge.filter(
    (d) => latestVersion(d).status === "pending",
  ).length;
  return (
    <div className="knowledge-workspace">
      <section className="page-heading">
        <div>
          <div className="eyebrow">DOŚWIADCZENIE ZESPOŁU, W JEDNYM MIEJSCU</div>
          <h1>
            Baza wiedzy
            <span className="heading-count">{state.knowledge.length}</span>
          </h1>
          <p>Z każdej rozmowy może wyniknąć lepsza odpowiedź.</p>
        </div>
        <button
          className="button primary"
          disabled={!capabilities.knowledgeEditing}
          title={
            capabilities.knowledgeEditing
              ? undefined
              : "Tylko administrator może dodawać dokumenty."
          }
          onClick={() => setAdding(true)}
        >
          <Plus size={16} /> Dodaj dokument
        </button>
      </section>
      <div className="knowledge-summary">
        <div>
          <span className="summary-icon purple">
            <BookOpen size={20} />
          </span>
          <div>
            <strong>
              {
                state.knowledge.filter(
                  (d) => latestVersion(d).status === "approved",
                ).length
              }
            </strong>
            <span>Zatwierdzone dokumenty</span>
          </div>
        </div>
        <div>
          <span className="summary-icon amber">
            <Clock3 size={20} />
          </span>
          <div>
            <strong>{pending}</strong>
            <span>Wnioski do przejrzenia</span>
          </div>
        </div>
        <div>
          <span className="summary-icon green">
            <History size={20} />
          </span>
          <div>
            <strong>{state.archiveCount}</strong>
            <span>Archiwa zakończonych rozmów</span>
          </div>
        </div>
      </div>
      <div className="knowledge-controls">
        <div className="segmented-control">
          <button
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            Wszystkie
          </button>
          <button
            className={filter === "pending" ? "active" : ""}
            onClick={() => setFilter("pending")}
          >
            Do zatwierdzenia {pending > 0 && <span>{pending}</span>}
          </button>
          <button
            className={filter === "approved" ? "active" : ""}
            onClick={() => setFilter("approved")}
          >
            Zatwierdzone
          </button>
          <button
            className={filter === "rejected" ? "active" : ""}
            onClick={() => setFilter("rejected")}
          >
            Odrzucone
          </button>
        </div>
        <div className="knowledge-search">
          <select
            aria-label="Skrzynka bazy wiedzy"
            value={mailbox}
            onChange={(e) => setMailbox(e.target.value)}
          >
            <option value="all">Wszystkie skrzynki</option>
            {state.mailboxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <label className="search-field">
            <Search size={15} />
            <input
              aria-label="Szukaj dokumentu"
              placeholder="Szukaj w wiedzy…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
      </div>
      <div className={`knowledge-body ${selected ? "document-open" : ""}`}>
        <div className="document-grid">
          {docs.map((doc) => {
            const version = latestVersion(doc);
            const box = state.mailboxes.find((b) => b.id === doc.mailboxId)!;
            return (
              <button
                key={doc.id}
                className={`document-card ${selectedDocumentId === doc.id ? "selected" : ""}`}
                onClick={() => openKnowledge(doc.id)}
              >
                <div className="document-card-top">
                  <span className="document-icon">
                    <FileText size={22} />
                  </span>
                  <span
                    className={`knowledge-status knowledge-${version.status}`}
                  >
                    {statusLabels[version.status]}
                  </span>
                </div>
                <h3>{version.title}</h3>
                <p>{version.body}</p>
                <div className="document-tags">
                  <span className="category-chip">{doc.category}</span>
                  {doc.conversationId && (
                    <span className="from-conversation">
                      <MessageSquare size={11} /> Z rozmowy
                    </span>
                  )}
                </div>
                <div className="document-card-bottom">
                  <span>
                    <i
                      className="mailbox-dot"
                      style={{ background: box.color }}
                    />
                    {box.name}
                  </span>
                  <small>
                    v{version.version} <span>·</span>{" "}
                    {relativeTime(version.createdAt)}
                  </small>
                </div>
              </button>
            );
          })}
          {!docs.length && (
            <div className="empty-list">
              <BookOpen size={28} />
              <strong>Wiedza potrzebuje chwili.</strong>
              <p>Zakończ rozmowę lub dodaj pierwszy dokument.</p>
            </div>
          )}
        </div>
        {selected && (
          <KnowledgeEditor
            key={`${selected.id}:${state.generation}`}
            document={selected}
            readOnly={!capabilities.knowledgeEditing}
            onClose={() => openKnowledge()}
          />
        )}
        {selectedDocumentId && !selected && (
          <div className="inline-warning">Nie znaleziono dokumentu.</div>
        )}
      </div>
      {adding && (
        <div className="modal-backdrop">
          <form
            className="modal document-modal"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const result = await act({
                  type: "createKnowledge",
                  mailboxId: newMailbox,
                  category: newCategory,
                  title,
                  body,
                });
                setAdding(false);
                setTitle("");
                setBody("");
                openKnowledge(result.knowledge.at(-1)!.id);
                toast("Dokument zapisany. Możesz go teraz zatwierdzić.");
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-doc-title"
          >
            <h2 id="new-doc-title">Nowy dokument</h2>
            <p>
              Przypisz wiedzę do jednej skrzynki. Przed użyciem wymaga
              zatwierdzenia.
            </p>
            <label>
              Tytuł
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Np. Zasady zmiany planu"
              />
            </label>
            <div className="form-row">
              <label>
                Skrzynka
                <select
                  value={newMailbox}
                  onChange={(e) => setNewMailbox(e.target.value)}
                >
                  {state.mailboxes.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kategoria
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as Category)}
                >
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Treść
              <textarea
                required
                maxLength={30000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={7}
                placeholder="Zapisz sprawdzone informacje dla zespołu…"
              />
            </label>
            {error && (
              <p role="alert" className="editor-error">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setAdding(false)}
              >
                Anuluj
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={busy || !title.trim() || !body.trim()}
              >
                Zapisz dokument
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function KnowledgeEditor({
  document,
  readOnly = false,
  onClose,
}: {
  document: KnowledgeDocument;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const { state, user, act, toast, openConversation } = useDemo();
  const latest = latestVersion(document);
  const [title, setTitle] = useState(latest.title);
  const [body, setBody] = useState(latest.body);
  const [base, setBase] = useState(latest.version);
  const [history, setHistory] = useState(false);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const [historical, setHistorical] = useState<KnowledgeVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = state.mailboxes.find((b) => b.id === document.mailboxId)!;
  async function save(status: KnowledgeVersion["status"]) {
    setBusy(true);
    setError("");
    try {
      const result = await act({
        type: "knowledge",
        documentId: document.id,
        expectedVersion: base,
        title,
        body,
        status,
      });
      const version = latestVersion(
        result.knowledge.find((d) => d.id === document.id)!,
      );
      setBase(version.version);
      setTitle(version.title);
      setBody(version.body);
      setHistorical(null);
      toast(
        status === "approved"
          ? "Wiedza zatwierdzona. Może być używana w propozycjach odpowiedzi."
          : status === "rejected"
            ? "Wpis odrzucony. Nie będzie używany w odpowiedziach."
            : "Nowa wersja dokumentu zapisana.",
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="knowledge-editor">
      <header>
        <span>
          <FileText size={17} /> Dokument{" "}
          <span className="version-pill">v{latest.version}</span>
        </span>
        <div>
          <button
            className={`icon-button ${history ? "selected" : ""}`}
            title="Historia wersji"
            onClick={() => {
              setHistory(!history);
              editorScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <History size={17} />
          </button>
          <button
            className="icon-button"
            title="Zamknij dokument"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="knowledge-editor-scroll" ref={editorScrollRef}>
        <div className="document-mailbox">
          <i className="mailbox-dot" style={{ background: box.color }} />
          {box.name}
          <span className={`knowledge-status knowledge-${latest.status}`}>
            {statusLabels[latest.status]}
          </span>
        </div>
        {document.conversationId && (
          <button
            className="source-conversation"
            onClick={() => openConversation(document.conversationId!)}
          >
            <MessageSquare size={14} /> Otwórz rozmowę źródłową{" "}
            <ArrowRight size={13} />
          </button>
        )}
        {latest.version !== base && (
          <div className="inline-warning">
            <strong>Pojawiła się nowa wersja dokumentu.</strong>
            <p>Twoje zmiany pozostają w edytorze.</p>
            <button
              className="text-button"
              onClick={() => {
                setBase(latest.version);
                setTitle(latest.title);
                setBody(latest.body);
                setError("");
              }}
            >
              Wczytaj aktualną wersję
            </button>
          </div>
        )}
        {history && (
          <div className="version-history">
            <h3>Historia dokumentu</h3>
            {[...document.versions].reverse().map((v) => (
              <button
                key={v.version}
                className={historical?.version === v.version ? "active" : ""}
                onClick={() => setHistorical(v)}
              >
                <span className="version-pill">v{v.version}</span>
                <div>
                  <strong>
                    {state.users.find((u) => u.id === v.userId)?.name}
                  </strong>
                  <span>
                    {dateTime(v.createdAt)} · {statusLabels[v.status]}
                  </span>
                </div>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        )}
        {historical ? (
          <div className="historical-preview">
            <div>
              <span className="eyebrow">
                PODGLĄD WERSJI {historical.version}
              </span>
              <button
                className="text-button"
                onClick={() => setHistorical(null)}
              >
                Wróć do edycji
              </button>
            </div>
            <h2>{historical.title}</h2>
            <p>{historical.body}</p>
            <button
              className="button"
              disabled={readOnly}
              onClick={() => {
                setTitle(historical.title);
                setBody(historical.body);
                setBase(latest.version);
                setHistorical(null);
              }}
            >
              Użyj treści tej wersji
            </button>
          </div>
        ) : (
          <>
            <label className="document-field">
              Tytuł
              <input
                aria-label="Tytuł dokumentu"
                value={title}
                maxLength={200}
                readOnly={readOnly}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="document-field">
              Treść dokumentu
              <textarea
                aria-label="Treść dokumentu"
                value={body}
                maxLength={30000}
                readOnly={readOnly}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
          </>
        )}
        <div className="knowledge-guidance">
          <Sparkles size={15} />
          <p>
            Podpowiedzi korzystają tylko z zatwierdzonej wiedzy tej skrzynki.
            Komentarze wewnętrzne pozostają poza bazą odpowiedzi.
          </p>
        </div>
        {error && (
          <div className="editor-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <footer>
        <button
          className="text-button reject"
          disabled={readOnly || busy || !!historical || base !== latest.version}
          onClick={() => void save("rejected")}
        >
          Odrzuć
        </button>
        <button
          className="button"
          disabled={
            readOnly ||
            busy ||
            !!historical ||
            base !== latest.version ||
            !title.trim() ||
            !body.trim()
          }
          onClick={() => void save("pending")}
        >
          Zapisz wersję
        </button>
        <button
          className="button primary"
          disabled={
            readOnly ||
            busy ||
            !!historical ||
            base !== latest.version ||
            !title.trim() ||
            !body.trim()
          }
          onClick={() => void save("approved")}
        >
          <Check size={14} /> Zatwierdź
        </button>
      </footer>
    </section>
  );
}

export function NotificationsView() {
  const { state, user, act, toast, openConversation } = useDemo();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [selectedId, setSelectedId] = useState(state.notifications[0]?.id);
  const notifications = state.notifications.filter(
    (n) => !onlyUnread || !n.readBy.includes(user.id),
  );
  const selected =
    state.notifications.find((n) => n.id === selectedId) ?? notifications[0];
  const conversation = state.conversations.find(
    (c) => c.id === selected?.conversationId,
  );
  const mailbox = state.mailboxes.find((b) => b.id === conversation?.mailboxId);
  const unreadCount = state.notifications.filter(
    (n) => !n.readBy.includes(user.id),
  ).length;
  return (
    <div className="notifications-workspace">
      <section className="page-heading">
        <div>
          <span className="eyebrow">WAŻNE SPRAWY NIE UMYKAJĄ</span>
          <h1>
            Powiadomienia
            {unreadCount > 0 && (
              <span className="heading-count">{unreadCount}</span>
            )}
          </h1>
          <p>Przypisania, pilne zgłoszenia i sprawy wymagające Twojej uwagi.</p>
        </div>
        <button
          className="button"
          disabled={!unreadCount}
          onClick={() =>
            void act({
              type: "readNotifications",
              notificationIds: state.notifications.map((n) => n.id),
            })
              .then(() => toast("Powiadomienia oznaczone jako przeczytane."))
              .catch((e) => toast(e.message))
          }
        >
          <CheckCheck size={15} /> Oznacz jako przeczytane
        </button>
      </section>
      <div className="notification-layout">
        <section className="notifications-list">
          <div className="segmented-control">
            <button
              className={!onlyUnread ? "active" : ""}
              onClick={() => setOnlyUnread(false)}
            >
              Wszystkie
            </button>
            <button
              className={onlyUnread ? "active" : ""}
              onClick={() => setOnlyUnread(true)}
            >
              Nieprzeczytane <span>{unreadCount}</span>
            </button>
          </div>
          {notifications.map((n) => (
            <article
              className={`notification-item ${n.readBy.includes(user.id) ? "read" : ""} ${selected?.id === n.id ? "selected" : ""}`}
              key={n.id}
            >
              <span className={`notification-type notification-${n.type}`}>
                {n.type === "urgent" ? (
                  <Bell size={18} />
                ) : n.type === "assignment" ? (
                  <Avatar user={user} size="small" />
                ) : (
                  <MessageSquare size={18} />
                )}
              </span>
              <div>
                <div className="notification-title">
                  <h3>{n.title}</h3>
                  {!n.readBy.includes(user.id) && (
                    <span className="unread-dot" />
                  )}
                </div>
                <p>{n.body}</p>
                <span className="notification-time">
                  {dateTime(n.createdAt)}
                </span>
                <div className="notification-actions">
                  <button
                    className="text-button"
                    onClick={() => {
                      void act({
                        type: "readNotifications",
                        notificationIds: [n.id],
                      }).catch((e) => toast(e.message));
                      openConversation(n.conversationId);
                    }}
                  >
                    Otwórz rozmowę <ArrowRight size={12} />
                  </button>
                  <button
                    className="text-button muted"
                    onClick={() => setSelectedId(n.id)}
                  >
                    Podgląd na czacie
                  </button>
                  {!n.readBy.includes(user.id) && (
                    <button
                      className="icon-button"
                      title="Oznacz jako przeczytane"
                      onClick={() =>
                        void act({
                          type: "readNotifications",
                          notificationIds: [n.id],
                        }).catch((e) => toast(e.message))
                      }
                    >
                      <Check size={14} />
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
          {!notifications.length && (
            <div className="empty-list">
              <CheckCheck size={32} />
              <strong>Wszystko na bieżąco.</strong>
              <p>Nie masz nieprzeczytanych powiadomień.</p>
            </div>
          )}
        </section>
        <aside className="notification-preview">
          <span className="eyebrow">WKRÓTCE TAKŻE TAM, GDZIE JEST ZESPÓŁ</span>
          <h2>Powiadomienia na czacie</h2>
          <p>
            Podglądy pokazują przyszły wygląd integracji. Demo nie wysyła
            wiadomości do zewnętrznych usług.
          </p>
          {selected && (
            <>
              {["Google Chat", "Discord"].map((channel, i) => (
                <div key={channel} className={`chat-preview chat-${i}`}>
                  <div className="chat-preview-header">
                    <span className="channel-icon">
                      <MessageSquare size={17} />
                    </span>
                    <strong>{channel}</strong>
                    <span>PODGLĄD</span>
                  </div>
                  <div className="chat-preview-body">
                    <div className="bot-header">
                      <span className="bot-avatar">o.</span>
                      <strong>Open Triage</strong>
                      <span>APP</span>
                      <time>
                        {new Date(selected.createdAt).toLocaleTimeString(
                          "pl-PL",
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                      </time>
                    </div>
                    <div className="chat-embed">
                      <span className="chat-priority">
                        {selected.type === "urgent"
                          ? "PILNE ZGŁOSZENIE"
                          : selected.type === "assignment"
                            ? "PRZYPISANIE SPRAWY"
                            : "POTRZEBNA POMOC ZESPOŁU"}
                      </span>
                      <h3>{selected.title}</h3>
                      <p>{selected.body}</p>
                      <span>
                        {mailbox?.name} · #{conversation?.number}
                      </span>
                      <button
                        onClick={() =>
                          openConversation(selected.conversationId)
                        }
                      >
                        Otwórz rozmowę <ExternalLink size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
          <div className="preview-note">
            <LockKeyhole size={14} />
            <span>Pełny kontekst i komentarze pozostają w panelu.</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
