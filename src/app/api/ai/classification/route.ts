import { NextRequest } from "next/server";
import { z } from "zod";
import { aiErrorResponse, aiInput, aiJson } from "@/lib/ai-route";
import { AiError } from "@/lib/ai-settings-store";
import { startAiTriage } from "@/lib/ai-triage-service";
import { queueAiTriage } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.object({
  conversationId: z.string().min(1).max(100),
  generation: z.string().min(1).max(100),
  userId: z.string().min(1).max(100),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const parsed = inputSchema.safeParse(await aiInput(request));
    if (!parsed.success) throw new AiError("Nieprawidłowe żądanie klasyfikacji.");
    const { conversationId, generation, userId } = parsed.data;
    const job = await queueAiTriage(conversationId, generation, userId);
    startAiTriage();
    return aiJson(job);
  } catch (error) { return aiErrorResponse(error); }
}
