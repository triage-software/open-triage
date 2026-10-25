# Password recovery QA — 2026-09-25

Used `ot-integration-tests` and the configured local `codex-browser-use` provider. The skills source was cloned from `triage-software/skills` at `e0a39516df1058200bbdd7444cf11ccad0e19686`; all 41 installed skill directories matched it. No external tracker changes or deployment were performed.

## Automated results

The complete configured gate passed: 59 frontend tests, 53 API unit tests, 15 PostgreSQL integrations, both type checks and both builds. The Docker integration harness removed its own disposable database after execution. The new `docs/qa/password-reset-smoke.mjs` also passed against the running local API and Mailpit, including real queue/worker/SMTP delivery. It accepts loopback origins only and keeps generated credentials in memory.

## Browser observations

A dedicated localhost tab and synthetic account kept the user's 127.0.0.1 session separate. Through the actual browser UI:

- The sign-in recovery link opened the email form.
- Sending the test address showed the generic recovery confirmation.
- Mailpit displayed the delivered reset mail with the correct workspace name, 30-minute validity and a reset link.
- Opening that email link displayed the new-password and confirmation fields.
- After the synthetic password was changed through the API, signing in through the browser opened the authenticated workspace.
- Logout returned to sign-in.
- A missing token showed the recovery error and a link to request a new one.
- English and Polish recovery text rendered correctly; the request form was visually inspected in a screenshot emitted in the task.

The new-password form was not submitted through the browser: the Browser Use policy requires human entry for credential changes. Its server-action validation and error mapping were executed by native tests. The actual password change, old-password/old-session rejection and token-reuse rejection were verified over HTTP on synthetic accounts. This distinction is intentional; no complete browser-only reset is claimed.

## Local environment left available

The user-requested app remains at http://127.0.0.1:3000. Recovery starts at `/forgot-password`; Mailpit is at http://127.0.0.1:58025. The local API, worker, PostgreSQL and Redis remain running for manual testing. Mail is delivered to the local sink; production SMTP delivery was not tested. Only synthetic fixture accounts/mail were added. Runtime configuration and validation logs are ignored under `artifacts/`.
