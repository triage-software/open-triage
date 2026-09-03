import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const emailId = request.nextUrl.searchParams.get("email");
  const state = await getState();
  const email = state.conversations
    .filter((conversation) => conversation.mailboxId === "test")
    .flatMap((conversation) => conversation.emails)
    .find((email) => email.id === emailId);
  if (!email?.imap) return new Response(null, { status: 404 });
  try {
    const source = await readFile(path.join(
      process.cwd(), "data/prototype/mail/test",
      email.imap.uidValidity, `${email.imap.uid}.eml`,
    ));
    return new Response(new Uint8Array(source), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="wiadomosc.eml"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Nie można odczytać oryginału wiadomości.", { status: 404 });
  }
}
