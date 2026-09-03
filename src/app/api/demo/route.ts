import { NextRequest, NextResponse } from "next/server";
import { startMailSync } from "@/lib/mail-sync";
import {
  ActionError,
  applyAction,
  getArchive,
  getState,
  heartbeat,
  repairMarkdown,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof ActionError)
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  console.error(error);
  return NextResponse.json(
    {
      error:
        "Nie udało się zapisać lub odczytać danych. Twój tekst pozostaje w edytorze.",
    },
    { status: 500 },
  );
}
let repaired = false;
export async function GET(request: NextRequest) {
  try {
    startMailSync();
    if (!repaired) {
      await repairMarkdown();
      repaired = true;
    }
    const archiveId = request.nextUrl.searchParams.get("archive");
    if (archiveId)
      return new Response(await getArchive(archiveId), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": 'attachment; filename="rozmowa.md"',
          "Cache-Control": "no-store",
        },
      });
    return NextResponse.json(await getState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    // A local demo has no auth. Block cross-origin browser mutations explicitly.
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    const expectedOrigin = host
      ? `${request.nextUrl.protocol}//${host}`
      : request.nextUrl.origin;
    if (
      (origin && origin !== expectedOrigin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return NextResponse.json(
        { error: "Niedozwolone źródło żądania." },
        { status: 403 },
      );
    if (!request.headers.get("content-type")?.includes("application/json"))
      return NextResponse.json(
        { error: "Wymagany format JSON." },
        { status: 415 },
      );
    const input = await request.json();
    if (input.type === "presence")
      return NextResponse.json(await heartbeat(input.presence));
    return NextResponse.json(await applyAction(input));
  } catch (error) {
    return errorResponse(error);
  }
}
