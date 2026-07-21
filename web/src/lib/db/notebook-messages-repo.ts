import { randomUUID } from "crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Metrics, RankedChunk, RankedDocument, Timing } from "@/lib/ir/types";
import {
  assertDurableDb,
  enrichDbError,
  getDb,
  hasDb,
  isMemoryDbAllowed,
} from "./client";
import {
  ensureChatHistorySqlSchema,
  preferSqlChatHistory,
} from "./chat-history-schema";
import { notebookMessages } from "./schema";
import { getSupabaseAdmin, sbError, toIso } from "./supabase";
import { memNotebookMessages, type MemNotebookMessage } from "./memory";

export type NotebookMessageDto = {
  id: string;
  notebookId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  results: RankedChunk[] | null;
  timing: Timing | null;
  metrics: Metrics | null;
  documents: RankedDocument[] | null;
  status: string;
  createdAt: string;
};

function memToDto(m: MemNotebookMessage): NotebookMessageDto {
  return {
    id: m.id,
    notebookId: m.notebookId,
    userId: m.userId,
    role: m.role,
    content: m.content,
    results: (m.results as RankedChunk[] | null) ?? null,
    timing: (m.timing as Timing | null) ?? null,
    metrics: (m.metrics as Metrics | null) ?? null,
    documents: (m.documents as RankedDocument[] | null) ?? null,
    status: m.status,
    createdAt: m.createdAt,
  };
}

function isMissingNotebookMessagesTable(error: unknown): boolean {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof error === "object"
          ? JSON.stringify(error)
          : String(error);
  return (
    /notebook_messages/i.test(text) &&
    (/PGRST205/i.test(text) ||
      /schema cache/i.test(text) ||
      /does not exist/i.test(text) ||
      /Could not find the table/i.test(text) ||
      /relation/i.test(text))
  );
}

function listFromMemory(
  notebookId: string,
  userId: string,
): NotebookMessageDto[] {
  return Array.from(memNotebookMessages.values())
    .filter((m) => m.notebookId === notebookId && m.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(memToDto);
}

function saveToMemory(row: NotebookMessageDto): NotebookMessageDto {
  memNotebookMessages.set(row.id, {
    id: row.id,
    notebookId: row.notebookId,
    userId: row.userId,
    role: row.role,
    content: row.content,
    results: row.results,
    timing: row.timing,
    metrics: row.metrics,
    documents: row.documents,
    status: row.status,
    createdAt: row.createdAt,
  });
  return row;
}

async function listViaSql(
  notebookId: string,
  userId: string,
): Promise<NotebookMessageDto[]> {
  const ready = await ensureChatHistorySqlSchema();
  if (!ready) {
    throw new Error("SQL chat-history schema is not available");
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(notebookMessages)
    .where(
      and(
        eq(notebookMessages.notebookId, notebookId),
        eq(notebookMessages.userId, userId),
      ),
    )
    .orderBy(asc(notebookMessages.createdAt));
  return rows.map((r) => ({
    id: r.id,
    notebookId: r.notebookId,
    userId: r.userId,
    role: r.role as "user" | "assistant",
    content: r.content,
    results: (r.resultsJson as RankedChunk[] | null) || null,
    timing: (r.timingJson as Timing | null) || null,
    metrics: (r.metricsJson as Metrics | null) || null,
    documents: (r.documentsJson as RankedDocument[] | null) || null,
    status: r.status,
    createdAt: toIso(r.createdAt),
  }));
}

async function insertViaSql(row: NotebookMessageDto): Promise<void> {
  const ready = await ensureChatHistorySqlSchema();
  if (!ready) {
    throw new Error("SQL chat-history schema is not available");
  }
  const db = getDb();
  await db.insert(notebookMessages).values({
    id: row.id,
    notebookId: row.notebookId,
    userId: row.userId,
    role: row.role,
    content: row.content,
    resultsJson: row.results,
    timingJson: row.timing,
    metricsJson: row.metrics,
    documentsJson: row.documents,
    status: row.status,
    createdAt: new Date(row.createdAt),
  });
}

export async function listNotebookMessages(
  notebookId: string,
  userId: string,
): Promise<NotebookMessageDto[]> {
  assertDurableDb("List notebook messages");
  if (!hasDb()) {
    return listFromMemory(notebookId, userId);
  }

  // Prefer SQL only when DATABASE_URL is reachable and schema is ready.
  if (await preferSqlChatHistory()) {
    try {
      return await listViaSql(notebookId, userId);
    } catch (err) {
      if (!getSupabaseAdmin() && !isMemoryDbAllowed()) {
        throw enrichDbError(err, "List notebook messages");
      }
      console.warn(
        "[listNotebookMessages] SQL path failed, trying REST/memory:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("notebook_messages")
      .select("*")
      .eq("notebook_id", notebookId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) {
      if (isMissingNotebookMessagesTable(error)) {
        // REST table missing — try SQL once more only if ready, else memory.
        if (await preferSqlChatHistory()) {
          try {
            return await listViaSql(notebookId, userId);
          } catch {
            /* fall through */
          }
        }
        if (isMemoryDbAllowed()) {
          return listFromMemory(notebookId, userId);
        }
        throw new Error(
          "List notebook messages failed: table notebook_messages is missing. " +
            "Run: cd web && npm run db:init (or apply drizzle/0004_chat_history_owners.sql in Supabase SQL Editor).",
        );
      }
      throw new Error(`List notebook messages failed: ${sbError(error)}`);
    }
    return (data || []).map((r) => ({
      id: r.id as string,
      notebookId: r.notebook_id as string,
      userId: r.user_id as string,
      role: r.role as "user" | "assistant",
      content: r.content as string,
      results: (r.results_json as RankedChunk[] | null) || null,
      timing: (r.timing_json as Timing | null) || null,
      metrics: (r.metrics_json as Metrics | null) || null,
      documents: (r.documents_json as RankedDocument[] | null) || null,
      status: (r.status as string) || "completed",
      createdAt: toIso(r.created_at),
    }));
  }

  if (await preferSqlChatHistory()) {
    try {
      return await listViaSql(notebookId, userId);
    } catch (err) {
      if (isMemoryDbAllowed()) return listFromMemory(notebookId, userId);
      throw enrichDbError(err, "List notebook messages");
    }
  }

  if (isMemoryDbAllowed()) return listFromMemory(notebookId, userId);
  throw new Error(
    "List notebook messages failed: no durable chat-history backend. " +
      "Configure DATABASE_URL with migrations, or SUPABASE notebook_messages table.",
  );
}

export async function addNotebookMessage(params: {
  notebookId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  results?: RankedChunk[] | null;
  timing?: Timing | null;
  metrics?: Metrics | null;
  documents?: RankedDocument[] | null;
  status?: string;
}): Promise<NotebookMessageDto> {
  assertDurableDb("Save notebook message");
  const id = randomUUID();
  const now = new Date().toISOString();
  const row: NotebookMessageDto = {
    id,
    notebookId: params.notebookId,
    userId: params.userId,
    role: params.role,
    content: params.content,
    results: params.results ?? null,
    timing: params.timing ?? null,
    metrics: params.metrics ?? null,
    documents: params.documents ?? null,
    status: params.status || "completed",
    createdAt: now,
  };

  if (!hasDb()) {
    return saveToMemory(row);
  }

  if (await preferSqlChatHistory()) {
    try {
      await insertViaSql(row);
      return row;
    } catch (err) {
      if (!getSupabaseAdmin() && !isMemoryDbAllowed()) {
        throw enrichDbError(err, "Save notebook message");
      }
      console.warn(
        "[addNotebookMessage] SQL path failed, trying REST/memory:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { error } = await sb.from("notebook_messages").insert({
      id,
      notebook_id: row.notebookId,
      user_id: row.userId,
      role: row.role,
      content: row.content,
      results_json: row.results,
      timing_json: row.timing,
      metrics_json: row.metrics,
      documents_json: row.documents,
      status: row.status,
      created_at: now,
    });
    if (error) {
      if (isMissingNotebookMessagesTable(error)) {
        if (await preferSqlChatHistory()) {
          try {
            await insertViaSql(row);
            return row;
          } catch {
            /* fall through */
          }
        }
        if (isMemoryDbAllowed()) {
          return saveToMemory(row);
        }
        const detail = sbError(error);
        throw new Error(
          `Save notebook message failed: table notebook_messages is missing. ` +
            `Run: cd web && npm run db:init (or apply drizzle/0004_chat_history_owners.sql). Details: ${detail}`,
        );
      }
      throw new Error(`Save notebook message failed: ${sbError(error)}`);
    }
    return row;
  }

  if (await preferSqlChatHistory()) {
    try {
      await insertViaSql(row);
      return row;
    } catch (err) {
      if (isMemoryDbAllowed()) return saveToMemory(row);
      throw enrichDbError(err, "Save notebook message");
    }
  }

  if (isMemoryDbAllowed()) return saveToMemory(row);
  throw new Error(
    "Save notebook message failed: no durable chat-history backend. " +
      "Configure DATABASE_URL with migrations, or SUPABASE notebook_messages table.",
  );
}
