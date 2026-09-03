import { test } from "node:test";
import assert from "node:assert/strict";
import { readApiResponse } from "../src/lib/api-response.ts";

test("HTML errors from a proxy or Next show an actionable message, never the response body", async () => {
  for (const status of [200, 404, 500, 502, 504]) {
    await assert.rejects(readApiResponse(new Response('<!DOCTYPE html><p>private debug details</p>', {
      status, headers: { "Content-Type": "text/html" },
    })), (error) => {
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.match(error.message, /tunel/);
      assert.doesNotMatch(error.message, /private|DOCTYPE|Unexpected token/);
      return true;
    });
  }
});

test("malformed or empty JSON is handled without leaking parser errors", async () => {
  for (const body of ['<!DOCTYPE html>', '', 'null', '[]', '"text"']) {
    await assert.rejects(readApiResponse(new Response(body, {
      headers: { "Content-Type": "application/json" },
    })), /nieprawidłową odpowiedź/);
  }
});

test("valid API success and actionable server errors are preserved", async () => {
  assert.deepEqual(await readApiResponse(Response.json({ needsHuman: false })), { needsHuman: false });
  await assert.rejects(readApiResponse(Response.json({ error: "Klucz OpenRouter został odrzucony." }, { status: 401 })),
    /Klucz OpenRouter został odrzucony/);
  await assert.rejects(readApiResponse(Response.json({}, { status: 503 })), /HTTP 503/);
});
