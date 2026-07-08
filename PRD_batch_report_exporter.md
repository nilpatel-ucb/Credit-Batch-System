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
- Keep the system simple enough in Phase 1 to ship fast, while making sure early architectural choices don't block multi-store or multi-format expansion later.

## 3. Non-goals (explicitly out of scope for now)

- Accounting software integration (QuickBooks, etc.) — output is a standalone record, not a feed into another system.
- Multi-store dashboards or cross-batch reporting.
- OCR / scanned-PDF support.
- Automatic detection of unknown PDF formats, or a self-serve template builder.
- Hosted/cloud deployment — this runs locally.

These are deferred, not rejected — see Section 8 (Roadmap).

## 4. Target users

Gas station owners and operators (starting with a single store) who need to check credit batches against deposits. Assumed: comfortable opening a file and clicking buttons, not comfortable with spreadsheets, regex, or software installation.

## 5. Guiding principle

**The core risk to this project is PDF variation, not the coding itself.** Every processor (Verifone, Clover, Worldpay, First Data/Fiserv, etc.) formats its batch reports differently, and formats can change without notice.

The architecture is therefore split into layers that isolate that risk:

| Layer | Responsibility | Changes when... |
|---|---|---|
| **Ingestion** | Accept the PDF | Never |
| **Extraction** | Pull raw fields via a per-processor template | A new processor or format shows up |
| **Normalization** | Map extracted fields into one fixed internal schema | Never (this is the contract) |
| **Output** | Excel export (later: DB, multi-store views) | Only when output *requirements* change, not PDF formats |

**The rule that protects this:** if adding support for a new PDF format ever requires touching the Excel export code, the architecture has leaked and needs to be fixed — not worked around.

## 6. Phase 1 scope (MVP)

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

- OCR fallback for scanned/image-only PDFs
- More than one processor template (Phase 1 targets **Chevron** credit batch PDFs only)
- Any persistence (database, history, duplicate detection)
- Multi-store selection UI (though the schema reserves a field for it)
- T. Deposit / T. Fee running totals (columns are present in export but left empty)
- Site ID in Excel output (tracked internally during extraction only)

## 7. Data specification

### 7.1 Normalized internal schema (one record per batch)

```
site_id           string   e.g. "71122"     (tracked, not yet surfaced in output)
batch_date        date     e.g. 2026-07-02
batch_number      string   e.g. "0863"
gross_amount      decimal  sum of all transaction types in the batch
total_fee         decimal  sum of all fee categories
net_amount        decimal  gross_amount - total_fee
```

This is the contract every future layer (database, multi-store reporting, new templates) is built against. It does not change when a new PDF template is added.

### 7.2 Excel output columns (locked)

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
| T. Deposit | *(deferred)* | Column header included; cells left empty until a later phase |
| T. Fee | *(deferred)* | Column header included; cells left empty until a later phase |

Export sort order: **ascending by batch date** (oldest first). Date is shown only on the first row of each date group; subsequent rows for the same date leave the Date cell blank.

Partial export: if some Batch Total rows fail to parse, successfully extracted rows are still exportable and a warning is shown for skipped rows.

Grain: **one row per batch.** Individual transaction types (CHV, CC, DC, etc.) are read but not exported as separate rows.

## 8. Roadmap (post-Phase 1, not yet committed)

| Phase | Addition | Trigger to build it |
|---|---|---|
| 2 | Multiple processor templates + auto-detection of which template matches an uploaded PDF | A second store or processor format is onboarded |
| 2 | Manual field-mapping fallback for unrecognized formats | Recurring "unrecognized format" errors in practice |
| 3 | OCR fallback (Tesseract or similar) | A real scanned/faxed batch report is encountered |
| 3 | SQLite (or similar) persistence | Need for cross-batch history, duplicate-batch detection, or "show me the last 90 days" |
| 4 | Multi-store dashboard / consolidated reporting | Managing 2+ stores becomes the normal case, not the exception |

Each phase is additive to the layer architecture in Section 5 — none of them require rewriting the normalization or output layers.

## 9. Success criteria for Phase 1

- A real batch settlement PDF from the target store produces a correct, checksum-matching Excel file (batch totals in the export match the totals printed on the PDF) without manual correction.
- An owner unfamiliar with the tool can complete upload → export without instructions.
- Adding a second processor's template (when needed) requires writing a new template, not modifying the export or UI code.

## 10. Risks

| Risk | Mitigation |
|---|---|
| PDF text layout varies more than expected, even within one processor | Template pattern isolates this to the extraction layer only |
| PDF is a scanned image with no text layer | Explicitly flagged as unsupported in Phase 1 (Section 6.2); clear error message rather than silent failure |
| Report format changes over time (processor updates their template) | Same mitigation as format variation — new/updated template, not a rewrite |
| "Batch Total" checksum doesn't match sum of detail rows (data entry or OCR error upstream) | Not handled in Phase 1; worth flagging as a Phase 2 validation feature (compare exported total against sum of detail lines, warn on mismatch) |

## 11. Resolved / open questions

- **Debit column:** Hardcoded to `0.00` for Phase 1. DC transaction amounts are included in the Batch Total gross; the Debit column remains reserved for a future batch type if observed.
- **Site ID:** Not included in Phase 1 Excel output. Carried internally during extraction only.
- **T. Deposit / T. Fee:** Deferred — column headers included, cells left empty.
- **Validation checksum (Phase 2):** Still open — compare Batch Total against sum of detail rows and warn on mismatch.

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
