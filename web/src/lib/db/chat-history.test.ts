/**
 * Per-user chat history: save → reload, and user isolation.
 * Drives shipped sessions-repo + notebook-messages-repo on the memory backend.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addMessage,
  createSession,
  getSession,
  listMessages,
  listSessions,
} from "./sessions-repo";
import {
  addNotebookMessage,
  listNotebookMessages,
} from "./notebook-messages-repo";
import {
  memMessages,
  memNotebookMessages,
  memSessions,
} from "./memory";

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
] as const;

describe("chat history per user (shipped repos, memory backend)", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of DB_KEYS) prev[k] = process.env[k];
    for (const k of DB_KEYS) delete process.env[k];
    process.env.ALLOW_MEMORY_DB = "1";
    memSessions.clear();
    memMessages.clear();
    memNotebookMessages.clear();
  });

  afterEach(() => {
    memSessions.clear();
    memMessages.clear();
    memNotebookMessages.clear();
    for (const k of DB_KEYS) setEnv(k, prev[k]);
  });

  it("web search: create session, save messages, reload by id for owner", async () => {
    const session = await createSession("My research", "user-a");
    expect(session.userId).toBe("user-a");

    await addMessage({
      sessionId: session.id,
      role: "user",
      content: "What is BM25?",
    });
    await addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "BM25 is a ranking function.",
      status: "completed",
    });

    const reloaded = await getSession(session.id, "user-a");
    expect(reloaded).not.toBeNull();
    expect(reloaded!.id).toBe(session.id);

    const messages = await listMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("What is BM25?");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toContain("BM25");

    const listed = await listSessions(20, "user-a");
    expect(listed.some((s) => s.id === session.id)).toBe(true);
  });

  it("web search: user B cannot load user A's session", async () => {
    const session = await createSession("Private", "user-a");
    await addMessage({
      sessionId: session.id,
      role: "user",
      content: "secret query",
    });

    const asB = await getSession(session.id, "user-b");
    expect(asB).toBeNull();

    const listB = await listSessions(20, "user-b");
    expect(listB.some((s) => s.id === session.id)).toBe(false);

    // Owner still sees it
    expect(await getSession(session.id, "user-a")).not.toBeNull();
  });

  it("dataset notebook: save and reload chat for same user", async () => {
    const notebookId = "nb-demo-1";
    await addNotebookMessage({
      notebookId,
      userId: "user-a",
      role: "user",
      content: "Summarize the corpus",
    });
    await addNotebookMessage({
      notebookId,
      userId: "user-a",
      role: "assistant",
      content: "The corpus discusses retrieval.",
    });

    const history = await listNotebookMessages(notebookId, "user-a");
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe("Summarize the corpus");
    expect(history[1].content).toContain("retrieval");
  });

  it("dataset notebook: user B does not see user A notebook messages", async () => {
    const notebookId = "nb-shared-demo";
    await addNotebookMessage({
      notebookId,
      userId: "user-a",
      role: "user",
      content: "only for A",
    });
    await addNotebookMessage({
      notebookId,
      userId: "user-a",
      role: "assistant",
      content: "reply to A",
    });

    const forB = await listNotebookMessages(notebookId, "user-b");
    expect(forB).toHaveLength(0);

    const forA = await listNotebookMessages(notebookId, "user-a");
    expect(forA).toHaveLength(2);
  });
});
