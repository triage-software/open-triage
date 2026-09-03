import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { AiError, isAiError } from "./ai-settings-store";

export function aiJson(value: unknown) {
  return NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
}
export function aiErrorResponse(error: unknown) {
  // Never log provider responses, submitted API keys, or request bodies.
  return NextResponse.json({
    error: isAiError(error) ? error.message : "Nie udało się wykonać operacji AI. Spróbuj ponownie.",
    code: isAiError(error) ? error.code : "AI_ERROR",
  }, { status: isAiError(error) ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}
export async function aiInput(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const expected = host ? `${request.nextUrl.protocol}//${host}` : request.nextUrl.origin;
  if ((origin && origin !== expected) || request.headers.get("sec-fetch-site") === "cross-site")
    throw new AiError("Niedozwolone źródło żądania.", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) throw new AiError("Wymagany format JSON.", 415);
  const text = await request.text();
  if (text.length > 8000) throw new AiError("Żądanie jest zbyt duże.", 413);
  try { return JSON.parse(text); } catch { throw new AiError("Nieprawidłowy JSON."); }
}
