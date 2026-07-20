import type { SessionEntity } from "@/lib/context/types";

/** Stored in entities_json when search_sessions.user_id column is unavailable. */
export const APP_OWNER_ENTITY_TYPE = "app_owner";

/** search_sessions.summary prefix for dataset notebook chat threads (excluded from Web Search list). */
export const NB_CHAT_SUMMARY_PREFIX = "__nbchat__:";

export function ownerEntity(userId: string): SessionEntity {
  return { name: userId, type: APP_OWNER_ENTITY_TYPE };
}

export function ownerIdFromEntities(entities: SessionEntity[] | null | undefined): string | null {
  if (!entities?.length) return null;
  const hit = entities.find((e) => e.type === APP_OWNER_ENTITY_TYPE && e.name);
  return hit?.name ?? null;
}

export function withOwnerEntity(
  entities: SessionEntity[] | null | undefined,
  userId: string | null | undefined,
): SessionEntity[] {
  const base = (entities || []).filter((e) => e.type !== APP_OWNER_ENTITY_TYPE);
  if (!userId) return base;
  return [ownerEntity(userId), ...base];
}

/** Resolve owner from column and/or entities marker. */
export function resolveSessionOwner(
  userIdCol: string | null | undefined,
  entities: SessionEntity[] | null | undefined,
): string | null {
  if (userIdCol) return userIdCol;
  return ownerIdFromEntities(entities);
}

export function sessionOwnedBy(
  owner: string | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!userId) return true;
  if (!owner) return false;
  return owner === userId;
}

export function isNotebookChatSummary(summary: string | null | undefined): boolean {
  return Boolean(summary && summary.startsWith(NB_CHAT_SUMMARY_PREFIX));
}

export function notebookChatSummary(notebookId: string): string {
  return `${NB_CHAT_SUMMARY_PREFIX}${notebookId}`;
}

export function notebookIdFromChatSummary(summary: string | null | undefined): string | null {
  if (!summary?.startsWith(NB_CHAT_SUMMARY_PREFIX)) return null;
  return summary.slice(NB_CHAT_SUMMARY_PREFIX.length) || null;
}
