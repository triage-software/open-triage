import { NextRequest } from "next/server";
import { aiSettings } from "@/lib/ai-settings";
import { aiErrorResponse, aiInput, aiJson } from "@/lib/ai-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return aiJson(await aiSettings.getPublic()); } catch (error) { return aiErrorResponse(error); }
}
export async function POST(request: NextRequest) {
  try { return aiJson(await aiSettings.update(await aiInput(request))); } catch (error) { return aiErrorResponse(error); }
}
