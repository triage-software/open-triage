"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownWideNarrow,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Command,
  Inbox,
  LayoutGrid,
  ListFilter,
  Mail,
  MessageSquare,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { categories, priorities, statuses } from "@/lib/types";
import type { Conversation, Variant } from "@/lib/types";
import { isActiveUser } from "@/lib/team";
import {
  DemoContext,
  demoCapabilities,
  useDemo,
  useDemoAi,
  useDemoData,
  type WorkspaceAi,
  type WorkspaceCapabilities,
  type WorkspaceData,
} from "./demo-context";
import { Avatar, PriorityBadge, relativeTime, TriageMark } from "./ui";
import { ConversationDetail } from "./conversation-detail";
import { KnowledgeView, NotificationsView } from "./workspace-views";
import { AiSettingsView } from "./ai-settings-view";

const variants: Variant[] = ["inbox", "queue", "board"];
const variantLabels = { inbox: "Skrzynka", queue: "Kolejka", board: "Tablica" };

/** Session identity shown in place of the demo user switcher (API mode). */
export interface WorkspaceIdentity {
  name: string;
  email: string;
  role: string;
  logoutLabel: string;
  onLogout: () => void;
}

export function SupportApp() {
  const data = useDemoData();
  const ai = useDemoAi(data);
  return (
    <SupportWorkspace data={data} ai={ai} capabilities={demoCapabilities} />
  );
}

export function SupportWorkspace({
  data,
  ai,
  capabilities,
  identity,
}: {
  data: WorkspaceData;
  ai: WorkspaceAi;
  capabilities: WorkspaceCapabilities;
  identity?: WorkspaceIdentity;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const variant = variants.includes(params.get("variant") as Variant)
    ? (params.get("variant") as Variant)
    : "inbox";
  const view = params.get("view") ?? "inbox";
  const selectedId = params.get("conversation");
  const [mailbox, setMailbox] = useState("all");
  const [search, setSearch] = useState("");
  const [assignee, setAssignee] = useState("all");
  const [status, setStatus] = useState("active");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const user =
    data.state?.users.find((u) => u.id === data.userId) ?? data.state?.users[0];
  const updateUrl = useCallback(
    (changes: Record<string, string | null>, hash = "") => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes))
        if (value === null) next.delete(key);
        else next.set(key, value);
      const query = next.toString();
      // Preserve the current path so the shell serves both /prototype/support
      // and the authenticated root workspace.
      router.replace(`${window.location.pathname}${query ? `?${query}` : ""}${hash}`, {
        scroll: false,
      });
    },
    [params, router],
  );
  const openConversation = useCallback(
    async (id: string, commentId?: string) => {
      const conversation = data.state?.conversations.find((c) => c.id === id);
      if (conversation) setMailbox(conversation.mailboxId);
      if (!conversation?.comments.length && data.loadConversation)
        await data.loadConversation(id).catch(() => undefined);
      updateUrl(
        { view: "inbox", conversation: id, document: null },
        commentId ? `#comment-${commentId}` : "",
      );
      setSidebarOpen(false);
    },
    [data.state?.conversations, data.loadConversation, updateUrl],
  );
  const openKnowledge = useCallback(
    (id?: string) => {
      updateUrl({ view: "knowledge", document: id ?? null });
    },
    [updateUrl],
  );
  const selected = data.state?.conversations.find((c) => c.id === selectedId);
  const openSettings = useCallback(() => updateUrl({ view: "settings" }), [updateUrl]);
  useEffect(() => {
    if (selectedId && data.state) {
      const conversation = data.state.conversations.find(
        (c) => c.id === selectedId,
      );
      if (conversation) setMailbox(conversation.mailboxId);
    }
    // Resolve deep links once per conversation; users can subsequently browse any folder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.mailboxId, !!data.state]);
  const filtered = useMemo(
    () =>
      (data.state?.conversations ?? [])
        .filter((c) => {
          return (
            (mailbox === "all" || c.mailboxId === mailbox) &&
            (assignee === "all" ||
              (assignee === "unassigned"
                ? c.assigneeId === null
                : c.assigneeId === assignee)) &&
            (status === "all" ||
              (status === "active"
                ? c.status !== "Zakończone"
                : c.status === status)) &&
            (priority === "all" || c.priority === priority) &&
            (category === "all" || c.category === category) &&
            (!search ||
              `${c.subject} ${c.customer.name} ${c.customer.email} ${c.number} ${c.emails.map((e) => e.body).join(" ")}`
                .toLocaleLowerCase("pl")
                .includes(search.toLocaleLowerCase("pl")))
          );
        })
        .sort(
          (a, b) =>
            priorities.indexOf(a.priority) - priorities.indexOf(b.priority) ||
            b.updatedAt.localeCompare(a.updatedAt),
        ),
    [
      data.state?.conversations,
      mailbox,
      assignee,
      status,
      priority,
      category,
      search,
    ],
  );
  const changeVariant = useCallback(
    (next: Variant) =>
      updateUrl(
        { variant: next },
        typeof window !== "undefined" ? window.location.hash : "",
      ),
    [updateUrl],
  );
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        (event.target as HTMLElement).closest(
          "input, textarea, select, [contenteditable], [role=dialog]",
        )
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        changeVariant(
          variants[
            (variants.indexOf(variant) + (event.key === "ArrowRight" ? 1 : 2)) %
              3
          ],
        );
      }
      if (event.key === "Escape") setSidebarOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, changeVariant]);

  if (!data.state || !user)
    return (
      <div className="boot-screen">
        <div className="brand-symbol">
          <TriageMark size={25} />
        </div>
        <h1>Open Triage</h1>
        <p>{data.error || "Przygotowujemy wspólną skrzynkę…"}</p>
        {data.error && (
          <button
            className="button primary"
            onClick={() => void data.refresh()}
          >
            Spróbuj ponownie
          </button>
        )}
      </div>
    );
  const state = data.state;
  const members = state.users.filter(isActiveUser);
  const active = state.conversations.filter((c) => c.status !== "Zakończone");
  const selectedMailbox = state.mailboxes.find((box) => box.id === mailbox);
  const unread = state.notifications.filter(
    (n) => !n.readBy.includes(user.id),
  ).length;
  const title =
    view === "settings" ? "Ustawienia" : view === "knowledge"
      ? "Baza wiedzy"
      : view === "notifications"
        ? "Powiadomienia"
        : mailbox === "all"
          ? "Wszystkie skrzynki"
          : state.mailboxes.find((b) => b.id === mailbox)?.name;
  const pendingKnowledge = state.knowledge.filter(
    (d) => d.versions.at(-1)?.status === "pending",
  ).length;
  function clearFilters() {
    setSearch("");
    setAssignee("all");
    setStatus("active");
    setPriority("all");
    setCategory("all");
  }

  return (
      <DemoContext.Provider
        value={{
          state,
          user,
          sessionId: data.sessionId,
          act: data.act,
          refresh: data.refresh,
          toast: data.toast,
          openConversation,
          openKnowledge,
          openSettings,
          capabilities,
          ai,
        }}
      >
      <div className="app-shell">
        {sidebarOpen && (
          <button
            className="sidebar-scrim"
            aria-label="Zamknij menu"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
          <a className="brand" href={identity ? "/" : "/prototype/support"}>
            <span className="brand-symbol">
              <TriageMark size={20} />
            </span>
            <span>
              open<span className="brand-light">triage</span>
              <span className="brand-dot">.</span>
            </span>
          </a>
          <div className="workspace-label">
            <span className="workspace-icon">W</span>
            <div>
              <strong>Wspólna przestrzeń</strong>
              <small>Twój zespół · {members.length} osoby</small>
            </div>
            <ChevronDown size={14} />
          </div>
          <div className="nav-section-label">PRZESTRZEŃ ROBOCZA</div>
          <nav className="main-nav" aria-label="Nawigacja główna">
            <button
              className={
                view === "inbox" && mailbox === "all" && assignee === "all"
                  ? "nav-active"
                  : ""
              }
              onClick={() => {
                setMailbox("all");
                clearFilters();
                updateUrl({ view: "inbox", conversation: null });
              }}
            >
              <Inbox size={17} />
              <span>Wszystkie skrzynki</span>
              <span className="nav-count">{active.length}</span>
            </button>
            <button
              className={
                view === "inbox" && assignee === user.id ? "nav-active" : ""
              }
              onClick={() => {
                clearFilters();
                setAssignee(user.id);
                setMailbox("all");
                updateUrl({ view: "inbox", conversation: null });
              }}
            >
              <Users size={17} />
              <span>Przypisane do mnie</span>
              <span className="plain-count">
                {active.filter((c) => c.assigneeId === user.id).length}
              </span>
            </button>
            <button
              className={view === "notifications" ? "nav-active" : ""}
              onClick={() => updateUrl({ view: "notifications" })}
            >
              <Bell size={17} />
              <span>Powiadomienia</span>
              {unread > 0 && (
                <span className="notification-count">{unread}</span>
              )}
            </button>
            <button
              className={view === "knowledge" ? "nav-active" : ""}
              onClick={() => openKnowledge()}
            >
              <BookOpen size={17} />
              <span>Baza wiedzy</span>
              {pendingKnowledge > 0 && (
                <span className="plain-count">{pendingKnowledge}</span>
              )}
            </button>
            <button className={view === "settings" ? "nav-active" : ""} onClick={openSettings}>
              <Settings size={17} /><span>Ustawienia</span>
            </button>
          </nav>
          <div className="nav-section-label mailbox-heading">
            SKRZYNKI <span>{state.mailboxes.length}</span>
          </div>
          <nav className="mailbox-nav" aria-label="Skrzynki">
            {state.mailboxes.map((box) => (
              <button
                key={box.id}
                title={`${box.email} · ${box.description}`}
                className={
                  mailbox === box.id && view === "inbox" ? "mailbox-active" : ""
                }
                onClick={() => {
                  setMailbox(box.id);
                  clearFilters();
                  updateUrl({ view: "inbox", conversation: null });
                }}
              >
                <span
                  className="mailbox-dot"
                  style={{ background: box.color }}
                />
                <span className="mailbox-nav-label">
                  <span>{box.email}</span>
                  <small>
                    {state.mailSync?.[box.id]?.status === "error"
                      ? "Błąd odbioru"
                      : state.mailSync?.[box.id]?.status === "syncing"
                        ? "Pobieranie…"
                        : box.mode === "imap" ? "IMAP · połączona"
                          : box.mode === "demo" ? "Demo" : "Niepodłączona"}
                  </small>
                </span>
                {box.mode !== "unconnected" && (
                  <small>
                    {active.filter((c) => c.mailboxId === box.id).length}
                  </small>
                )}
              </button>
            ))}
          </nav>
          <div className="team-sidebar">
            <div className="nav-section-label">
              TWÓJ ZESPÓŁ{" "}
              <span>
                {new Set(state.presence.map((p) => p.userId)).size} online
              </span>
            </div>
            <div className="team-avatars">
              {members.slice(0, 5).map((u) => (
                <span key={u.id} className="team-avatar">
                  <Avatar user={u} size="small" />
                  {state.presence.some((p) => p.userId === u.id) && <i />}
                </span>
              ))}
              {members.length > 5 && (
                <span className="team-more">+{members.length - 5}</span>
              )}
            </div>
          </div>
          <div className="sidebar-bottom">
            {!identity && (
              <>
                <div className="demo-card">
                  <span className="demo-spark">
                    <Sparkles size={17} />
                  </span>
                  <strong>Miejsce na spokojniejszy support</strong>
                  <p>Wspólna wiedza. Lepsze odpowiedzi. Mniej przełączania.</p>
                  <span className="demo-label">
                    <span /> Lokalny panel
                  </span>
                </div>
                <button className="help-button" onClick={() => setHelpOpen(true)}>
                  <CircleHelp size={16} /> Jak działa demo?{" "}
                  <ArrowUpRight size={14} />
                </button>
              </>
            )}
            {identity ? (
              <div className="user-picker">
                <Avatar user={user} size="small" />
                <div>
                  <label>{identity.role}</label>
                  <strong className="session-user-name" title={identity.email}>
                    {identity.name}
                  </strong>
                  <button
                    type="button"
                    className="session-logout"
                    onClick={identity.onLogout}
                  >
                    {identity.logoutLabel}
                  </button>
                </div>
              </div>
            ) : (
              data.selectUser && (
                <div className="user-picker">
                  <Avatar user={user} size="small" />
                  <div>
                    <label htmlFor="demo-user">Pracujesz jako</label>
                    <select
                      id="demo-user"
                      value={user.id}
                      onChange={(e) => data.selectUser!(e.target.value)}
                    >
                      {members.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            )}
          </div>
        </aside>
        <main
          className={`main-workspace ${view === "inbox" ? "mail-workspace" : ""}`}
        >
          <header className="topbar">
            <div className="breadcrumbs">
              <button
                className="icon-button sidebar-toggle"
                title="Otwórz menu"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                <PanelLeftClose size={18} />
              </button>
              {view === "inbox" ? (
                <div className="workspace-title">
                  <h1>{title}</h1>
                  <span className="heading-count">{filtered.length}</span>
                </div>
              ) : (
                <>
                  <span>Przestrzeń robocza</span>
                  <span className="breadcrumb-slash">/</span>
                  <strong>{title}</strong>
                </>
              )}
            </div>
            {view === "inbox" && (
              <div className="heading-actions">
                <div className="mini-stat">
                  <span className="stat-dot coral" />
                  <strong>
                    {active.filter((c) => c.priority === "Krytyczny").length}
                  </strong>
                  <span>pilne sprawy</span>
                </div>
                <button
                  className="button subtle"
                  onClick={() => {
                    clearFilters();
                    setMailbox("all");
                    setAssignee("unassigned");
                    updateUrl({ conversation: null });
                  }}
                >
                  <Users size={15} /> Do przypisania{" "}
                  <span>{active.filter((c) => !c.assigneeId).length}</span>
                </button>
              </div>
            )}
            <div className="topbar-right">
              <span className={`connection ${data.connected ? "" : "offline"}`}>
                <i />
                {data.connected ? "Zmiany zsynchronizowane" : "Brak połączenia"}
              </span>
              <span className="topbar-divider" />
              {!identity && (
                <span
                  className="top-demo"
                  title="Lokalny panel · wspólna skrzynka IMAP i SMTP"
                >
                  LOKALNIE
                </span>
              )}
            </div>
          </header>
          {!data.connected && (
            <div className="connection-banner" role="alert">
              {data.error} · Trwa ponowne łączenie. Szkice pozostają w edytorze.
            </div>
          )}
          {view === "inbox" ? (
            <>
              <div className="workspace-toolbar">
                <div
                  className="view-tabs"
                  role="tablist"
                  aria-label="Układ panelu"
                >
                  {variants.map((v) => {
                    const Icon =
                      v === "inbox"
                        ? Inbox
                        : v === "queue"
                          ? ArrowDownWideNarrow
                          : LayoutGrid;
                    return (
                      <button
                        role="tab"
                        aria-selected={variant === v}
                        className={variant === v ? "active" : ""}
                        key={v}
                        onClick={() => changeVariant(v)}
                      >
                        <Icon size={15} />
                        {variantLabels[v]}
                      </button>
                    );
                  })}
                </div>
                <div className="toolbar-controls">
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Szukaj rozmowy…"
                      aria-label="Szukaj rozmowy"
                    />
                    <span>⌕</span>
                  </label>
                  <button
                    className={`button filter-button ${showFilters ? "selected" : ""}`}
                    onClick={() => setShowFilters(!showFilters)}
                  >
                    <SlidersHorizontal size={15} /> Filtry
                    {(priority !== "all" ||
                      category !== "all" ||
                      assignee !== "all" ||
                      status !== "active") && <span className="filter-dot" />}
                  </button>
                </div>
              </div>
              {showFilters && (
                <div className="filter-row">
                  <label>
                    Status
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="active">Aktywne</option>
                      <option value="all">Wszystkie</option>
                      {statuses.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Priorytet
                    <select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                    >
                      <option value="all">Wszystkie</option>
                      {priorities.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Kategoria
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="all">Wszystkie</option>
                      {categories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Osoba
                    <select
                      value={assignee}
                      onChange={(e) => setAssignee(e.target.value)}
                    >
                      <option value="all">Wszyscy</option>
                      <option value="unassigned">Nieprzypisane</option>
                      {members.map((u) => (
                        <option value={u.id} key={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="text-button" onClick={clearFilters}>
                    Wyczyść
                  </button>
                </div>
              )}
              {capabilities.mailCheck && (
                <MailboxSyncNotice mailboxId={selectedMailbox?.id} />
              )}
              <div className={`conversation-workspace variant-${variant}`}>
                {variant === "inbox" ? (
                  <div className="inbox-list">
                    <div className="list-caption">
                      <span>
                        {status === "active"
                          ? "Aktywne rozmowy"
                          : status === "all"
                            ? "Wszystkie rozmowy"
                            : status}{" "}
                        <small>{filtered.length}</small>
                      </span>
                      <ArrowDownWideNarrow size={14} />
                    </div>
                    {filtered.length ? (
                      filtered.map((c) => (
                        <ConversationCard
                          key={c.id}
                          conversation={c}
                          selected={selectedId === c.id}
                        />
                      ))
                    ) : (
                      <EmptyList />
                    )}
                  </div>
                ) : variant === "queue" ? (
                  <QueueView conversations={filtered} selectedId={selectedId} />
                ) : (
                  <BoardView conversations={filtered} selectedId={selectedId} />
                )}
                {(variant === "inbox" || selectedId) && (
                  <div
                    className={`detail-container ${variant !== "inbox" ? "detail-drawer" : ""}`}
                  >
                    {selected ? (
                      <ConversationDetail
                        key={`${selected.id}:${user.id}:${state.generation}`}
                        conversation={selected}
                        onClose={() => updateUrl({ conversation: null })}
                      />
                    ) : selectedId ? (
                      <div className="empty-detail">
                        <CircleHelp size={30} />
                        <h2>Nie znaleziono rozmowy</h2>
                        <p>Link może pochodzić z wcześniejszych danych demo.</p>
                        <button
                          className="button"
                          onClick={() => updateUrl({ conversation: null })}
                        >
                          Wróć do listy
                        </button>
                      </div>
                    ) : (
                      <div className="empty-detail">
                        <div className="empty-illustration">
                          <Mail size={34} />
                          <span>
                            <Check size={15} />
                          </span>
                        </div>
                        <span className="eyebrow">
                          MNIEJ CHAOSU. WIĘCEJ ROZMOWY.
                        </span>
                        <h2>Wszystko na swoim miejscu.</h2>
                        <p>
                          Wybierz rozmowę, by poznać kontekst,
                          <br />
                          zaprosić zespół i przygotować odpowiedź.
                        </p>
                        <div className="empty-features">
                          <span>
                            <Sparkles size={14} /> Wsparcie AI
                          </span>
                          <span>
                            <Users size={14} /> Razem z zespołem
                          </span>
                        </div>
                        {filtered[0] && (
                          <button
                            className="button primary"
                            onClick={() => openConversation(filtered[0].id)}
                          >
                            Otwórz pierwszą rozmowę <ArrowRight size={15} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : view === "knowledge" ? (
            <KnowledgeView selectedDocumentId={params.get("document")} />
          ) : view === "settings" ? (
            <AiSettingsView />
          ) : (
            <NotificationsView />
          )}
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={13} /> Lokalny zapis · wspólna skrzynka zespołu
            </span>
            <span>
              Open Triage <span className="footer-dot">·</span> Twój zespół,
              jedna przestrzeń
            </span>
          </footer>
        </main>
        {data.toastMessage && (
          <div className="toast" role="status">
            <CheckCheck size={17} />
            {data.toastMessage}
          </div>
        )}
        {helpOpen && (
          <div className="modal-backdrop">
            <section
              className="modal help-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="help-title"
            >
              <button
                className="icon-button modal-close"
                aria-label="Zamknij pomoc"
                onClick={() => setHelpOpen(false)}
              >
                <X size={18} />
              </button>
              <span className="modal-icon">
                <Sparkles size={22} />
              </span>
              <h2 id="help-title">Poznaj swój spokojniejszy support.</h2>
              <p>
                To lokalny panel. Skrzynka support@opentriage.com odbiera prawdziwe
                maile przez IMAP, co 30 sekund. Skrzynki hello@opentriage.com i
                help@opentriage.com czekają na podłączenie. Odpowiedzi są wysyłane
                z support@opentriage.com, z kopią w folderze Wysłane wspólnej skrzynki.
                Wiadomości demo nie są tworzone ponownie.
              </p>
              <ol>
                <li>Wybierz układ: skrzynkę, kolejkę albo tablicę.</li>
                <li>Otwórz rozmowę, przypisz osobę i przygotuj odpowiedź.</li>
                <li>
                  Przełącz edytor na komentarz wewnętrzny, aby porozmawiać z
                  zespołem.
                </li>
                <li>
                  Otwórz drugą kartę i wybierz innego pracownika na dole menu —
                  zobaczysz wspólną pracę.
                </li>
                <li>Zakończ rozmowę i sprawdź propozycję w bazie wiedzy.</li>
              </ol>
              <button
                className="button primary"
                onClick={() => setHelpOpen(false)}
              >
                Zaczynamy <ArrowRight size={15} />
              </button>
            </section>
          </div>
        )}
      </div>
    </DemoContext.Provider>
  );
}

function EmptyList() {
  return (
    <div className="empty-list">
      <ListFilter size={25} />
      <strong>Tu jest spokojnie</strong>
      <p>Żadna rozmowa nie pasuje do filtrów.</p>
    </div>
  );
}

function ConversationCard({
  conversation: c,
  selected,
  board = false,
}: {
  conversation: Conversation;
  selected: boolean;
  board?: boolean;
}) {
  const { state, openConversation } = useDemo();
  const box = state.mailboxes.find((b) => b.id === c.mailboxId)!;
  const owner = state.users.find((u) => u.id === c.assigneeId);
  const presence = [
    ...new Set(
      state.presence
        .filter((p) => p.conversationId === c.id)
        .map((p) => p.userId),
    ),
  ];
  return (
    <button
      className={`conversation-card ${selected ? "conversation-selected" : ""} ${board ? "board-card" : ""}`}
      onClick={() => openConversation(c.id)}
    >
      <div className="card-top">
        <span className="card-customer">
          <Avatar name={c.customer.name} size="tiny" color={box.color} />
          <strong>{c.customer.name}</strong>
          {c.status === "Nowe" && <i className="unread-dot" />}
        </span>
        <time>{relativeTime(c.updatedAt)}</time>
      </div>
      <h3>{c.subject}</h3>
      <p className="card-preview">
        {c.emails.at(-1)?.body.replace(/Dzień dobry,\s*/i, "")}
      </p>
      <div className="card-tags">
        <span className="category-chip">{c.category}</span>
        <PriorityBadge priority={c.priority} />
      </div>
      <div className="card-bottom">
        <span className="card-mailbox">
          <i style={{ background: box.color }} />
          {box.name}
        </span>
        <span className="card-meta">
          {c.comments.length > 0 && (
            <span title={`${c.comments.length} komentarzy wewnętrznych`}>
              <MessageSquare size={12} />
              {c.comments.length}
            </span>
          )}
          {presence.length > 0 && (
            <span className="card-presence" title="Osoby w rozmowie">
              <span />
              {presence.length}
            </span>
          )}
          {owner ? (
            <Avatar user={owner} size="tiny" />
          ) : (
            <span className="unassigned-avatar" title="Nieprzypisane">
              <Users size={11} />
            </span>
          )}
        </span>
      </div>
    </button>
  );
}
function QueueView({
  conversations,
  selectedId,
}: {
  conversations: Conversation[];
  selectedId: string | null;
}) {
  const { state, openConversation } = useDemo();
  return (
    <div className="queue-view">
      <div className="queue-intro">
        <div>
          <span className="eyebrow">NAJPIERW TO, CO WAŻNE</span>
          <h2>Twoja kolejka na dziś</h2>
        </div>
        <span>{conversations.length} rozmów</span>
      </div>
      {conversations.length === 0 && <EmptyList />}
      {priorities.map((priority) => {
        const group = conversations.filter((c) => c.priority === priority);
        if (!group.length) return null;
        return (
          <section className="queue-group" key={priority}>
            <h3>
              <PriorityBadge priority={priority} />
              <span>{group.length}</span>
            </h3>
            {group.map((c) => (
              <button
                className={`queue-row ${selectedId === c.id ? "selected" : ""}`}
                key={c.id}
                onClick={() => openConversation(c.id)}
              >
                <span className="ticket-number">#{c.number}</span>
                <div className="queue-main">
                  <strong>{c.subject}</strong>
                  <span>
                    {c.customer.name} <i>·</i>{" "}
                    {state.mailboxes.find((b) => b.id === c.mailboxId)?.name}
                  </span>
                </div>
                <span className="category-chip">{c.category}</span>
                <span className="queue-status">{c.status}</span>
                {c.assigneeId ? (
                  <Avatar
                    user={state.users.find((u) => u.id === c.assigneeId)}
                    size="small"
                  />
                ) : (
                  <span className="unassigned-avatar">
                    <Users size={13} />
                  </span>
                )}
                <time>{relativeTime(c.updatedAt)}</time>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}
function MailboxSyncNotice({ mailboxId }: { mailboxId?: string }) {
  const { state, refresh, toast } = useDemo();
  const [busy, setBusy] = useState(false);
  const mailbox = state.mailboxes.find((box) => box.id === (mailboxId ?? "test"));
  const sync = state.mailSync?.test;
  if (mailboxId && mailboxId !== "test") return (
    <div className="mailbox-notice" role="status">
      <Mail size={16} />
      <span><strong>{mailbox?.email}</strong> — ta skrzynka czeka na podłączenie poczty.</span>
    </div>
  );
  async function checkMail() {
    setBusy(true);
    try {
      const response = await fetch("/api/mail/sync", { method: "POST" });
      const result = await response.json();
      await refresh();
      if (!response.ok) throw new Error(result.error || "Sprawdź konfigurację IMAP w .env.local.");
      toast("Skrzynka support@opentriage.com jest aktualna.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Nie można sprawdzić poczty.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mailbox-notice" role="status">
      <Mail size={16} />
      <span>
        <strong>support@opentriage.com</strong> — {sync?.status === "connected"
          ? `IMAP połączony · co 30 s · ostatnio ${new Date(sync.lastSuccessAt!).toLocaleTimeString("pl-PL")}`
          : sync?.status === "syncing" ? "Pobieranie poczty…"
            : sync?.status === "error" ? sync.error
              : "Oczekuje na konfigurację IMAP."}
      </span>
      <button className="text-button" disabled={busy || sync?.status === "syncing"} onClick={() => void checkMail()}>
        <RefreshCw size={13} /> {busy ? "Sprawdzanie…" : "Sprawdź pocztę"}
      </button>
    </div>
  );
}

function BoardView({
  conversations,
  selectedId,
}: {
  conversations: Conversation[];
  selectedId: string | null;
}) {
  return (
    <div className="board-view">
      {statuses.map((status, i) => {
        const group = conversations.filter((c) => c.status === status);
        return (
          <section className="board-column" key={status}>
            <h2>
              <span className={`status-dot status-${i}`} />
              {status}
              <span>{group.length}</span>
            </h2>
            <div className="board-cards">
              {group.map((c) => (
                <ConversationCard
                  conversation={c}
                  key={c.id}
                  selected={c.id === selectedId}
                  board
                />
              ))}
              {!group.length && (
                <div className="board-empty">
                  <Check size={19} />
                  <span>Brak rozmów</span>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
