import { NextRequest } from "next/server";
import { testAiConnection } from "@/lib/ai-service";
import { aiErrorResponse, aiInput, aiJson } from "@/lib/ai-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try { await aiInput(request); return aiJson(await testAiConnection()); } catch (error) { return aiErrorResponse(error); }
}
