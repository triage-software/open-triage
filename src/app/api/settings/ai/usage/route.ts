import { getOpenRouterUsage } from "@/lib/ai-service";
import { aiErrorResponse, aiJson } from "@/lib/ai-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return aiJson(await getOpenRouterUsage()); } catch (error) { return aiErrorResponse(error); }
}
