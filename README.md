# Open Triage

A local, interactive prototype of a shared support inbox. Next.js 16, React 19, TypeScript and Tailwind CSS 4.

**Current state:** `support@example.com` receives real messages over IMAP and sends replies over SMTP. A copy of each reply is placed in the "Sent" folder of the same mailbox. The server checks INBOX on startup and every 30 seconds; the panel refreshes data every 2 seconds. Demo messages have been removed.

## Running it

Node.js 20.9 or newer is required (an LTS version is recommended).

```sh
npm install
npm run dev
```

Open the [local demo](http://127.0.0.1:3000/prototype/support?variant=inbox).

The panel is available only on the local machine. Run a single server process for this data directory. Do not run `npm run dev` and `npm start` at the same time against the same data.

The mail connection uses `.env.local` (outside Git, server-side only). In a fresh copy of the project, copy `.env.example` to `.env.local` and fill in the password. The configured mailbox is `support@example.com`, server `mail.example.com`, port `993`, with verified TLS. Login credentials never reach the browser or `state.json`.

SMTP uses the same server on port `465` with TLS. `TRIAGE_SMTP_PASSWORD` may be left empty to use the same mailbox's IMAP password. `TRIAGE_IMAP_SENT_FOLDER=SENT` points to home.pl's sent folder; without this variable the app looks for the folder the server marks as `\Sent`.

The mailbox bar shows the IMAP status and the time of the last successful check. "Check mail" fetches new mail immediately. Automatic receiving works whenever the local server is running, even after browser tabs are closed. The mailbox is opened read-only: the app does not delete messages from the server or change read flags.

A reply has a shared `From` and `Reply-To`: `support@example.com`. The staff member is recorded as the author in the panel. `Message-ID`, `In-Reply-To` and `References` tie the reply to the thread in other mail clients as well. Once accepted by SMTP, the identical MIME message is saved via IMAP to "Sent". There is no need to add your own address to CC. Internal comments are not added to the outgoing message or its copy.

With `npm run dev`, [React Grab](https://github.com/aidenybai/react-grab) runs, loaded from a local package. Hover over a UI element, press `⌘C` (Windows/Linux: `Ctrl+C`), and paste the copied context into the conversation. The tool attaches the component and its location in the code. It is disabled in the production build.

```sh
npm run typecheck
npm run build
npm start
```

## What you can check out

- Three layouts: [inbox](http://127.0.0.1:3000/prototype/support?variant=inbox), [queue](http://127.0.0.1:3000/prototype/support?variant=queue), [board](http://127.0.0.1:3000/prototype/support?variant=board). Layouts are switched via tabs in a compact bar above the conversations. In development mode, keyboard arrows also work outside of editable fields.
- Three mailboxes: `hello@opentriage.com`, `hello@opentriage.com` and `support@example.com`. IMAP and SMTP work for the last one; the other two are awaiting connection.
- The team: Michał Kluska, Jan Kowalski and Anna Nowak. Staff selection and new assignments cover only these three people.
- Assigning conversations, priorities, categories, statuses, search and filters.
- The email content takes up the main part of the panel. The AI suggestion and the empty editor are collapsed by default. A saved draft opens the editor; collapsing it manually keeps the text.
- Separate reply and comment drafts for each staff member. Drafts save after 450 ms of no typing and before sending. An indicator under the editor confirms the save.
- The signatures of Anna, Jan and Michał are shown below the reply editor. Sending preserves the author's signature and creates a safe plain-text version alongside the HTML version at the same time; the signature is not part of the draft or of internal comments.
- The HTML of the message and footer is compiled locally by MJML (`src/lib/mail-template.ts`), with template validation, responsive columns, and Outlook support. The full document, including styles, goes into the HTML part of the MIME message; plain text remains the alternative. The compiler runs only on the server, with no external API and no font downloads.
- Settings → Staff Signatures: choose a person, edit the full MJML, refresh the preview, and save. The reply content is added above the signature; the text alternative is generated from the template. Saving is local and checks the version to avoid overwriting concurrent changes. Signature changes do not modify already-prepared or already-sent messages.
- Internal comments with links that scroll to the specific entry. The links are local and do not expose the panel over the Internet.
- Reply suggestions via OpenRouter, sourced from the approved knowledge base of the same mailbox. Model selection and key storage are in Settings.
- Accepting, rejecting and editing documents with version history. Closing a conversation creates an archive and a knowledge proposal for approval.
- In-panel notifications and Google Chat / Discord previews, without actually sending them.

## OpenRouter

In [Settings](http://127.0.0.1:3000/prototype/support?view=settings), paste your OpenRouter key, choose a model, and save. The default model for a new installation is `z-ai/glm-5.3`; the list comes from OpenRouter's public catalog and includes models that support structured JSON responses. "Check connection" verifies the key and the model's presence in the catalog, without paid generation. Provider access and balance are ultimately verified during generation.

The "AI Costs" section shows, in USD, the cost of requests billed through this panel, the number of requests and tokens, and the total usage and remaining limit of the current key as returned by OpenRouter. The local cost log is persisted in `state.json` and also includes responses rejected after generation; redisplaying a saved suggestion does not charge for the request a second time. Key data may include usage outside the panel. The remaining limit applies to the key's budget and is not presented as the balance of the whole account.

The key is shared across the team, saved atomically to `data/prototype/settings/openrouter.json` with `0600` permissions, outside Git. It is not sent to any public API, to `state.json`, or to browser storage. Leaving the field empty keeps the saved key; "Remove key" disables generation. Settings changes are version-controlled so that another tab does not accidentally overwrite them.

In a conversation, click "Generate suggestion". The model receives the subject, addresses, the last 12 public messages (up to 6000 characters each), and up to 8 approved documents from the same mailbox (up to 8000 characters each), selected by word match against the question. Customer emails are passed as untrusted user content, while approved documents are passed as binding system knowledge. If a relevant document exists, the response contract requires non-empty text and at least one valid source. Comments, drafts, activity, and unapproved knowledge are not passed in. Generation is billed by OpenRouter according to the selected model.

The prompt is arranged for caching: fixed instructions, selected documents in a stable order, and the variable conversation at the end. A `session_id` shared per mailbox helps OpenRouter route requests to the same provider. Caching depends on the model and provider; the panel does not yet report the number of hits. Knowledge selection is local and word-based — it does not use a second model or embeddings.

AI has two independent parts. Upon receiving a new email (including a reply within an existing thread), the server automatically assigns a category and priority. Classification uses only the public conversation and does not require the knowledge base. A separate panel shows its status and lets you retry the assignment with a button. Existing conversations are not bulk-reclassified — classification can be run manually.

Import saves a pending classification along with the email and cursor. A single process handles the queue without blocking mail receiving; work resumes after a restart. A missing key leaves the task pending, and AI errors trigger retries with a delay ranging from 30 seconds to 5 minutes. Manually setting the category or priority invalidates an in-progress classification. The next new email triggers a fresh evaluation. A stale result after the conversation or settings change is not applied. Classification and drafting are separate paid calls to the same selected model and are both recorded in the cost log.

A draft is created only after clicking "Generate suggestion" and contains text and sources, without classification. "Use draft" moves the text into the staff member's own draft; sending the email remains a separate action. Lacking a documented solution results in escalation to a human and a notification in the panel. Invalid sources or incomplete JSON are rejected. Automatic classification does not generate a draft, does not change drafts, and does not send mail.

The result is saved with the conversation and available to the team after a restart. Concurrent generation for the same context shares a single operation. "Regenerate" deliberately requests another response. Changing the public conversation, knowledge, or settings during generation discards the stale result; edited drafts remain untouched. Changes made after generation block the use of the old suggestion.

## Collaborating across multiple tabs

Assignments, drafts, comments, and presence also work on real conversations fetched from IMAP.

1. Open the same conversation in two tabs or windows.
2. Choose a different staff member in the lower part of the menu in each tab. The selection is saved in `sessionStorage`, separately per tab.
3. Assign the case, add a comment, or prepare a draft. Data refreshes every two seconds.
4. When another message arrives or someone replies in the thread, the staff member keeps their draft and sees a warning. They must review the current thread before sending a new reply.

Presence is signaled from a visible window, refreshed every 15 seconds, and expires after 45 seconds. Hidden or closed tabs stop signaling presence. A changed reply and document are re-checked on the server regardless of warnings shown in the interface. An operation identifier protects against repeating the same send or comment.

An assignment indicates the responsible person but does not prevent others from replying. Identities are simulated; the demo does not implement authentication or real permissions.

## Data on disk

```text
data/prototype/
  state.json
  settings/openrouter.json  # private key and model, 0600 permissions
  mail/test/<uid-validity>/<uid>.eml
  generations/<generation-id>/
    knowledge/<mailbox-id>/<document-id>/v1.md
    knowledge/<mailbox-id>/<document-id>/v2.md
    archives/<mailbox-id>/<conversation-id>-v1.md
```

`state.json` is the source of the application's state. Operations are executed sequentially in a single process, and files are swapped atomically. Markdown versions are created before a change is confirmed. Starting the API restores the Markdown copies from the state if they are missing. Presence is ephemeral and resets after a restart.

Import appends messages and saves the IMAP cursor in the same queue, preserving the team's changes. UID/UIDVALIDITY and Message-ID identifiers protect against duplicates after a retry or restart. References/In-Reply-To link replies to existing conversations within the same mailbox; an identical subject alone does not link cases. A new message reopens a closed conversation. Original MIME sources, including attachments, can be downloaded as `.eml` from the conversation timeline. The panel shows the plain-text content (HTML is converted to text), without running scripts or fetching tracking images from the email.

Sends have a persistent `outbox` log in `state.json` with an operation identifier and the original MIME. It is not returned in the panel's public state. The reservation checks the conversation and draft revision, and network SMTP/IMAP operations happen outside the write queue, so they do not block comments and other conversations. A newer draft or an email received during sending is not overwritten.

After a reply is accepted by SMTP, an IMAP error only retries the copy save, every 30 seconds. Before repeating APPEND, the Message-ID is checked in "Sent", including by reading headers via FETCH when home.pl does not return the existing message in a SEARCH HEADER. If SMTP confirmation is lost or the process is interrupted during sending, the panel marks the result as uncertain and blocks further sends in that conversation until it is resolved. SMTP itself does not guarantee exactly-once delivery after a dropped connection; the app does not guess the outcome and does not automatically send a second time.

The message generator and the demo restore button and operation have been removed. The first run creates only the mailbox and team configuration. The data directory is excluded from Git.

The version 4 migration removes recognized sample conversations from `support@example.com` along with related drafts, notifications, archives, and demo knowledge. Manually added documents and conversations outside the sample set remain. The copy of the previous state in `data/prototype/backups/` and historical Markdown files are not loaded into the panel.

Changing the team also saves a JSON copy. Previous demo profiles become inactive but retain entry authorship, prior assignments, and drafts. An assignment to a former profile can be handed off to one of the three people on the current team. A tab with a former profile selected switches to Michał.

Public messages and comments have separate types and operations. The archive marks comments as internal; reply and knowledge suggestions do not use their content.

## Prototype boundaries

The test mailbox's IMAP and SMTP, and OpenRouter once a key is saved in settings, are connected. Supabase and GitHub are not connected. Until automatic classification finishes, new cases have the category "Other" and normal priority. Classification only works with the server running and OpenRouter configured; the file-based queue is designed for a single process, not multiple replicas. A draft is not generated automatically. The knowledge-entry proposal on closing a conversation is created locally from the public reply and requires approval. Folders other than INBOX are not imported, but replies from the panel are saved to "Sent". Received attachments are available in `.eml`; the editor sends text-only replies.

## Verification

Tests (Node.js 22.18+): `npm test`. They cover import, deduplication, threads, mailbox isolation, drafts, comments and MIME, as well as the shared sender, SMTP confirmation, separate copy retries, dropped connections, conflicts, and identical copy content in "Sent". Sending tests use substituted transports; they do not send emails to clients. SMTP login and the `SENT` folder were verified on the test account without sending messages.

After a manual send from the panel, the real copy in `SENT` was also checked: a single Message-ID, identical MIME, and shared From/Reply-To addresses. A check of the re-save behavior performed a read of the existing copy without APPEND and without another SMTP call.

A build, type check, and verification through the local API were carried out: 10 parallel comments, independent drafts, a conflict between parallel replies, retrying the same operation, correct sender, comment isolation, archive and knowledge versioning. Editor, comment, and link flows were also checked in the browser.

AI tests use a fake transport and a temporary data directory. They check private key storage and restart, settings conflicts, knowledge and comment isolation, source validation, enforcement of relevant-knowledge usage, API error handling, suggestion storage, shared generation across multiple tabs, escalation, and rejection of the result after a change to the conversation, knowledge, or settings. Automatic classification tests cover receiving via a mock IMAP, missing key and knowledge, deduplication of calls, manual changes, a newer email arriving during generation, persistent retries, a critical notification, and no changes to drafts or sending. Signature tests check the data of all staff members, persistence of the author's signature, HTML encoding, and both MIME variants.
