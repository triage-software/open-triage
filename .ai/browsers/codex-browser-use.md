# Browser provider: codex-browser-use

This provider implements agent-driven browser QA through the local Codex Browser
Use plugin, using `mcp__cua_repl.js`. It is selected by `browser.provider` in
`.ai/agentic.config.json`. Repository-native integration and E2E tests remain
part of the validation gate.

## Contract and runtime

Use only APIs documented by the currently running plugin. On a fresh or reset
runtime, the first invocation contains exactly one documented entry-point call,
for example `await cua.getState()`. Read its returned documentation before any
follow-up calls. A continuation after context compaction first calls
`await cua.rewriteDocumentation()`.

The provider uses a local hidden in-app browser tab. It does not install a CLI,
launch an independently controlled headless browser, or contact a cloud browser
service. If the plugin is unavailable, report that as a blocker. Never silently
switch automation providers. Ordinary JavaScript can inspect returned strings
or maintain the current run's tab handle; UI interaction uses only the plugin's
documented APIs.

### ensure-installed

Inputs: `QA_DIR`, platform, architecture. The Browser Use plugin and its local
browser runtime are supplied by the host application. First discover them using
`await cua.getState()`; do not install another browser or binary. Run **doctor**
before declaring the provider installed. If the plugin is absent or doctor
fails, return failure and a concrete blocker.

Output the following values with `nodeRepl.write` after the live check:

```text
BROWSER_PROVIDER=codex-browser-use
BROWSER_INSTALLED=1
BROWSER_COMMAND=mcp__cua_repl.js
BROWSER_VERSION=unknown
BROWSER_NOTES=Local hidden IAB tab; no independent headless launch or guaranteed path export
```

On failure use `BROWSER_INSTALLED=0` and put the observed failure in
`BROWSER_NOTES`. Treat these lines as data, never as shell commands.

### doctor

Create an owned temporary tab using
`let probe = await cua.createBrowserTab("iab", "about:blank", { visible: false })`.
Read its AX state with `await probe.getAXState()` and capture with
`await probe.getScreenshot()`. A screenshot must actually be returned or emitted
before health is reported. Close only that probe in `finally` via
`await probe.close()`. Catch failures only to report them, then rethrow them.

This verifies a real local hidden tab; it is not evidence of a standalone
headless launch. If a consumer requires that exact launch mode, report an
unsupported-capability failure instead of claiming compliance.

### open

Input: `BASE_URL` or a validated URL. Create a new run-owned tab:

```javascript
let qaTab = await cua.createBrowserTab("iab", BASE_URL, { visible: false });
```

Keep its handle in the persistent tool runtime and record that this run owns it.
Do not reuse a user's tab for automated form filling. A dedicated tab separates
navigation from the user's tab; it does not promise a separate cookie jar. Use
only task-specific test accounts; stop if the workflow would disturb a user's
existing authenticated session. Follow the plugin's returned documentation for
any stronger session-isolation API if available. Make the tab visible only when
showing the requested result to the user.

### snapshot

Read `await qaTab.getAXState()` and retain its returned accessibility text.
Use the observed element indices to address controls. Call
`await qaTab.getAXState({ disableDiffing: true })` when a complete snapshot is
needed. Do not guess selectors or indices.

### interact

Act on an observed element index using the supported operation:

```javascript
await qaTab.click(index);
await qaTab.setValue(index, value);
await qaTab.typeText(index, text);
await qaTab.pressKey(index, "Return");
```

Use only the applicable call, not the whole example block. Keyboard input may
use `null` for its index when the documented API permits it and focus is known.
Use `await qaTab.goto(url)` for direct navigation and `await qaTab.reload()` for
a reload. Re-snapshot after each action batch, navigation, or material UI
change. A failed operation propagates failure; do not treat a click alone as
proof that the intended result occurred. Never use arbitrary page evaluation,
undocumented network requests, or a separate automation library for UI actions.

### assert

Read fresh AX state and compare it with an expected rendered condition. For
example, after observing the expected literal text from the UI or task:

```javascript
const state = await qaTab.getAXState({ disableDiffing: true });
if (!state.includes(expectedText)) {
  throw new Error("Expected visible condition was not observed");
}
nodeRepl.write({ assertion: expectedText, observed: true });
```

Assertions on URL, control value, or state must similarly use an observed value
returned by the documented API. Do not infer a successful action from a missing
error. Report only redacted observations; never print passwords or reset tokens.

### screenshot

Capture a local browser screenshot with `await qaTab.getScreenshot()`. The
plugin emits the image and returns PNG bytes. This provides inline evidence.
When capture throws or returns no usable image, propagate failure.

An exact output PNG path and full-page capture are optional caller requests but
are not supported by the basic documented CUA API. Before using them, consult
the current plugin's screenshot documentation if exposed. Use a save or
full-page operation only when that documentation explicitly provides it. Do not
invent filesystem APIs, print encoded image bytes, or claim that a file exists
when only an inline screenshot was emitted. If an exact file is mandatory and
no documented export exists, return failure with `SCREENSHOT_PATH_UNSUPPORTED`;
otherwise record that evidence was emitted inline instead of naming a local
artifact path.

### close

Close only the run-owned tab in `finally` via `await qaTab.close()`, then clear
its handle. If the handle has already been cleared, return success without a
call. Never close pre-existing user tabs. A tab explicitly left open as the
user's requested deliverable may be retained; call `markDeliverable()` only for
that requested result, not routine QA evidence.

## Rules

- Keep browser control local and agent-owned. Do not require new credentials or
  a third-party browser subscription.
- Use disposable test identities and redact credentials, tokens, and secrets
  from reports and screenshot evidence.
- Hidden tabs share the host browser's available session behavior; do not claim
  cookie isolation without verifying it through a documented capability.
- Preserve repository-native automated tests. This provider adds exploration,
  rendered assertions, and screenshots; it does not replace them.
- Follow the active tool's supported API and safety boundaries if they differ
  from an example above. Report unavailable required operations explicitly.
