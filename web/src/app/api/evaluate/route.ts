import { NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import { evaluateRAG } from "@/lib/llm/evaluator";
import { updateSearchMessageMetrics } from "@/lib/db/sessions-repo";
import { updateNotebookMessageMetrics } from "@/lib/db/notebook-messages-repo";
import { elapsed, nowMs } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = requireUserId(req);
  if ("error" in auth) {
    return auth.error;
  }

  try {
    const body = await req.json();
    const { messageId, messageType, query, context, answer, model } = body;

    if (!query || !context || !answer) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    const start = nowMs();
    const metrics = await evaluateRAG({ query, context, answer, model });
    const evaluationMs = elapsed(start);

    // Save metrics if messageId and messageType are provided
    if (messageId && messageType) {
      if (messageType === "search") {
        await updateSearchMessageMetrics(messageId, metrics);
      } else if (messageType === "notebook") {
        await updateNotebookMessageMetrics(messageId, metrics);
      }
    }

    return Response.json({ metrics, evaluationMs });
  } catch (error) {
    console.error("Evaluation API error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Evaluation failed" },
      { status: 500 }
    );
  }
}
