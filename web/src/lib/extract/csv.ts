/**
 * Structured CSV → retrieval-friendly plain text.
 * Turns rows into "header: value" records so BM25/hybrid can match cells.
 */

const MAX_ROWS = 5_000;
const MAX_COLS = 64;
const MAX_CELL = 500;
const MAX_OUT_CHARS = 180_000;

function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

/** Detect delimiter from the first non-empty line. */
export function detectCsvDelimiter(sample: string): "," | ";" | "\t" | "|" {
  const line =
    sample
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) || "";
  const counts: Array<{ d: "," | ";" | "\t" | "|"; n: number }> = [
    { d: "\t", n: (line.match(/\t/g) || []).length },
    { d: ";", n: (line.match(/;/g) || []).length },
    { d: "|", n: (line.match(/\|/g) || []).length },
    { d: ",", n: (line.match(/,/g) || []).length },
  ];
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

/**
 * RFC4180-ish parse: handles quoted fields with embedded commas/newlines.
 */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  const s = text;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    // skip completely empty trailing rows
    if (row.length === 1 && row[0] === "" && rows.length > 0) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushCell();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushCell();
      pushRow();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  // last cell/row
  if (cell.length || row.length) {
    pushCell();
    pushRow();
  }
  return rows;
}

function sanitizeCell(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_CELL);
}

/**
 * Convert CSV buffer/string into text optimized for full-text retrieval.
 * Header row becomes field labels; each data row becomes a labeled record.
 */
export function extractCsvText(
  filename: string,
  buffer: Buffer,
  mime?: string | null,
): string {
  const raw = stripBom(buffer.toString("utf-8")).replace(/\u0000/g, "");
  if (!raw.trim()) {
    throw new Error("CSV file is empty");
  }

  const delimiter = detectCsvDelimiter(raw.slice(0, 8_000));
  const table = parseCsv(raw, delimiter);
  if (!table.length) {
    throw new Error("CSV has no parseable rows");
  }

  const headerRaw = table[0].map(sanitizeCell);
  const colCount = Math.min(
    Math.max(headerRaw.length, 1),
    MAX_COLS,
  );
  let headers = headerRaw.slice(0, colCount);
  // Fill blank headers
  headers = headers.map((h, i) => h || `col_${i + 1}`);

  const dataRows = table.slice(1, 1 + MAX_ROWS);
  const parts: string[] = [];
  parts.push(
    `CSV source: ${filename}`,
    `Columns (${headers.length}): ${headers.join(" | ")}`,
    `Delimiter: ${delimiter === "\t" ? "TAB" : delimiter}`,
    `Rows: ${dataRows.length}`,
    "",
  );

  let outLen = parts.join("\n").length;
  let included = 0;

  for (let r = 0; r < dataRows.length; r++) {
    const cells = dataRows[r];
    const fields: string[] = [];
    for (let c = 0; c < headers.length; c++) {
      const v = sanitizeCell(cells[c] ?? "");
      if (!v) continue;
      fields.push(`${headers[c]}: ${v}`);
    }
    if (!fields.length) continue;
    const block = `Record ${r + 1}\n${fields.join("\n")}`;
    if (outLen + block.length + 2 > MAX_OUT_CHARS) break;
    parts.push(block);
    outLen += block.length + 2;
    included += 1;
  }

  if (!included && table.length === 1) {
    // header-only: still store headers as content
    parts.push(`Header-only file: ${headers.join(" | ")}`);
  }

  const text = parts.join("\n\n").trim();
  if (!text) {
    throw new Error("CSV produced no extractable text");
  }
  // mime hint unused but kept for API symmetry
  void mime;
  return text;
}

export function isCsvFile(filename: string, mime?: string | null): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith(".csv") ||
    mime === "text/csv" ||
    mime === "application/csv" ||
    mime === "application/vnd.ms-excel"
  );
}
