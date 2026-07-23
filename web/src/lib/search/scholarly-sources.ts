import type { SearchHit } from "./types";

/** Explicit scholarly allowlist; generic .edu/.org pages are not trusted. */
export const SCHOLARLY_SEARCH_DOMAINS = [
  "pubmed.ncbi.nlm.nih.gov",
  "pmc.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov",
  "doi.org",
  "arxiv.org",
  "biorxiv.org",
  "medrxiv.org",
  "journals.plos.org",
  "frontiersin.org",
  "bmj.com",
  "nature.com",
  "science.org",
  "sciencedirect.com",
  "link.springer.com",
  "academic.oup.com",
  "wiley.com",
  "tandfonline.com",
  "sagepub.com",
  "jamanetwork.com",
  "nejm.org",
  "cell.com",
  "elifesciences.org",
  "royalsocietypublishing.org",
  "pubs.acs.org",
  "ieeexplore.ieee.org",
  "dl.acm.org",
  "proceedings.neurips.cc",
  "openreview.net",
] as const;

const SCHOLARLY_HOSTS = new Set<string>(SCHOLARLY_SEARCH_DOMAINS);
const PAPER_PATH_MARKERS = [
  "/article",
  "/articles/",
  "/doi/",
  "/abstract",
  "/abs/",
  "/full/",
  "/content/",
  "/papers/",
  "/paper/",
  "/proceedings/",
  "/pmc/articles/",
  "/pdf",
  "/pubmed/",
];
const NON_PAPER_PATH_MARKERS = [
  "/news/",
  "/blog/",
  "/opinion/",
  "/editorial/",
  "/podcast/",
  "/careers/",
  "/press-release/",
];

export type ScholarlySourceDecision = {
  accepted: boolean;
  host: string;
  kind: "journal" | "public-index" | "preprint" | "conference-paper" | "unknown";
  reason: string;
};

function normalizeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isAllowedHost(host: string): boolean {
  return [...SCHOLARLY_HOSTS].some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

function kindForHost(host: string): ScholarlySourceDecision["kind"] {
  if (["arxiv.org", "biorxiv.org", "medrxiv.org"].includes(host)) {
    return "preprint";
  }
  if (
    [
      "pubmed.ncbi.nlm.nih.gov",
      "pmc.ncbi.nlm.nih.gov",
      "ncbi.nlm.nih.gov",
      "doi.org",
    ].includes(host)
  ) {
    return "public-index";
  }
  if (host === "proceedings.neurips.cc" || host === "openreview.net") {
    return "conference-paper";
  }
  return "journal";
}

/** Explain the decision so the trust policy remains testable and auditable. */
export function classifyScholarlySource(url: string): ScholarlySourceDecision {
  const host = normalizeHost(url);
  if (!host) {
    return { accepted: false, host: "", kind: "unknown", reason: "invalid URL" };
  }
  if (!isAllowedHost(host)) {
    return {
      accepted: false,
      host,
      kind: "unknown",
      reason: "host is not on the scholarly allowlist",
    };
  }

  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase();
  const kind = kindForHost(host);
  const paperPath = PAPER_PATH_MARKERS.some((marker) => path.includes(marker));
  const publicationRecord =
    host === "doi.org" ||
    host === "pubmed.ncbi.nlm.nih.gov" ||
    host === "pmc.ncbi.nlm.nih.gov";
  const nonPaperPath = NON_PAPER_PATH_MARKERS.some((marker) =>
    path.includes(marker),
  );
  if (nonPaperPath || (!publicationRecord && !paperPath)) {
    return {
      accepted: false,
      host,
      kind,
      reason: "scholarly host but URL does not identify a paper or article",
    };
  }

  return {
    accepted: true,
    host,
    kind,
    reason:
      kind === "preprint"
        ? "public scholarly preprint; not assumed to be peer reviewed"
        : "public scholarly paper or publication record",
  };
}

export function filterScholarlySources(hits: SearchHit[]): SearchHit[] {
  return hits.flatMap((hit) => {
    const decision = classifyScholarlySource(hit.url);
    if (!decision.accepted || decision.kind === "unknown") return [];
    return [{ ...hit, scholarlyKind: decision.kind }];
  });
}
