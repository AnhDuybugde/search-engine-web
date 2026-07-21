import { requireUserId } from "@/lib/auth";
import { getAvailableLlmModels, getConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;

  const cfg = getConfig();
  return Response.json({
    provider: "OpenAI-compatible providers",
    defaultModel: cfg.LLM_MODEL,
    models: getAvailableLlmModels(cfg),
  });
}
