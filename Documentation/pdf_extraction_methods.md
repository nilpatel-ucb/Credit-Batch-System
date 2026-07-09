# PDF Extraction Methods

This document describes how the batch report exporter turns uploaded PDFs into structured data. All processing happens in the browser: PDFs are read locally, text is extracted with pdf.js, and processor-specific parsers turn that text into records.

## Pipeline overview

```
PDF file
  → Ingestion (pdf.js)          → array of text lines
  → Template parser             → structured records
  → Normalize / Reconcile       → export-ready rows
```

| Step | File | Role |
|------|------|------|
| Ingestion | `frontend/js/ingestion.js` | Read PDF bytes and reconstruct logical lines from positioned text |
| Chevron batch parser | `frontend/js/templates/chevron.js` | Extract batch totals from Chevron settlement PDFs |
| EFT invoice parser | `frontend/js/templates/eft_invoice.js` | Extract per-batch invoice lines and file-level summary from EFT prenotification PDFs |
| Reconciliation | `frontend/js/reconcile.js` | Match invoice lines to batch records by batch number and amount |

Both PDF types use the same ingestion step. Only the template parser differs.

---

## Shared step: PDF → lines (`ingestion.js`)

pdf.js returns individual text fragments with x/y coordinates, not ready-made lines. The ingestion layer groups fragments into lines:

1. **Group by Y position** — Fragments with the same rounded Y coordinate belong on the same visual row.
2. **Sort top to bottom** — Higher Y values are rendered first (PDF coordinate system).
3. **Sort left to right within a row** — Fragments are ordered by X position.
4. **Join with spacing** — If the horizontal gap between two fragments exceeds 4px (`GAP_THRESHOLD`), a space is inserted; otherwise fragments are concatenated directly.
5. **Normalize whitespace** — Collapse runs of spaces and trim each line.

The result is a flat `string[]` passed to whichever template parser applies.

---

## Chevron batch settlement extraction (`chevron.js`)

Chevron credit batch settlement PDFs list transaction detail rows followed by **Batch Total** summary rows. The parser cares about detail rows only for context (site, date, batch number) and emits one record per successfully parsed Batch Total line.

### Entry point

```js
ChevronTemplate.extractFromLines(lines)
// → { records, warnings }
```

`extract()` is a thin wrapper that accepts either a string (split on `\n`) or a line array.

### Phase 1: Preprocessing (`preprocessLines`)

Raw PDF text often splits labels across lines or drops the year from dates. Preprocessing merges and filters lines before parsing.

| Rule | What it does |
|------|----------------|
| Skip empty lines | Ignored |
| Skip `about:blank`, page markers (`1/3`) | Browser/PDF noise |
| Skip timestamp lines (`7/8/2026, 10:30 AM`) | Print metadata |
| Year-only line (`2026`) | Appended to the previous line’s date (`03-31-` → `03-31-2026`) |
| `Total` after a `Batch` line | Merged into `Batch … Total`; if the next line is numeric totals only, that line is merged too |
| Header noise | Removed via `isHeaderNoise()` (column headers, `(USD)`, single-word labels like `Site`, `Batch`, `Net`, etc.) |

**Split Batch Total handling** — Some PDFs render:

```
Batch
Total
104 2,643.80 31.02 19.34 15.08 65.44 2,578.36
```

Preprocessing produces a single line:

```
Batch Total 104 2,643.80 31.02 19.34 15.08 65.44 2,578.36
```

### Phase 2: Parsing (`parseLines`)

The parser walks preprocessed lines sequentially and maintains state:

- `currentSite` — 5–6 digit site ID
- `currentDate` — `Date` from the most recent detail row
- `currentBatch` — batch number from the most recent detail row

#### Detail row pattern

```regex
/^(\d{5,6})\s+(\d{2}-\d{2}-\d{4})\s+(\d+)\s+(CHV|CC|DC)\b/i
```

Example:

```
309359 03-31-2026 0341 CC 94 2,405.22 30.72 18.63 13.64 62.99 2,342.23
```

| Capture | Field | Example |
|---------|-------|---------|
| Group 1 | Site ID | `309359` |
| Group 2 | Date | `03-31-2026` |
| Group 3 | Batch number | `0341` |
| Group 4 | Card type | `CC` |

Detail rows update state but do **not** produce output records.

#### Batch Total pattern

```regex
/^Batch\s+(?:Total\s+)?(\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2}|-)\s+([\d,]+\.\d{2}|-)\s+([\d,]+\.\d{2}|-)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?:\s+Total)?$/i
```

Example (single line):

```
Batch Total 96 2,781.16 40.83 13.35 14.44 68.62 2,712.54
```

| Capture | Meaning | Maps to |
|---------|---------|---------|
| Group 2 | Gross / batch amount | `gross_amount` |
| Group 6 | Total fee | `total_fee` |
| Group 7 | Net amount | `net_amount` |

Site, date, and batch number come from the **preceding detail row** in state, not from the Batch Total line itself.

#### Stop condition

Parsing stops at the first `Site Total` line (end of per-site section).

#### Output record shape

```js
{
  site_id: "309359",
  batch_date: Date,        // from detail row
  batch_number: "0341",    // from detail row
  gross_amount: 2643.8,
  total_fee: 65.44,
  net_amount: 2578.36,
}
```

#### Warnings

- **Batch Total without context** — A Batch Total line appears before any detail row set `currentDate` / `currentBatch`. The line is skipped and a warning is recorded with the line number.

### Amount and date parsing

- **Amounts** — Commas stripped, then `parseFloat`.
- **Dates** — `MM-DD-YYYY` split and passed to `new Date(year, month - 1, day)`.

---

## EFT invoice extraction (`eft_invoice.js`)

EFT Prenotification invoice PDFs list one row per batch charge (IDs starting with `AA`) and a final summary row with the overall invoice number and total payment.

### Entry point

```js
EftInvoiceTemplate.extractFromLines(lines)
// → { batchLines, summary, warnings }
```

### Invoice line pattern

```regex
/^([A-Z0-9]+)\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2})\s+(-?[\d,]+\.\d{2})/i
```

Each matching line has:

| Capture | Field | Example |
|---------|-------|---------|
| Group 1 | Invoice / reference ID | `AAE0319` or `0600658` |
| Group 2 | Invoice date | `03/30/26` |
| Group 3 | Due date | `03/30/26` (parsed but not stored) |
| Group 4 | Amount | `-2,817.73` |

Example batch line:

```
AAE0319 03/30/26 03/30/26 -2,817.73 .00 -2,817.73
```

Only the first four fields are used; trailing columns (discount, available balance) are ignored.

### AA-prefixed lines → batch lines

Lines whose ID starts with `AA` (case-insensitive) are treated as **per-batch invoice lines**:

1. **Batch number** — Digits after the leading letters:

   ```regex
   /^[A-Za-z]+(\d+)$/
   ```

   | Invoice ID | Batch number |
   |------------|--------------|
   | `AAE0319` | `0319` |
   | `AAU9086` | `9086` |
   | `AAM9087` | `9087` |

2. **Output**:

   ```js
   {
     invoiceId: "AAE0319",
     batchNumber: "0319",
     amount: -2817.73,
     invDate: Date,
   }
   ```

If the ID matches `AA…` but no digits can be extracted, a warning is emitted and the line is skipped.

Multiple invoice lines can share the same batch number (e.g. `AAM9087` and `AAN9087` both map to batch `9087`).

### Non-AA lines → file summary

The first matching line whose ID does **not** start with `AA` becomes the file-level summary:

```js
{
  invoiceNumber: "0600658",
  amount: 35381.95,
}
```

Example:

```
0600658 03/24/26 04/01/26 35,381.95 .00 35,381.95
```

If several non-AA lines match the pattern, the **last** one wins (later lines overwrite `summary`).

### Noise filtering (`isNoiseLine`)

These lines are skipped before pattern matching:

- Empty lines
- Column header (`Invoice # Inv Date…`)
- Separator rows (`---------`)
- Footer text (`*** End Of EFT Prenotification ***`, `Electronic Funds Transfer`, etc.)
- Page markers

Footer subtotals like `-4,267.80 .00 -4,267.80` do **not** match `INVOICE_LINE_RE` (no leading alphanumeric ID), so they are ignored automatically.

### Warnings

- No `AA`-prefixed batch lines found → warning at line 0.
- `AA` ID with unparseable batch number → warning with line number.

### Date parsing

Invoice dates use `MM/DD/YY`. Two-digit years below 100 are treated as `2000 + year` (e.g. `26` → 2026).

---

## How the two extractions connect (reconciliation)

After both PDFs are parsed:

1. Chevron records are normalized (`normalize.js`) — dates formatted, amounts rounded.
2. `Reconcile.reconcile(batchRecords, invoiceResult)` joins invoice batch lines to batch records when:
   - Batch numbers match (leading zeros ignored: `0319` ↔ `319`)
   - Absolute invoice amount equals `net_amount` on the batch row
   - Batch date is part of the internal dedup key when multiple rows share number and amount

Only matched rows appear in the export. The invoice summary (`invoiceNumber`, `invoiceAmount`) is carried through to the Excel footer.

---

## Adding a new processor format

Chevron and EFT invoice logic live in isolated template files under `frontend/js/templates/`. To support another processor:

1. Add a new template module with an `extractFromLines(lines)` function.
2. Reuse `Ingestion.extractLinesFromPdf` for PDF → lines.
3. Wire the new template into `batch_report_exporter.html` (or a format selector if multiple batch PDF types are supported).

Ingestion, normalization, reconciliation, and export stay unchanged as long as the template returns the same record shapes.
