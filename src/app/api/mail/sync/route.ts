import { NextRequest, NextResponse } from "next/server";
import { syncTestMailbox } from "@/lib/mail-sync";
import { getMailSync } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (
    (origin && origin !== `${request.nextUrl.protocol}//${host}`) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) return NextResponse.json({ error: "Niedozwolone źródło żądania." }, { status: 403 });
  try {
    await syncTestMailbox();
    const sync = await getMailSync();
    return NextResponse.json(sync, {
      status: sync?.status === "connected" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Nie można zapisać stanu poczty." }, { status: 500 });
  }
}
