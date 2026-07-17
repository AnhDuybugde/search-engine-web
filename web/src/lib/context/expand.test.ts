import { describe, expect, it } from "vitest";
import { mergeEntities } from "./entities";
import {
  hasDeicticReference,
  heuristicExpand,
  needsExpansion,
} from "./heuristics";
import { expandQuery, buildMemoryFromSession } from "./expand";
import type { SessionMemory } from "./types";

const messiMemory: SessionMemory = {
  entities: [
    {
      name: "Lionel Messi",
      type: "person",
      aliases: ["Messi"],
      salience: 3,
    },
  ],
  summary: null,
  recentTurns: [
    {
      role: "user",
      text: "Messi là ai?",
    },
    {
      role: "assistant",
      text: "Lionel Messi is an Argentine footballer...",
    },
  ],
};

describe("heuristics", () => {
  it("detects Vietnamese deictics", () => {
    expect(hasDeicticReference("ông ấy bao nhiêu tuổi?")).toBe(true);
    expect(hasDeicticReference("cô ấy sống ở đâu")).toBe(true);
  });

  it("detects English pronouns", () => {
    expect(hasDeicticReference("how old is he?")).toBe(true);
    expect(hasDeicticReference("what about her career?")).toBe(true);
  });

  it("does not flag self-contained queries", () => {
    expect(hasDeicticReference("What is TypeScript?")).toBe(false);
  });

  it("heuristic expands with dominant entity", () => {
    const r = heuristicExpand("ông ấy bao nhiêu tuổi?", messiMemory);
    expect(r).not.toBeNull();
    expect(r!.expanded.toLowerCase()).toContain("messi");
  });

  it("needsExpansion for short follow-ups with entities", () => {
    expect(needsExpansion("bao nhiêu tuổi?", messiMemory)).toBe(true);
    expect(needsExpansion("What is TypeScript and why use it?", messiMemory)).toBe(
      false,
    );
  });
});

describe("mergeEntities", () => {
  it("merges and ranks by salience", () => {
    const out = mergeEntities(
      [{ name: "Messi", salience: 1 }],
      [{ name: "Lionel Messi", aliases: ["Messi"], salience: 2 }],
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].name.toLowerCase()).toContain("messi");
  });
});

describe("expandQuery", () => {
  it("returns raw when memory empty", async () => {
    const r = await expandQuery("Messi là ai?", {
      entities: [],
      recentTurns: [],
    });
    expect(r.expandedQuery).toBe("Messi là ai?");
    expect(r.usedContext).toBe(false);
    expect(r.method).toBe("raw");
  });

  it("expands pronoun follow-up without LLM via heuristic", async () => {
    // Without LLM key, should fall back to heuristic
    const r = await expandQuery("ông ấy bao nhiêu tuổi?", messiMemory);
    expect(r.expandedQuery.toLowerCase()).toContain("messi");
    expect(r.usedContext).toBe(true);
    expect(["heuristic", "llm"]).toContain(r.method);
  });
});

describe("buildMemoryFromSession", () => {
  it("keeps last turns only", () => {
    const m = buildMemoryFromSession({
      entities: messiMemory.entities,
      turns: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
        { role: "assistant", content: "d" },
        { role: "user", content: "e" },
        { role: "assistant", content: "f" },
        { role: "user", content: "g" },
        { role: "assistant", content: "h" },
      ],
    });
    expect(m.recentTurns.length).toBeLessThanOrEqual(4);
  });
});
