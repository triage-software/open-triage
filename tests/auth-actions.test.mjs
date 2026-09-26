import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";
import { RequestCookies, ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies/index.js";

// Only replace the Next request context. Actions, API requests and cookie
// serialization remain real so dropping a Set-Cookie relay breaks these tests.
const contextUrl = `data:text/javascript,${encodeURIComponent(`
  let jar;
  export function setJar(value) { jar = value; }
  export async function cookies() { return jar; }
  export function redirect(location) {
    throw Object.assign(new Error('NEXT_REDIRECT'), { location });
  }
`)}`;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/headers" || specifier === "next/navigation")
    return { url: contextUrl, shortCircuit: true };
  if (specifier === "server-only")
    return { url: "data:text/javascript,export{}", shortCircuit: true };
  if (specifier.startsWith("@/"))
    return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { setJar } = await import(contextUrl);
const { signInAction, signUpAction, acceptInviteAction, logoutAction } = await import("../src/app/actions/auth.ts");
const { apiFetch } = await import("../src/lib/api-client.ts");

const sessionId = Buffer.alloc(32, 42).toString("base64url");
const signedSession = `${sessionId}.${createHmac("sha256", "test-session-secret").update(sessionId).digest("base64url")}`;
const sessionExpiry = new Date("2026-10-25T12:00:00Z");
const sessionCookie = `ot_session=${signedSession}; Path=/; Expires=${sessionExpiry.toUTCString()}; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`;

function requestContext(t, initial = {}) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-25T12:00:00Z") });
  const headers = new Headers();
  const jar = new ResponseCookies(headers);
  for (const [name, value] of Object.entries(initial)) jar.set(name, value);
  headers.delete("set-cookie");
  setJar(jar);
  return { jar, headers };
}

function form(values) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

function redirectsTo(location) {
  return (error) => error.message === "NEXT_REDIRECT" && error.location === location;
}

for (const [name, action, endpoint, status, values, payload] of [
  ["login", signInAction, "/v1/auth/login", 200,
    { email: "member@example.test", password: "valid-password", locale: "pl" },
    { email: "member@example.test", password: "valid-password" }],
  ["signup", signUpAction, "/v1/auth/signup", 201,
    { tenantName: "New team", email: "member@example.test", password: "valid-password", locale: "pl" },
    { tenantName: "New team", email: "member@example.test", password: "valid-password", locale: "pl" }],
  ["accept invite", acceptInviteAction, "/v1/auth/accept-invite", 200,
    { token: "one-time-token", password: "valid-password", name: "  Invited teammate  ", locale: "pl" },
    { token: "one-time-token", password: "valid-password", name: "Invited teammate" }],
]) {
  test(`${name} relays a signed session before redirect and forwards it on the next request`, async (t) => {
    const { jar, headers } = requestContext(t);
    const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(init.cache, "no-store");
      if (new URL(url).pathname === endpoint) {
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(init.body), payload);
        return Response.json({ ok: true }, { status, headers: { "set-cookie": sessionCookie } });
      }
      assert.equal(new URL(url).pathname, "/v1/auth/me");
      assert.equal(init.headers.get("cookie"), `ot_session=${signedSession}; ot_locale=pl`);
      return Response.json({ user: { id: "member-id" } });
    });

    await assert.rejects(action({}, form(values)), redirectsTo("/"));
    assert.deepEqual(jar.get("ot_session"), {
      name: "ot_session", value: signedSession, path: "/", httpOnly: true,
      secure: true, sameSite: "lax", maxAge: 2592000, expires: sessionExpiry,
    });
    assert.equal(jar.get("ot_locale").value, "pl");
    assert.equal(headers.getSetCookie().length, 2);

    // A browser returns just cookie pairs from the action's Set-Cookie headers.
    const browserCookies = headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const incoming = new RequestCookies(new Headers({ cookie: browserCookies }));
    const result = await apiFetch("/v1/auth/me", {
      cookies: Object.fromEntries(incoming.getAll().map(({ name, value }) => [name, value])),
    });
    assert.deepEqual(result.body, { user: { id: "member-id" } });
    assert.equal(fetch.mock.callCount(), 2);
  });
}

test("logout forwards the existing signed session and expires browser cookies before redirect", async (t) => {
  const { jar, headers } = requestContext(t, { ot_session: signedSession, ot_locale: "pl" });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(new URL(url).pathname, "/v1/auth/logout");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("cookie"), `ot_session=${signedSession}; ot_locale=pl`);
    return Response.json({ ok: true }, { headers: {
      "set-cookie": "ot_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
    } });
  });

  await assert.rejects(logoutAction(), redirectsTo("/sign-in"));
  assert.equal(jar.get("ot_session").value, "");
  assert.equal(jar.get("ot_session").expires.getTime(), 0);
  assert.equal(jar.get("ot_locale").expires.getTime(), 0);
  assert.equal(headers.getSetCookie().length, 2);
});

test("invalid credentials return an error without redirecting or mutating the browser session", async (t) => {
  const { jar, headers } = requestContext(t, { ot_session: "existing-session", ot_locale: "en" });
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }));

  assert.deepEqual(await signInAction({}, form({ email: "member@example.test", password: "wrong", locale: "pl" })), {
    error: "invalidCredentials",
  });
  assert.equal(jar.get("ot_session").value, "existing-session");
  assert.equal(jar.get("ot_locale").value, "en");
  assert.deepEqual(headers.getSetCookie(), []);
});

test("signup and invite reject a short password before contacting the API or setting cookies", async (t) => {
  const { headers } = requestContext(t);
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected API call"); });
  for (const action of [signUpAction, acceptInviteAction]) {
    assert.deepEqual(await action({}, form({ password: "short" })), { error: "passwordTooShort" });
  }
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(headers.getSetCookie(), []);
});
