import { NextRequest } from "next/server";
import { generateAiSuggestion } from "@/lib/ai-service";
import { aiErrorResponse, aiInput, aiJson } from "@/lib/ai-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try { return aiJson(await generateAiSuggestion(await aiInput(request))); } catch (error) { return aiErrorResponse(error); }
}
