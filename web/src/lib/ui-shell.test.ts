import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function readSrc(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

describe("UI redesign — shared shell & tokens (shipped sources)", () => {
  it("globals.css defines a coherent design token set", () => {
    const css = readSrc("app", "globals.css");
    for (const token of [
      "--bg-base",
      "--bg-panel",
      "--fg",
      "--fg-muted",
      "--primary",
      "--border",
      "--radius",
      "--sidebar-w",
      "--evidence-w",
      "--chat-max",
    ]) {
      expect(css, `missing token ${token}`).toContain(token);
    }
    // Shared control + chrome utilities used across routes
    for (const util of [
      ".btn-primary",
      ".btn-ghost",
      ".field",
      ".panel",
      ".alert-error",
      ".page-header",
      ".empty-state",
    ]) {
      expect(css, `missing utility ${util}`).toContain(util);
    }
  });

  it("lively multi-accent tokens + motion utilities ship in globals.css", () => {
    const css = readSrc("app", "globals.css");
    // Multi-accent palette beyond single navy/blue
    for (const token of [
      "--violet",
      "--cyan",
      "--teal",
      "--amber",
      "--mood",
      "--mood-soft",
      "--mood-grad",
    ]) {
      expect(css, `missing lively token ${token}`).toContain(token);
    }
    // Dataset vs Web module moods
    expect(css).toContain('[data-mood="dataset"]');
    expect(css).toContain('[data-mood="web"]');
    // Motion primitives + reduced-motion kill switch
    for (const util of [
      "@keyframes se-enter-up",
      ".anim-enter",
      ".anim-stagger",
      ".anim-message",
      ".hover-lift",
      ".bento-grid",
      ".bento-card",
      "prefers-reduced-motion",
    ]) {
      expect(css, `missing motion/bento util ${util}`).toContain(util);
    }
    expect(css).toMatch(
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/,
    );
  });

  it("AppShell applies data-mood and lively rail labels", () => {
    const shell = readSrc("components", "AppShell.tsx");
    expect(shell).toContain('data-mood={mood}');
    expect(shell).toContain('mood =');
    expect(shell).toContain('"web"');
    expect(shell).toContain('"dataset"');
  });

  it("empty states use bento grid + staggered enter classes", () => {
    const search = readSrc("components", "search", "SearchChatLayout.tsx");
    const dataset = readSrc("components", "dataset", "DatasetChatLayout.tsx");
    expect(search).toContain("bento-grid");
    expect(search).toContain("anim-stagger");
    expect(search).toContain("chip-tint-cyan");
    expect(dataset).toContain("bento-grid");
    expect(dataset).toContain("anim-stagger");
    expect(dataset).toContain("bento-card--violet");
    const thread = readSrc("components", "search", "ChatThread.tsx");
    expect(thread).toContain("anim-message");
    expect(thread).toContain("thinking-dot");
  });

  it("AppShell exposes primary nav to Dataset Search then Web Search", () => {
    const shell = readSrc("components", "AppShell.tsx");
    expect(shell).toContain('href: "/notebooks"');
    expect(shell).toContain('href: "/search"');
    expect(shell).toContain("Dataset Search");
    expect(shell).toContain("Web Search");
    expect(shell).toContain('aria-label="Primary"');
    expect(shell).toMatch(/fill\s*[?=]/);
    // Dataset Search is listed first in nav
    expect(shell.indexOf('href: "/notebooks"')).toBeLessThan(
      shell.indexOf('href: "/search"'),
    );
  });

  it("uses readable Plus Jakarta + Sora fonts at 16px body base", () => {
    const layout = readSrc("app", "layout.tsx");
    expect(layout).toContain("Plus_Jakarta_Sans");
    expect(layout).toContain("Sora");
    expect(layout).not.toContain("DM_Sans");
    const css = readSrc("app", "globals.css");
    expect(css).toContain("--font-plus-jakarta");
    expect(css).toContain("--font-sora");
    expect(css).toMatch(/--text-base:\s*1rem/);
    expect(css).toContain("confirm-panel");
  });

  it("dataset delete uses in-app ConfirmDialog, not window.confirm", () => {
    const layout = readSrc("components", "dataset", "DatasetChatLayout.tsx");
    expect(layout).toContain("ConfirmDialog");
    expect(layout).toContain("confirmDelete");
    expect(layout).not.toMatch(/\bconfirm\s*\(/);
    // Optimistic: UI removes immediately; DELETE is fire-and-forget
    expect(layout).toContain("Optimistic delete");
    expect(layout).toContain('method: "DELETE"');
    const dialog = readSrc("components", "ConfirmDialog.tsx");
    expect(dialog).toContain('role="alertdialog"');
    expect(dialog).toContain("aria-modal");
    const sidebar = readSrc("components", "dataset", "DatasetSidebar.tsx");
    expect(sidebar).toContain('type="checkbox"');
    expect(sidebar).toContain("In use");
    expect(sidebar).toContain("Open");
  });

  it("session remove is optimistic (instant sidebar update)", () => {
    const hook = readSrc("lib", "hooks", "use-search-chat.ts");
    expect(hook).toContain("Optimistic remove");
    expect(hook).toContain('method: "DELETE"');
    // Must not block on multi-roundtrip verification before UI update
    expect(hook).toMatch(
      /setSessions\(\(prev\) => prev\.filter[\s\S]*?fetch\(`\/api\/search\/sessions\/\$\{id\}`/,
    );
  });

  it("New dataset CTA is only in the left sidebar, not center empty state", () => {
    const layout = readSrc("components", "dataset", "DatasetChatLayout.tsx");
    expect(layout).toContain("Select a dataset");
    expect(layout).toContain("left sidebar");
    // Center empty state must not render a New dataset primary button
    expect(layout).not.toMatch(
      /chat-empty[\s\S]*?btn-primary[\s\S]*?New dataset/,
    );
    const sidebar = readSrc("components", "dataset", "DatasetSidebar.tsx");
    expect(sidebar).toContain("New dataset");
    expect(sidebar).toContain("onNew");
  });

  it("dataset sidebar supports checkbox multi-select and rename", () => {
    const sidebar = readSrc("components", "dataset", "DatasetSidebar.tsx");
    expect(sidebar).toContain('type="checkbox"');
    expect(sidebar).toContain("onToggleCheck");
    expect(sidebar).toContain("onRename");
    expect(sidebar).toContain("Pencil");
    const layout = readSrc("components", "dataset", "DatasetChatLayout.tsx");
    expect(layout).toContain("checkedIds");
    expect(layout).toContain("notebookIds");
    expect(layout).toContain('method: "PATCH"');
    const ask = readSrc("app", "api", "notebooks", "[id]", "ask", "route.ts");
    expect(ask).toContain("notebookIds");
    const patch = readSrc("app", "api", "notebooks", "[id]", "route.ts");
    expect(patch).toContain("export async function PATCH");
    expect(patch).toContain("updateNotebook");
  });

  it("search session delete uses ConfirmDialog and optimistic remove", () => {
    const layout = readSrc("components", "search", "SearchChatLayout.tsx");
    expect(layout).toContain("ConfirmDialog");
    expect(layout).toContain("onRequestDelete");
    expect(layout).not.toMatch(/\bconfirm\s*\(/);
    const hook = readSrc("lib", "hooks", "use-search-chat.ts");
    expect(hook).toContain("Optimistic remove");
  });

  it("SearchChatLayout is a multi-panel workspace wired to chat hooks", () => {
    const layout = readSrc("components", "search", "SearchChatLayout.tsx");
    expect(layout).toContain("SearchSidebar");
    expect(layout).toContain("ChatThread");
    expect(layout).toContain("ChatComposer");
    expect(layout).toContain("EvidenceList");
    expect(layout).toContain("useSearchChat");
    expect(layout).toContain("useSearchSessions");
    expect(layout).toContain("ensureSessionAndSend");
    expect(layout).toContain("AppShell");
    expect(layout).toContain("fill");
  });

  it("ChatComposer still calls onSend with pipeline options", () => {
    const composer = readSrc("components", "search", "ChatComposer.tsx");
    expect(composer).toContain("onSend");
    expect(composer).toContain("searchLimit");
    expect(composer).toContain("contextTopK");
    expect(composer).toContain("generateAnswer");
    expect(composer).toContain("handleSubmitOnEnter");
  });

  it("Notebooks list uses chat layout shell", () => {
    const page = readSrc("app", "notebooks", "page.tsx");
    expect(page).toContain("DatasetChatLayout");
    expect(page).toContain("notebookId={null}");
  });

  it("Notebook detail uses DatasetChatLayout with chat frame wiring", () => {
    const page = readSrc("app", "notebooks", "[id]", "page.tsx");
    expect(page).toContain("DatasetChatLayout");
    expect(page).toContain("params.id");
    const layout = readSrc("components", "dataset", "DatasetChatLayout.tsx");
    expect(layout).toContain("AppShell");
    expect(layout).toContain("fill");
    expect(layout).toContain("DatasetSidebar");
    expect(layout).toContain("ChatThread");
    expect(layout).toContain("DatasetComposer");
    expect(layout).toContain("useSsePipeline");
    expect(layout).toContain("useUploadSse");
    expect(layout).toContain("/upload");
    expect(layout).toContain("/ask");
    expect(layout).toContain("DocumentResultsList");
    expect(layout).toContain("DocumentDetailDrawer");
    expect(layout).toContain("ProcessExplainPanel");
    expect(layout).toContain("PipelineInspector");
    expect(layout).toContain("usePanelLayout");
    expect(layout).toContain("ResizeHandle");
    expect(layout).toContain("toggleLeft");
    expect(layout).toContain("toggleRight");
    expect(layout).toContain("beginResize");
  });

  it("dataset panels are collapsible and resizable", () => {
    const layout = readSrc("components", "dataset", "DatasetChatLayout.tsx");
    expect(layout).toContain('storageKey: "dataset-chat"');
    expect(layout).toContain("is-collapsed");
    expect(layout).toContain("Resize datasets panel");
    expect(layout).toContain("Resize side panel");
    expect(layout).toContain("Expand datasets panel");
    expect(layout).toContain("Expand side panel");
    const sidebar = readSrc("components", "dataset", "DatasetSidebar.tsx");
    expect(sidebar).toContain("onCollapse");
    expect(sidebar).toContain("Collapse datasets panel");
    const hook = readSrc("lib", "hooks", "use-panel-layout.ts");
    expect(hook).toContain("nextPanelWidth");
    expect(hook).toContain("localStorage");
    const css = readSrc("app", "globals.css");
    expect(css).toContain(".panel-resize-handle");
    expect(css).toContain(".panel-rail");
  });

  it("Web Search and Dataset Search both use fill chat AppShell", () => {
    const search = readSrc("components", "search", "SearchChatLayout.tsx");
    expect(search).toContain("AppShell");
    expect(search).toContain("fill");
    expect(search).toContain("ChatThread");
    expect(search).toContain("ChatComposer");
    expect(search).toContain("SearchSidebar");
    expect(search).toContain("chat-toolbar");
    expect(search).toContain("chat-empty");
    expect(search).toContain("StepRail");
    const dataset = readSrc("components", "dataset", "DatasetChatLayout.tsx");
    expect(dataset).toContain("fill");
    expect(dataset).toContain("ChatThread");
    expect(dataset).toContain("chat-toolbar");
    expect(dataset).toContain("chat-empty");
    expect(dataset).toContain("StepRail");
    expect(dataset).toContain("chat-panel");
  });

  it("shared chat chrome tokens exist for dual-page polish", () => {
    const css = readSrc("app", "globals.css");
    for (const util of [
      ".chat-toolbar",
      ".chat-sidebar",
      ".chat-composer-shell",
      ".chat-composer-box",
      ".chat-empty",
      ".chat-step-rail",
      ".chat-panel",
      ".alert-warn",
    ]) {
      expect(css, `missing ${util}`).toContain(util);
    }
    const step = readSrc("components", "StepRail.tsx");
    expect(step).toContain("chat-step-rail");
    expect(step).toContain("chat-step-pill");
    expect(step).toContain("chat-step-connector");
  });

  it("ProcessExplainPanel uses shipped pipeline-viz builders", () => {
    const panel = readSrc("components", "dataset", "ProcessExplainPanel.tsx");
    expect(panel).toContain("buildStageTimeline");
    expect(panel).toContain("buildTimingWaterfall");
    expect(panel).toContain("buildRankTransitions");
    expect(panel).toContain("buildDocumentScoreSeries");
    expect(panel).toContain("buildCandidateCompare");
    expect(panel).toContain("Timing waterfall");
    expect(panel).toContain("Rank transitions");
    // Clickable units with text preview (not title-only table)
    expect(panel).toContain("onSelectDocument");
    expect(panel).toContain("RankUnitCard");
    expect(panel).toContain("row.snippet");
    expect(panel).toContain("Click to open full document");
    expect(panel).not.toContain("Rank transitions (chunk-level)");
  });

  it("upload API and source detail routes exist for progress + drawer", () => {
    const upload = readSrc("app", "api", "notebooks", "[id]", "upload", "route.ts");
    expect(upload).toContain("createUploadSseResponse");
    expect(upload).toContain("extract_completed");
    expect(upload).toContain("store_completed");
    expect(upload).toContain("upload_completed");
    expect(upload).toContain("raw-sources-only");
    // raw ingest: no chunk/embed index steps on the upload path
    expect(upload).not.toContain("chunk_completed");
    expect(upload).not.toContain("embed_completed");
    const sourceApi = readSrc(
      "app",
      "api",
      "notebooks",
      "[id]",
      "sources",
      "[sourceId]",
      "route.ts",
    );
    expect(sourceApi).toContain("getSourceDetail");
  });

  it("upload UI is raw-store only (no chunk/embed index steps)", () => {
    const panel = readSrc("components", "dataset", "UploadPipelinePanel.tsx");
    expect(panel).toContain("Store raw source");
    expect(panel).toContain("receive → extract → store");
    expect(panel).not.toMatch(/id:\s*"chunk"/);
    expect(panel).not.toMatch(/id:\s*"embed"/);
    expect(panel).not.toMatch(/Index pipeline/i);
    const hook = readSrc("lib", "hooks", "use-upload-sse.ts");
    expect(hook).toContain('store: "pending"');
    expect(hook).not.toContain('chunk: "pending"');
    expect(hook).not.toContain('embed: "pending"');
    const repo = readSrc("lib", "db", "notebooks-repo.ts");
    expect(repo).toContain("raw-sources-only");
    expect(repo).toMatch(/chunkCount:\s*0/);
    expect(repo).not.toContain("chunkDocument");
    expect(repo).not.toContain("embedChunksForStorage");
    expect(repo).not.toMatch(/from\("chunks"\)\.insert/);
    expect(repo).not.toMatch(/db\.insert\(chunks\)/);
  });

  it("dataset UI copy is source-first raw store (not upload→chunk→embed index)", () => {
    const layout = readSrc("components", "dataset", "DatasetChatLayout.tsx");
    expect(layout).toContain("Storing raw document");
    expect(layout).toContain("raw source");
    expect(layout).toContain("pre-index");
    expect(layout).toContain("full document text only");
    expect(layout).toContain("units at query time");
    expect(layout).not.toContain("Indexing document");
    expect(layout).not.toContain("wait for indexing");
    expect(layout).not.toContain("ranked chunks with full IR");
    expect(layout).not.toMatch(/upload\s*→\s*chunk\s*→\s*embed/i);
    expect(layout).not.toMatch(/extract\s*→\s*chunk\s*→\s*embed/i);

    const composer = readSrc("components", "dataset", "DatasetComposer.tsx");
    expect(composer).toContain("stores raw sources");
    expect(composer).toContain("query time");

    const sidebar = readSrc("components", "dataset", "DatasetSidebar.tsx");
    expect(sidebar).toContain("store raw sources");

    const drawer = readSrc("components", "dataset", "DocumentDetailDrawer.tsx");
    expect(drawer).toContain("Stored as raw full text");
    expect(drawer).toContain("Retrieval hits");
    expect(drawer).toContain("Why it ranked");
    expect(drawer).not.toContain("chunks indexed");
    expect(drawer).not.toContain("hit chunks");

    const docs = readSrc("components", "dataset", "DocumentResultsList.tsx");
    expect(docs).toContain("Confidence");
    expect(docs).toContain("MetricCell");
    expect(docs).toContain("Hits");
    expect(docs).not.toMatch(/\bchunks\b/);

    const metrics = readSrc("components", "dataset", "RunMetricsStrip.tsx");
    expect(metrics).toContain("Retrieval quality");
    expect(metrics).toContain("Latency");
    expect(metrics).toContain("Units ranked");
    expect(metrics).toContain("not stored chunk rows");
    expect(metrics).toContain("Top match");
    expect(metrics).toContain("score-derived proxy");
    expect(metrics).toContain("not calibrated");

    const inspector = readSrc("components", "pipeline", "PipelineInspector.tsx");
    expect(inspector).toContain("Sources ready");
    expect(inspector).toContain("no pre-chunk or embed index at upload");
    expect(inspector).toContain("Retrieval units (this run)");
    expect(inspector).toContain("Raw full text only");
    expect(inspector).toContain("describeNotebookCorpusStorage");
    // Must not reintroduce mislabel that treated query-time units as stored chunks
    expect(inspector).not.toContain(
      "Sources + stored chunk rows (legacy or mixed)",
    );
    expect(inspector).not.toContain(
      "Indexed documents already chunked in this notebook",
    );

    const explain = readSrc("components", "dataset", "ProcessExplainPanel.tsx");
    expect(explain).toContain("Rank transitions");
    expect(explain).toContain("unit text");
    expect(explain).toContain("Click to open full document");
    expect(explain).not.toContain("chunk-level");

    const viz = readSrc("lib", "ir", "pipeline-viz.ts");
    expect(viz).toContain("not a pre-indexed chunk");
    expect(viz).toContain("Upload does not store embeddings");

    const evidence = readSrc("components", "EvidenceList.tsx");
    expect(evidence).toContain("ranked retrieval hits");
    expect(evidence).not.toContain("ranked chunks");
  });

  it("home redirects to notebooks (dataset search primary)", () => {
    const home = readSrc("app", "page.tsx");
    expect(home).toContain('redirect("/notebooks")');
  });

  it("website UI chrome is English-only (no VN suggestion chips)", () => {
    const dataset = readSrc("components", "dataset", "DatasetChatLayout.tsx");
    expect(dataset).toContain("Summarize the main points in this corpus");
    expect(dataset).toContain("What are the key concepts?");
    expect(dataset).not.toContain("Tóm tắt");
    expect(dataset).not.toContain("khái niệm");
    expect(dataset).not.toContain("trong tài liệu");

    const search = readSrc("components", "search", "SearchChatLayout.tsx");
    expect(search).toContain("Who is Lionel Messi?");
    expect(search).toContain("Compare BM25 and dense retrieval");
    expect(search).toContain("How old is he?");
    expect(search).not.toContain("Messi là ai");
    expect(search).not.toContain("So sánh");
    expect(search).not.toContain("ông ấy");

    const layout = readSrc("app", "layout.tsx");
    expect(layout).toContain('lang="en"');
    expect(layout).not.toContain('lang="vi"');
    // Font subset for UI product language
    expect(layout).toMatch(/subsets:\s*\[\s*"latin"\s*\]/);

    const cite = readSrc("lib", "llm", "prompts.ts");
    expect(cite).toMatch(/English only/i);
    expect(cite).toMatch(/Do not answer in Vietnamese/i);
    expect(cite).not.toMatch(/Prefer Vietnamese/i);
    expect(cite).not.toMatch(/Respond in Vietnamese only/i);
    expect(cite).not.toMatch(/The user question is in Vietnamese/i);

    const expand = readSrc("lib", "context", "prompts.ts");
    expect(expand).toMatch(/English only/i);
    expect(expand).not.toMatch(/Vietnamese or English/i);
  });

  it("PipelineInspector documents hybrid fusion (not cross-encoder rerank)", () => {
    const inspector = readSrc("components", "pipeline", "PipelineInspector.tsx");
    expect(inspector).toContain("Hybrid fusion");
    expect(inspector).toContain("Adaptive RRF");
    expect(inspector).toContain("cross-encoder");
    expect(inspector).toContain("MetricsStrip");
  });

  it("primary routes mount shared layout components", () => {
    expect(readSrc("app", "search", "page.tsx")).toContain("SearchChatLayout");
    expect(readSrc("app", "search", "[sessionId]", "page.tsx")).toContain(
      "SearchChatLayout",
    );
    expect(readSrc("app", "notebooks", "page.tsx")).toContain(
      "DatasetChatLayout",
    );
    expect(readSrc("app", "notebooks", "[id]", "page.tsx")).toContain(
      "DatasetChatLayout",
    );
  });
});

