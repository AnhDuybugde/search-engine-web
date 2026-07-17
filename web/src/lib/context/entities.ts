import { extractProperNouns } from "./heuristics";
import type { SessionEntity } from "./types";
import { CONTEXT_DEFAULTS } from "./types";

function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

export function mergeEntities(
  existing: SessionEntity[],
  incoming: SessionEntity[],
  max = CONTEXT_DEFAULTS.maxEntities,
): SessionEntity[] {
  const map = new Map<string, SessionEntity>();

  for (const e of existing) {
    if (!e?.name) continue;
    map.set(normalizeKey(e.name), {
      name: e.name,
      type: e.type,
      aliases: e.aliases || [],
      salience: e.salience ?? 1,
    });
  }

  for (const e of incoming) {
    if (!e?.name) continue;
    const key = normalizeKey(e.name);
    const prev = map.get(key);
    if (prev) {
      const aliases = new Set([
        ...(prev.aliases || []),
        ...(e.aliases || []),
      ]);
      map.set(key, {
        name: e.name.length >= prev.name.length ? e.name : prev.name,
        type: e.type || prev.type,
        aliases: Array.from(aliases).slice(0, 8),
        salience: (prev.salience ?? 1) + 1 + (e.salience ?? 0),
      });
    } else {
      // Also match against aliases of existing
      let matched = false;
      for (const [k, prev] of map) {
        const aliasHit = (prev.aliases || []).some(
          (a) => normalizeKey(a) === key,
        );
        const nameHit = normalizeKey(prev.name) === key;
        if (aliasHit || nameHit) {
          map.set(k, {
            ...prev,
            salience: (prev.salience ?? 1) + 1,
            aliases: Array.from(
              new Set([...(prev.aliases || []), e.name]),
            ).slice(0, 8),
          });
          matched = true;
          break;
        }
      }
      if (!matched) {
        map.set(key, {
          name: e.name,
          type: e.type,
          aliases: e.aliases || [],
          salience: e.salience ?? 1,
        });
      }
    }
  }

  return Array.from(map.values())
    .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
    .slice(0, max);
}

export function entitiesFromText(
  text: string,
  type?: string,
): SessionEntity[] {
  const fromProper = extractProperNouns(text).map((name) => ({
    name,
    type,
    salience: 1,
  }));

  // Short "X là ai?" / "who is X" style questions without capitals
  const shortSubject = text
    .trim()
    .match(
      /^(?:who\s+is|what\s+is|who\s+was)?\s*([A-Za-zÀ-ỹ][\wÀ-ỹ.'-]{1,40})(?:\s+(?:là|is|was)\b)?/iu,
    );
  const extra: SessionEntity[] = [];
  if (shortSubject?.[1]) {
    const name = shortSubject[1];
    const stop = /^(who|what|when|where|why|how|the|a|an|is|are|was|were|là|ai|cái|của)$/i;
    if (!stop.test(name)) {
      extra.push({ name, type, salience: 1 });
    }
  }

  return mergeEntities(fromProper, extra);
}

export function bumpEntity(
  entities: SessionEntity[],
  name: string,
): SessionEntity[] {
  return mergeEntities(entities, [{ name, salience: 1 }]);
}
