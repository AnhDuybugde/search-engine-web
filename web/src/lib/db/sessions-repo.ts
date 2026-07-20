import { asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { SessionEntity } from "@/lib/context/types";
import type { Metrics, RankedChunk, Timing } from "@/lib/ir/types";
import { assertDurableDb, enrichDbError, getDb, hasDb } from "./client";
import { searchMessages, searchSessions } from "./schema";
import { getSupabaseAdmin, sbError, toIso } from "./supabase";
import {
  memMessages,
  memSessions,
  type MemSearchMessage,
  type MemSearchSession,
} from "./memory";

export type SearchSessionDto = {
  id: string;
  title: string;
  summary: string | null;
  entities: SessionEntity[];
  createdAt: string;
  updatedAt: string;
};

export type SearchMessageDto = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  expandedQuery: string | null;
  results: RankedChunk[] | null;
  timing: Timing | null;
  metrics: Metrics | null;
  status: string;
  createdAt: string;
};

export type SessionListItem = {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  preview?: string | null;
};

function titleFromQuery(query: string): string {
  const t = query.replace(/\s+/g, " ").trim();
  if (t.length <= 48) return t || "New chat";
  return `${t.slice(0, 47)}…`;
}

function parseEntities(raw: unknown): SessionEntity[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is SessionEntity =>
      Boolean(e && typeof e === "object" && typeof (e as SessionEntity).name === "string"),
  );
}

function memSessionToDto(s: MemSearchSession): SearchSessionDto {
  return {
    id: s.id,
    title: s.title,
    summary: s.summary,
    entities: s.entities,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function memMessageToDto(m: MemSearchMessage): SearchMessageDto {
  return { ...m };
}

export async function listSessions(limit = 40): Promise<SessionListItem[]> {
  assertDurableDb('List sessions');
  if (!hasDb()) {
    return Array.from(memSessions.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((s) => {
        const msgs = Array.from(memMessages.values())
          .filter((m) => m.sessionId === s.id && m.role === "user")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return {
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          createdAt: s.createdAt,
          preview: msgs[0]?.content?.slice(0, 80) || null,
        };
      });
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("search_sessions")
      .select("id,title,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("[listSessions]", sbError(error));
      return [];
    }
    return (data || []).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    }));
  }

  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(searchSessions)
      .orderBy(desc(searchSessions.updatedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: toIso(r.createdAt),
      updatedAt: toIso(r.updatedAt),
    }));
  } catch (err) {
    console.error("[listSessions]", enrichDbError(err, "List sessions").message);
    return [];
  }
}

export async function createSession(title?: string): Promise<SearchSessionDto> {
  assertDurableDb('Create session');
  const id = randomUUID();
  const now = new Date().toISOString();
  const row: SearchSessionDto = {
    id,
    title: (title || "New chat").trim() || "New chat",
    summary: null,
    entities: [],
    createdAt: now,
    updatedAt: now,
  };

  if (!hasDb()) {
    memSessions.set(id, {
      id,
      title: row.title,
      summary: null,
      entities: [],
      createdAt: now,
      updatedAt: now,
    });
    return row;
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { error } = await sb.from("search_sessions").insert({
      id,
      title: row.title,
      summary: null,
      entities_json: [],
      created_at: now,
      updated_at: now,
    });
    if (error) {
      const detail = sbError(error);
      const missingTable =
        /search_sessions|PGRST205|schema cache|does not exist/i.test(detail);
      throw new Error(
        missingTable
          ? `Create session failed: table search_sessions is missing. Run: cd web && npm run db:init (or apply drizzle/0001_search_sessions.sql in Supabase SQL Editor). Details: ${detail}`
          : `Create session failed: ${detail}`,
      );
    }
    return row;
  }

  try {
    const db = getDb();
    await db.insert(searchSessions).values({
      id,
      title: row.title,
      summary: null,
      entitiesJson: [],
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
    return row;
  } catch (err) {
    throw enrichDbError(err, "Create session");
  }
}

export async function getSession(id: string): Promise<SearchSessionDto | null> {
  assertDurableDb('Get session');
  if (!hasDb()) {
    const s = memSessions.get(id);
    return s ? memSessionToDto(s) : null;
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("search_sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id as string,
      title: data.title as string,
      summary: (data.summary as string | null) || null,
      entities: parseEntities(data.entities_json),
      createdAt: toIso(data.created_at),
      updatedAt: toIso(data.updated_at),
    };
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(searchSessions)
    .where(eq(searchSessions.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    entities: parseEntities(r.entitiesJson),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

export async function listMessages(sessionId: string): Promise<SearchMessageDto[]> {
  assertDurableDb('List messages');
  if (!hasDb()) {
    return Array.from(memMessages.values())
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(memMessageToDto);
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("search_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[listMessages]", sbError(error));
      return [];
    }
    return (data || []).map((r) => ({
      id: r.id as string,
      sessionId: r.session_id as string,
      role: r.role as "user" | "assistant",
      content: r.content as string,
      expandedQuery: (r.expanded_query as string | null) || null,
      results: (r.results_json as RankedChunk[] | null) || null,
      timing: (r.timing_json as Timing | null) || null,
      metrics: (r.metrics_json as Metrics | null) || null,
      status: r.status as string,
      createdAt: toIso(r.created_at),
    }));
  }

  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(searchMessages)
      .where(eq(searchMessages.sessionId, sessionId))
      .orderBy(asc(searchMessages.createdAt));
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      role: r.role as "user" | "assistant",
      content: r.content,
      expandedQuery: r.expandedQuery,
      results: (r.resultsJson as RankedChunk[] | null) || null,
      timing: (r.timingJson as Timing | null) || null,
      metrics: (r.metricsJson as Metrics | null) || null,
      status: r.status,
      createdAt: toIso(r.createdAt),
    }));
  } catch (err) {
    console.error("[listMessages]", enrichDbError(err, "List messages").message);
    return [];
  }
}

export async function updateSession(
  id: string,
  patch: {
    title?: string;
    summary?: string | null;
    entities?: SessionEntity[];
  },
): Promise<SearchSessionDto | null> {
  assertDurableDb('Update session');
  const existing = await getSession(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const next: SearchSessionDto = {
    ...existing,
    title: patch.title?.trim() || existing.title,
    summary:
      patch.summary !== undefined ? patch.summary : existing.summary,
    entities: patch.entities !== undefined ? patch.entities : existing.entities,
    updatedAt: now,
  };

  if (!hasDb()) {
    memSessions.set(id, {
      id,
      title: next.title,
      summary: next.summary,
      entities: next.entities,
      createdAt: next.createdAt,
      updatedAt: now,
    });
    return next;
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { error } = await sb
      .from("search_sessions")
      .update({
        title: next.title,
        summary: next.summary,
        entities_json: next.entities,
        updated_at: now,
      })
      .eq("id", id);
    if (error) throw new Error(`Update session failed: ${sbError(error)}`);
    return next;
  }

  try {
    const db = getDb();
    await db
      .update(searchSessions)
      .set({
        title: next.title,
        summary: next.summary,
        entitiesJson: next.entities,
        updatedAt: new Date(now),
      })
      .where(eq(searchSessions.id, id));
    return next;
  } catch (err) {
    throw enrichDbError(err, "Update session");
  }
}

export async function deleteSession(id: string): Promise<boolean> {
  assertDurableDb('Delete session');
  if (!hasDb()) {
    const existed = memSessions.has(id);
    memSessions.delete(id);
    for (const [mid, m] of memMessages) {
      if (m.sessionId === id) memMessages.delete(mid);
    }
    return existed;
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    await sb.from("search_messages").delete().eq("session_id", id);
    const { error } = await sb.from("search_sessions").delete().eq("id", id);
    if (error) throw new Error(`Delete session failed: ${sbError(error)}`);
    return true;
  }

  try {
    const db = getDb();
    await db.delete(searchMessages).where(eq(searchMessages.sessionId, id));
    await db.delete(searchSessions).where(eq(searchSessions.id, id));
    return true;
  } catch (err) {
    throw enrichDbError(err, "Delete session");
  }
}

export async function addMessage(params: {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  expandedQuery?: string | null;
  results?: RankedChunk[] | null;
  timing?: Timing | null;
  metrics?: Metrics | null;
  status?: string;
}): Promise<SearchMessageDto> {
  assertDurableDb('Save message');
  const id = randomUUID();
  const now = new Date().toISOString();
  const row: SearchMessageDto = {
    id,
    sessionId: params.sessionId,
    role: params.role,
    content: params.content,
    expandedQuery: params.expandedQuery ?? null,
    results: params.results ?? null,
    timing: params.timing ?? null,
    metrics: params.metrics ?? null,
    status: params.status || "completed",
    createdAt: now,
  };

  if (!hasDb()) {
    memMessages.set(id, row);
    const session = memSessions.get(params.sessionId);
    if (session) {
      session.updatedAt = now;
      memSessions.set(params.sessionId, session);
    }
    // Cap messages in memory
    if (memMessages.size > 500) {
      const sorted = Array.from(memMessages.values()).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      for (const old of sorted.slice(0, memMessages.size - 500)) {
        memMessages.delete(old.id);
      }
    }
    return row;
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { error } = await sb.from("search_messages").insert({
      id,
      session_id: params.sessionId,
      role: params.role,
      content: params.content,
      expanded_query: row.expandedQuery,
      results_json: row.results,
      timing_json: row.timing,
      metrics_json: row.metrics,
      status: row.status,
      created_at: now,
    });
    if (error) {
      throw new Error(`Save message failed: ${sbError(error)}`);
    }
    await sb
      .from("search_sessions")
      .update({ updated_at: now })
      .eq("id", params.sessionId);
    return row;
  }

  try {
    const db = getDb();
    await db.insert(searchMessages).values({
      id,
      sessionId: params.sessionId,
      role: params.role,
      content: params.content,
      expandedQuery: row.expandedQuery,
      resultsJson: row.results,
      timingJson: row.timing,
      metricsJson: row.metrics,
      status: row.status,
      createdAt: new Date(now),
    });
    await db
      .update(searchSessions)
      .set({ updatedAt: new Date(now) })
      .where(eq(searchSessions.id, params.sessionId));
  } catch (err) {
    throw enrichDbError(err, "Save message");
  }

  return row;
}

export { titleFromQuery };
