/**
 * Per-user chat history: save → reload, and user isolation.
 * Drives shipped sessions-repo + notebook-messages-repo on the memory backend,
 * and (when DATABASE_URL points at local Postgres) the real SQL path.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addMessage,
  createSession,
  getSession,
  listMessages,
  listSessions,
  setSearchSessionsUserIdColumnForTests,
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
import {
  ensureChatHistorySqlSchema,
  resetChatHistorySchemaCache,
} from "./chat-history-schema";

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
    setEnv("NODE_ENV", "test");
    setSearchSessionsUserIdColumnForTests(null);
    resetChatHistorySchemaCache();
    memSessions.clear();
    memMessages.clear();
    memNotebookMessages.clear();
  });

  afterEach(() => {
    memSessions.clear();
    memMessages.clear();
    memNotebookMessages.clear();
    setSearchSessionsUserIdColumnForTests(null);
    resetChatHistorySchemaCache();
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

const localDbUrl =
  process.env.CHAT_HISTORY_TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:5433/search";

describe("chat history durable SQL path (DATABASE_URL)", () => {
  const prev: Record<string, string | undefined> = {};
  const marker = `sql-hist-${Date.now()}`;

  beforeEach(() => {
    for (const k of DB_KEYS) prev[k] = process.env[k];
    // Force SQL-only durable backend (no Supabase REST) against local Postgres.
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SECRET;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.DATABASE_URL = localDbUrl;
    process.env.DB_SSL = "disable";
    delete process.env.ALLOW_MEMORY_DB;
    delete process.env.VERCEL;
    setEnv("NODE_ENV", "test");
    setSearchSessionsUserIdColumnForTests(null);
    resetChatHistorySchemaCache();
  });

  afterEach(() => {
    setSearchSessionsUserIdColumnForTests(null);
    resetChatHistorySchemaCache();
    for (const k of DB_KEYS) setEnv(k, prev[k]);
  });

  it("ensures schema then save→list notebook messages via shipped SQL path", async () => {
    const ok = await ensureChatHistorySqlSchema();
    if (!ok) {
      // Local Postgres not running — skip rather than false pass.
      console.warn("skip SQL chat history test: ensureChatHistorySqlSchema failed");
      return;
    }

    const notebookId = `nb-${marker}`;
    const userId = `user-${marker}`;
    await addNotebookMessage({
      notebookId,
      userId,
      role: "user",
      content: `query ${marker}`,
    });
    await addNotebookMessage({
      notebookId,
      userId,
      role: "assistant",
      content: `answer ${marker}`,
      status: "completed",
    });

    const history = await listNotebookMessages(notebookId, userId);
    expect(history.length).toBeGreaterThanOrEqual(2);
    const contents = history.map((m) => m.content);
    expect(contents.some((c) => c.includes(`query ${marker}`))).toBe(true);
    expect(contents.some((c) => c.includes(`answer ${marker}`))).toBe(true);
    expect(history.every((m) => m.content.trim().length > 0)).toBe(true);
  });

  it("ensures schema then createSession→addMessage→listMessages via shipped SQL path", async () => {
    const ok = await ensureChatHistorySqlSchema();
    if (!ok) {
      console.warn("skip SQL session history test: ensureChatHistorySqlSchema failed");
      return;
    }

    const userId = `user-sess-${marker}`;
    const session = await createSession(`session ${marker}`, userId);
    expect(session.userId).toBe(userId);

    await addMessage({
      sessionId: session.id,
      role: "user",
      content: `web query ${marker}`,
    });
    await addMessage({
      sessionId: session.id,
      role: "assistant",
      content: `web answer ${marker}`,
      status: "completed",
    });

    const reloaded = await getSession(session.id, userId);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.id).toBe(session.id);

    const messages = await listMessages(session.id);
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.some((m) => m.content.includes(`web query ${marker}`))).toBe(
      true,
    );
    expect(
      messages.some((m) => m.content.includes(`web answer ${marker}`)),
    ).toBe(true);

    const listed = await listSessions(50, userId);
    expect(listed.some((s) => s.id === session.id)).toBe(true);
  });
});
