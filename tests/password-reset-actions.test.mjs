import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// The actions and API client remain real; only the outbound HTTP boundary is mocked.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only")
    return { url: "data:text/javascript,export{}", shortCircuit: true };
  if (specifier.startsWith("@/"))
    return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { forgotPasswordAction, resetPasswordAction } = await import("../src/app/actions/password-reset.ts");

function form(values) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

const validReset = { token: "test-reset-token", password: "new-test-password", confirmPassword: "new-test-password" };

test("requesting recovery forwards the email and returns only generic success", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(new URL(url).pathname, "/v1/auth/forgot-password");
    assert.equal(init.method, "POST");
    assert.equal(init.cache, "no-store");
    assert.deepEqual(JSON.parse(init.body), { email: "member@example.test" });
    assert.equal(init.headers.get("cookie"), null);
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json({ ok: true });
  });
  assert.deepEqual(await forgotPasswordAction({}, form({ email: "  member@example.test  " })), { success: true });
  assert.equal(fetch.mock.callCount(), 1);
});

test("invalid recovery email is rejected without contacting the API", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected API call"); });
  for (const email of ["", "invalid", "member@", " "]) {
    assert.deepEqual(await forgotPasswordAction({}, form({ email })), { error: "invalidEmail" });
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("recovery accepts an email at the backend's 254-character limit", async (t) => {
  const email = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
  assert.equal(email.length, 254);
  const fetch = t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), { email });
    return Response.json({ ok: true });
  });
  assert.deepEqual(await forgotPasswordAction({}, form({ email })), { success: true });
  assert.equal(fetch.mock.callCount(), 1);
});

test("recovery rejects an email above the backend's 254-character limit", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected API call"); });
  const email = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`;
  assert.equal(email.length, 255);
  assert.deepEqual(await forgotPasswordAction({}, form({ email })), { error: "invalidEmail" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("mail configuration failure reports recovery unavailable", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "RESET_UNAVAILABLE" }, { status: 503 }));
  assert.deepEqual(await forgotPasswordAction({}, form({ email: "member@example.test" })), { error: "resetUnavailable" });
});

test("reset sends the token and new password without confirmation or login", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(new URL(url).pathname, "/v1/auth/reset-password");
    assert.equal(init.method, "POST");
    assert.equal(init.cache, "no-store");
    assert.deepEqual(JSON.parse(init.body), { token: validReset.token, password: validReset.password });
    assert.equal(init.headers.get("cookie"), null);
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json({ ok: true });
  });
  assert.deepEqual(await resetPasswordAction({}, form(validReset)), { success: true });
  assert.equal(fetch.mock.callCount(), 1);
});

for (const [label, changes, error] of [
  ["missing token", { token: "" }, "invalidResetToken"],
  ["short password", { password: "short", confirmPassword: "short" }, "passwordTooShort"],
  ["long password", { password: "a".repeat(201), confirmPassword: "a".repeat(201) }, "passwordTooLong"],
  ["password mismatch", { confirmPassword: "different-password" }, "passwordMismatch"],
  ["missing confirmation", { confirmPassword: "" }, "passwordMismatch"],
]) {
  test(`reset rejects ${label} before contacting the API`, async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected API call"); });
    assert.deepEqual(await resetPasswordAction({}, form({ ...validReset, ...changes })), { error });
    assert.equal(fetch.mock.callCount(), 0);
  });
}

test("invalid, expired or used reset tokens produce the retryable link error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "INVALID_RESET_TOKEN" }, { status: 400 }));
  assert.deepEqual(await resetPasswordAction({}, form(validReset)), { error: "invalidResetToken" });
});

for (const [label, action, values] of [
  ["recovery", forgotPasswordAction, { email: "member@example.test" }],
  ["reset", resetPasswordAction, validReset],
]) {
  test(`${label} handles API failures without exposing response contents`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ code: "INTERNAL_DETAIL", debug: "private" }, { status: 500 }));
    assert.deepEqual(await action({}, form(values)), { error: "genericError" });
  });
  test(`${label} handles network failure as a user-visible error`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => { throw new TypeError("API network error"); });
    assert.deepEqual(await action({}, form(values)), { error: "genericError" });
  });
}

for (const length of [10, 200]) {
  test(`reset accepts a password at the ${length}-character boundary`, async (t) => {
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      assert.equal(JSON.parse(init.body).password.length, length);
      return Response.json({ ok: true });
    });
    const password = "a".repeat(length);
    assert.deepEqual(await resetPasswordAction({}, form({ ...validReset, password, confirmPassword: password })), { success: true });
  });
}
