# PRD: Credit Batch Report → Excel Exporter

**Owner:** Patel
**Status:** Phase 1 — Prototype validated
**Last updated:** July 2026

---

## 1. Problem

Gas station owners receive credit card batch settlement reports from their processor as PDFs. To reconcile deposits against fees, they currently have to manually read these PDFs and re-key numbers into a spreadsheet — slow, error-prone, and it doesn't scale past one store without multiplying the manual effort.

There is no simple, purpose-built tool that takes a batch settlement PDF and produces a clean, ready-to-use Excel record. Existing options are either generic OCR/PDF tools (not tailored to this data) or manual data entry.

## 2. Goals

- Let a non-technical gas station owner turn a batch settlement PDF into a usable Excel file in under a minute, with no training required.
- Build the extraction layer so that supporting a new processor's PDF format is a **template addition**, not a rewrite.
- Add a file-level summary that checks whether the credit received matches what was expected (Phase 2), then automate that check against the actual invoice/bank statement (Phase 3).

## 3. Non-goals (explicitly out of scope)

- Accounting software integration (QuickBooks, etc.) — output is a standalone record, not a feed into another system.
- Multi-store dashboards or cross-batch reporting.
- OCR / scanned-PDF support.
- Automatic detection of unknown PDF formats, or a self-serve template builder.
- Any persistence (database, history, duplicate detection) — every run is a fresh export from the uploaded PDF(s).
- Hosted/cloud deployment — this runs locally.

## 4. Target users

Gas station owners and operators (starting with a single store) who need to check credit batches against deposits. Assumed: comfortable opening a file and clicking buttons, not comfortable with spreadsheets, regex, or software installation.

## 5. Guiding principle

**The core risk to this project is PDF variation, not the coding itself.** Every processor formats its batch reports differently, and formats can change without notice.

The architecture is split into layers that isolate that risk:

| Layer | Responsibility | Changes when... |
|---|---|---|
| **Ingestion** | Accept the PDF | Never |
| **Extraction** | Pull raw fields via a per-processor template | A new processor or format shows up |
| **Normalization** | Map extracted fields into one fixed internal schema | Never (this is the contract) |
| **Output** | Excel export (per-batch table + summary block) | Only when output *requirements* change, not PDF formats |

**The rule that protects this:** if adding support for a new PDF format ever requires touching the Excel export code, the architecture has leaked and needs to be fixed — not worked around.

A **Summary/Reconciliation** layer sits on top of the per-batch export. In Phase 2 it computes file-level totals from the already-extracted batch rows. In Phase 3 it also ingests a second document (the invoice/bank statement) and joins it to the batch data on `batch_number`. It is additive: it does not change the Extraction, Normalization, or per-batch Output layers for the Chevron PDF itself.

## 6. Phase 1 — Chevron batch exporter (MVP)

### 6.1 Functional requirements

| # | Requirement |
|---|---|
| F1 | User can upload a single batch settlement PDF via drag-and-drop or file picker |
| F2 | System extracts every **Batch Total** line from the PDF (detail/line-item rows are read internally to locate totals, but are not output as separate rows) |
| F3 | System associates each Batch Total with its Date and Batch # by tracking the most recent detail row preceding it |
| F4 | Extracted data is normalized into a fixed internal schema (Section 7) regardless of source PDF layout |
| F5 | User can preview extracted rows in a table before exporting |
| F6 | User can export the result as a `.xlsx` file matching the exact column spec (Section 7.2) |
| F7 | If no recognizable Batch Total pattern is found, the system shows a clear message rather than a blank or garbage export |
| F8 | Processing happens entirely locally (no upload to a server) |

### 6.2 Explicitly deferred within Phase 1

- Site ID in Excel output (tracked internally during extraction only)
- T. Deposit / T. Fee per-batch columns (headers present, cells left empty)
- File-level summary calculations (Total Deposit, Total Fee, Total Credit, Credit) — Phase 2
- Invoice Amount matching against the invoice/bank statement — manual entry in Phase 2, automated in Phase 3

## 7. Data specification

### 7.1 Normalized internal schema (one record per batch)

```
site_id           string   e.g. "71122"     (tracked, not yet surfaced in output)
batch_date        date     e.g. 2026-07-02
batch_number      string   e.g. "0863"
gross_amount      decimal  sum of all transaction types in the batch
total_fee         decimal  sum of all fee categories
net_amount        decimal  gross_amount - total_fee
invoice_amount    decimal  reserved field — populated in Phase 3 by joining an
                            invoice/bank statement record to this batch via
                            batch_number; null/empty until then
```

This is the contract every future layer is built against. It does not change when a new PDF template is added. `invoice_amount` is reserved now specifically so the Phase 3 reconciliation layer doesn't require a schema migration — it just starts populating a field that already exists.

### 7.2 Excel output columns — per-batch table (locked)

| Column | Source | Notes |
|---|---|---|
| Date | `batch_date` | As printed on the report |
| Batch # | `batch_number` | |
| Credit | `gross_amount` | |
| Debit | `0.00` (fixed) | Reserved for a debit-batch type if one is ever observed in real reports |
| Total Card | `gross_amount` | Mirrors Credit per current report format |
| Total | `gross_amount` | Mirrors Credit per current report format |
| Fee | `total_fee` | |
| Credit (net) | `net_amount` | Gross minus fee |
| T. Deposit | *(deferred)* | Column header included; cells left empty |
| T. Fee | *(deferred)* | Column header included; cells left empty |
| Invoice Amount | `invoice_amount` | Column header included in Phase 1; cells left empty until Phase 3, when the invoice/bank statement is ingested and matched by `batch_number` |

Export sort order: **ascending by batch date** (oldest first). Date is shown only on the first row of each date group; subsequent rows for the same date leave the Date cell blank.

Partial export: if some Batch Total rows fail to parse, successfully extracted rows are still exportable and a warning is shown for skipped rows.

Grain: **one row per batch.** Individual transaction types (CHV, CC, DC, etc.) are read but not exported as separate rows.

### 7.3 File-level summary block (added Phase 2)

Below the per-batch table, a summary block reports four values for the whole export:

| Field | Formula | Notes |
|---|---|---|
| Total Deposit | Sum of the **Total** column across all batch rows | i.e. sum of `gross_amount` across the file |
| Total Fee | Sum of the **Fee** column across all batch rows | i.e. sum of `total_fee` across the file |
| Total Credit | `Total Deposit − Total Fee` | Net across the whole file |
| Invoice Amount (summary) | **Manually entered by the user** in Phase 2 | Typed in from the invoice/bank statement; automated in Phase 3 |
| Credit | `Invoice Amount (summary) − Total Credit` | The credit discrepancy Patel is checking for — should be ~0 if nothing is missing |

Total Deposit, Total Fee, and Total Credit are derived automatically from the already-extracted batch data. Only the Invoice Amount input is manual in Phase 2 — it becomes automatic once Phase 3 is built.

## 8. Roadmap

| Phase | Scope |
|---|---|
| 1 | Chevron batch PDF → per-batch Excel export (Section 6) |
| 2 | Add the file-level summary block (Section 7.3): Total Deposit, Total Fee, Total Credit computed automatically from extracted batch rows, plus a manual Invoice Amount entry field and the resulting Credit figure |
| 3 | **Invoice PDF extractor**: ingest an invoice/bank statement PDF (batch number embedded in the Invoice # field, e.g. `AAE0319` → batch `0319`), extract its amount, and use it to auto-populate the summary Invoice Amount (replacing the Phase 2 manual entry) and the per-batch `invoice_amount` field (Section 7.1) by matching on `batch_number`. Flags: batches with no matching invoice line ("missing"), invoice lines with no matching batch ("unmatched"), and batches where `invoice_amount` doesn't equal the expected batch total ("mismatch") |

Each phase is additive to the layer architecture in Section 5 — none require rewriting the normalization or per-batch output layers.

## 9. Success criteria for Phase 1

- A real batch settlement PDF from the target store produces a correct, checksum-matching Excel file (batch totals in the export match the totals printed on the PDF) without manual correction.
- An owner unfamiliar with the tool can complete upload → export without instructions.

## 10. Risks

| Risk | Mitigation |
|---|---|
| PDF text layout varies more than expected, even within Chevron's format | Template pattern isolates this to the extraction layer only |
| "Batch Total" checksum doesn't match sum of detail rows (data entry error upstream) | Not handled yet; worth flagging as a validation feature — compare exported total against sum of detail lines, warn on mismatch |
| Invoice # → Batch # extraction assumption doesn't hold on all invoice statement formats (e.g. non-numeric suffixes, multiple batches per invoice line) | Not yet validated beyond one sample image; needs confirmation against more real invoice/bank statement samples before Phase 3 is built |
| Manual Invoice Amount entry (Phase 2) is typed incorrectly, producing a false "Credit" discrepancy | Low risk since it's a single number per file; resolved entirely once Phase 3 automates extraction |

## 11. Resolved / open questions

- **Debit column:** Hardcoded to `0.00`. DC transaction amounts are included in the Batch Total gross; the Debit column remains reserved for a future batch type if observed.
- **Site ID:** Not included in Excel output. Carried internally during extraction only.
- **T. Deposit / T. Fee (per-batch):** Deferred — column headers included, cells left empty.
- **Invoice Amount (per-batch):** Column reserved from Phase 1; left empty until Phase 3.
- **File-level summary formulas:** Resolved — defined in Section 7.3.
- **Invoice statement → batch mapping (Phase 3):** Open — need to confirm how the `Amount` column on the invoice/bank statement relates to `gross_amount` / `total_fee` / `net_amount` for the matched batch, and how non-batch lines (e.g. lump-sum lines with no letter-prefixed Invoice #) should be excluded from matching.

## 12. Current status

A working prototype (`batch_report_exporter.html`) validates the pipeline end-to-end using a local, browser-only implementation (pdf.js for extraction, SheetJS for export). Phase 1 targets **Chevron** credit batch settlement PDFs. Validated against a real redacted sample PDF: 41 batch totals extracted with checksum-matching spot checks (batches 857, 858, 863, 882, and duplicate batch 9182).

**Project structure:**

```
batch_report_exporter.html   — UI (drag-drop, preview, export)
js/ingestion.js              — PDF file intake + pdf.js line extraction
js/templates/chevron.js      — Chevron-specific Batch Total parser
js/normalize.js              — Fixed internal schema + sort/group logic
js/export.js                 — Excel output (unchanged when adding templates)
```