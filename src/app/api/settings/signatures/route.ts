import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getState, saveUserSignature } from "@/lib/store";
import { compileSignatureMjml, defaultSignatureMjml } from "@/lib/mail-template";
import { signatureFor } from "@/lib/signatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
const schema = z.object({
  action: z.enum(["preview", "save"]), mjml: z.string().min(1).max(50_000),
  userId: z.string().min(1).max(100), actorId: z.string().min(1).max(100),
  generation: z.string().min(1).max(100), expectedVersion: z.number().int().nonnegative(),
}).strict();

export async function GET(request: NextRequest) {
  const state = await getState();
  const user = state.users.find((item) => item.id === request.nextUrl.searchParams.get("userId") && item.active !== false);
  if (!user) return json({ error: "Nie znaleziono pracownika." }, 404);
  const signature = signatureFor(user, "test@sellersk.it");
  const defaultMjml = defaultSignatureMjml(signature);
  return json({ ...(signature.custom ?? await compileSignatureMjml(defaultMjml)), version: signature.custom?.version ?? 0, defaultMjml });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const expected = `${request.nextUrl.protocol}//${request.headers.get("host")}`;
  if ((origin && origin !== expected) || request.headers.get("sec-fetch-site") === "cross-site")
    return json({ error: "Niedozwolone źródło żądania." }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "Wymagany format JSON." }, 415);
  try {
    const text = await request.text();
    if (text.length > 100_000) return json({ error: "Szablon jest zbyt duży." }, 413);
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) return json({ error: "Nieprawidłowe dane podpisu (limit 50 000 znaków MJML)." }, 400);
    return json(parsed.data.action === "preview" ? await compileSignatureMjml(parsed.data.mjml) : await saveUserSignature(parsed.data));
  } catch (error) {
    const failure = error as Error & { status?: number };
    return json({ error: failure.message }, failure.status ?? 400);
  }
}
