/**
 * UI ↔ API contract tests: drive shipped route handlers + pipeline/SSE helpers
 * with the same field shapes DatasetChatLayout / use-search-chat / use-sse consume.
 * Memory backend only — no remote DB required.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APP_SESSION_COOKIE,
  requireUserId,
  signUserSessionToken,
} from "@/lib/auth";
import { resetChatHistorySchemaCache } from "@/lib/db/chat-history-schema";
import {
  addNotebookMessage,
  listNotebookMessages,
} from "@/lib/db/notebook-messages-repo";
import {
  addSource,
  createNotebook,
  listNotebooks,
  loadChunks,
} from "@/lib/db/notebooks-repo";
import {
  createSession,
  listSessions,
  addMessage,
  listMessages,
  getSession,
  setSearchSessionsUserIdColumnForTests,
} from "@/lib/db/sessions-repo";
import {
  memChunks,
  memMessages,
  memNotebookMessages,
  memNotebooks,
  memSessions,
  memSources,
  memUsers,
} from "@/lib/db/memory";
import { runNotebookAskPipeline } from "@/lib/pipeline/notebook-ask";
import { createSseResponse, createUploadSseResponse, encodeSse } from "@/lib/sse";
import type { StreamEvent, UploadStreamEvent } from "@/lib/ir/types";
import { applySseEvent, finalizeSseOnStreamEnd } from "@/lib/hooks/use-sse";

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const DB_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "DATABASE_URL",
  "ALLOW_MEMORY_DB",
  "VERCEL",
  "VERCEL_ENV",
  "AUTH_DISABLED",
] as const;

async function readSseEvents(
  res: Response,
): Promise<Array<StreamEvent | UploadStreamEvent>> {
  const text = await res.text();
  const events: Array<StreamEvent | UploadStreamEvent> = [];
  for (const block of text.split("\n\n")) {
    const line = block
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("data:"));
    if (!line) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload) as StreamEvent | UploadStreamEvent);
    } catch {
      /* skip */
    }
  }
  return events;
}

describe("UI↔API contracts (shipped handlers, memory backend)", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of DB_KEYS) prev[k] = process.env[k];
    for (const k of DB_KEYS) delete process.env[k];
    process.env.ALLOW_MEMORY_DB = "1";
    process.env.NODE_ENV = "test";
    process.env.AUTH_DISABLED = "1";
    setSearchSessionsUserIdColumnForTests(null);
    resetChatHistorySchemaCache();
    memNotebooks.clear();
    memSources.clear();
    memChunks.clear();
    memSessions.clear();
    memMessages.clear();
    memNotebookMessages.clear();
    memUsers.clear();
  });

  afterEach(() => {
    memNotebooks.clear();
    memSources.clear();
    memChunks.clear();
    memSessions.clear();
    memMessages.clear();
    memNotebookMessages.clear();
    memUsers.clear();
    setSearchSessionsUserIdColumnForTests(null);
    resetChatHistorySchemaCache();
    for (const k of DB_KEYS) setEnv(k, prev[k]);
  });

  it("auth requireUserId + cookie claims match /api/auth/me shape expectations", () => {
    const userId = "user-contract-1";
    const token = signUserSessionToken(userId);
    const req = new Request("http://localhost/api/notebooks", {
      headers: { cookie: `${APP_SESSION_COOKIE}=${encodeURIComponent(token)}` },
    });
    const auth = requireUserId(req);
    expect("userId" in auth && auth.userId).toBe(userId);

    const unauth = requireUserId(new Request("http://localhost/api/x"));
    // AUTH_DISABLED=1 → anonymous guest, not 401
    expect("userId" in unauth && unauth.userId).toBe("anonymous");
  });

  it("notebook list/create return { items } / { id, title } for DatasetChatLayout", async () => {
    const created = await createNotebook("Contract Dataset");
    expect(created.id).toBeTruthy();
    expect(created.title).toBe("Contract Dataset");
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBeTruthy();

    const items = await listNotebooks();
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((n) => n.id === created.id)).toBe(true);
    // UI maps items → sidebar; requires id + title
    const hit = items.find((n) => n.id === created.id)!;
    expect(hit.title).toBe("Contract Dataset");
  });

  it("updateNotebook renames for sidebar pencil edit", async () => {
    const { updateNotebook } = await import("./db/notebooks-repo");
    const created = await createNotebook("Old name");
    const updated = await updateNotebook(created.id, { title: "New name" });
    expect(updated?.title).toBe("New name");
    const again = await listNotebooks();
    expect(again.find((n) => n.id === created.id)?.title).toBe("New name");
  });

  it("search sessions list/create return { items } / { id } for useSearchSessions", async () => {
    const owner = "owner-a";
    const session = await createSession("Probe Chat", owner);
    expect(session.id).toBeTruthy();
    expect(session.userId).toBe(owner);
    expect(session.title).toBe("Probe Chat");

    const items = await listSessions(50, owner);
    expect(items.some((s) => s.id === session.id)).toBe(true);
    const other = await listSessions(50, "owner-b");
    expect(other.some((s) => s.id === session.id)).toBe(false);

    const loaded = await getSession(session.id, owner);
    expect(loaded?.title).toBe("Probe Chat");
    expect(await getSession(session.id, "owner-b")).toBeNull();
  });

  it("notebook upload store → loadChunks → ask SSE emits run_completed for use-sse", async () => {
    const nb = await createNotebook("Ask corpus");
    const body =
      "BM25 is a probabilistic bag-of-words ranking function for lexical retrieval.";
    const source = await addSource({
      notebookId: nb.id,
      title: "bm25.txt",
      mime: "text/plain",
      text: body,
    });
    expect(source.mode).toBe("raw-sources-only");
    expect(source.chunkCount).toBe(0);
    expect(source.id).toBeTruthy();
    expect(source.charCount).toBe(body.length);

    const chunks = await loadChunks(nb.id);
    expect(chunks.length).toBeGreaterThan(0);

    const events: StreamEvent[] = [];
    const result = await runNotebookAskPipeline(
      {
        query: "What is BM25?",
        chunks,
        generateAnswer: false,
        contextTopK: 3,
        documentTopK: 5,
        retrieveTopK: 20,
      },
      (e) => events.push(e),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain("query_started");
    expect(types).toContain("run_completed");
    expect(result.results.length).toBeGreaterThan(0);

    // UI reducer must accept the shipped events
    let state = {
      status: "running" as const,
      answer: "",
      results: [] as typeof result.results,
      rankedChunks: [] as typeof result.results,
      documents: [] as typeof result.documents,
      timing: null as typeof result.timing | null,
      metrics: null as typeof result.metrics | null,
      error: null as string | null,
      logs: [] as string[],
      steps: {
        corpus: "success" as const,
        query: "pending" as const,
        retrieve: "pending" as const,
        embedding: "pending" as const,
        fusion: "pending" as const,
        pack: "pending" as const,
        generate: "pending" as const,
        search: "pending" as const,
        fetch: "pending" as const,
        chunk: "pending" as const,
      },
    };
    for (const ev of events) {
      state = applySseEvent(state, ev) as typeof state;
    }
    expect(state.status).toBe("completed");
    expect(state.results.length).toBeGreaterThan(0);
    // Stream end without run_completed would fail — confirm completed stays
    expect(finalizeSseOnStreamEnd(state).status).toBe("completed");
  });

  it("createSseResponse encodes progressive events + run_completed the UI parses", async () => {
    const res = createSseResponse(async (emit) => {
      emit({ type: "query_started", query: "hi" });
      emit({ type: "generation_token", token: "Hel" });
      emit({ type: "generation_token", token: "lo" });
      emit({
        type: "run_completed",
        answer: "Hello",
        timing: { totalMs: 12 },
        metrics: { llmUsed: true, chunkCount: 1 },
        results: [],
      });
    });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const events = await readSseEvents(res);
    expect(events.map((e) => e.type)).toEqual([
      "query_started",
      "generation_token",
      "generation_token",
      "run_completed",
    ]);
    const done = events.find((e) => e.type === "run_completed") as Extract<
      StreamEvent,
      { type: "run_completed" }
    >;
    expect(done.answer).toBe("Hello");
    expect(done.metrics.llmUsed).toBe(true);
  });

  it("createUploadSseResponse emits upload stage events use-upload-sse handles", async () => {
    const res = createUploadSseResponse(async (emit) => {
      emit({ type: "upload_started", filename: "a.txt", bytes: 10 });
      emit({ type: "extract_completed", chars: 8, ms: 1 });
      emit({ type: "store_completed", sourceId: "src-1", ms: 2 });
      emit({
        type: "upload_completed",
        source: {
          id: "src-1",
          title: "a.txt",
          chunkCount: 0,
          charCount: 8,
          mode: "raw-sources-only",
        },
        timing: { extractMs: 1, storeMs: 2, totalMs: 3 },
        metrics: {
          chunkCount: 0,
          charCount: 8,
          embeddedCount: 0,
          mode: "raw-sources-only",
        },
      });
    });
    const events = await readSseEvents(res);
    expect(events.map((e) => e.type)).toEqual([
      "upload_started",
      "extract_completed",
      "store_completed",
      "upload_completed",
    ]);
  });

  it("encodeSse produces data: JSON frames", () => {
    const frame = encodeSse({ type: "error", message: "boom" });
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    const parsed = JSON.parse(frame.slice(6).trim()) as { type: string };
    expect(parsed.type).toBe("error");
  });

  it("notebook messages save→list for DatasetChatLayout history panel", async () => {
    const nb = await createNotebook("Hist");
    const userId = "hist-user";
    await addNotebookMessage({
      notebookId: nb.id,
      userId,
      role: "user",
      content: "What is BM25?",
    });
    await addNotebookMessage({
      notebookId: nb.id,
      userId,
      role: "assistant",
      content: "A ranking function.",
      status: "completed",
    });
    const messages = await listNotebookMessages(nb.id, userId);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].content).toContain("ranking");
    // isolation
    expect(await listNotebookMessages(nb.id, "other")).toHaveLength(0);
  });

  it("search session messages shape includes fields useSearchChat hydrates", async () => {
    const session = await createSession("Web", "u1");
    await addMessage({
      sessionId: session.id,
      role: "user",
      content: "Who is Messi?",
      expandedQuery: "Lionel Messi footballer",
    });
    await addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "A footballer.",
      status: "completed",
      results: [],
    });
    const messages = await listMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].expandedQuery).toBe("Lionel Messi footballer");
    expect(messages[1].status).toBe("completed");
  });
});
