# Credit Batch Reconciler

Credit Batch Reconciler is a local Electron desktop application for gas-station operators who need to compare credit-card settlement batches with EFT prenotification invoices. It keeps each store's history in a separate SQLite database, extracts records from supported PDF layouts, identifies missing or incorrect credits, and preserves confirmed reconciliation runs for later review.

All PDF parsing, storage, and reconciliation happen on the computer running the app. The current application does not upload data to a server or require an account.

> **Current scope:** the repository contains the working desktop ledger, PDF import, dashboard, reconciliation workflow, and Windows installer packaging via GitHub Actions. Excel export, legacy workbook import, cloud sync, and accounting integrations are not currently implemented.



## Problem to be solved

When a customers purchases gasoline at the pump, using their credit card, this credit doesn't directly transfer to the gas station operator, rather its held by the copmany which sold them the gasoline. The gasoline is later split up in batches, with the credit for each batch being reimbersed back to the gas station operator. During the process of reimbersment the peterolum redistributor may forget to transfer these funds. In which case if it goes unchecked it may lead to a $30,0000-$40,000 loss.

The current method involved: 

- Manually re-key batch totals into Excel workbooks — slow and easy to mistype
- Keep one spreadsheet per store where batches, invoice amounts, and notes are mixed together

With multiple stores the problem compounds: each site has its own batches and invoices, and batch numbers can collide across locations. There was no purpose-built local app that accumulates batch history, stores invoice lines, and flags missing or incorrect credits for review.

## Screenshots

### Dashboard

![Dashboard showing credit status and reconciliation summary](Screenshots/credit%20batch%201.png)

### Storage location

![Change storage location dialog](Screenshots/credit%20batch%202.png)

### Batch ledger

![Batch ledger with matched settlement batches](Screenshots/credit%20batch%203.png)

### Open reconciliation

![Open reconciliation showing batches missing from an invoice](Screenshots/credit%20batch%204.png)

### Store selection

![Store selection sidebar](Screenshots/credit%20batch%205.png)

## What the app does



### Maintains an isolated ledger for every store

- Creates one SQLite `.db` file per store.
- Associates each store with a name, 5–6 digit site ID, settlement parser, and EFT parser.
- Automatically opens the first available store at startup.
- Lists and filters stores by name or site ID in the store sidebar.
- Switches between stores without mixing their batches, invoices, or reconciliation history.
- Allows store details and parser selections to be edited.
- Permanently deletes a store and its database after confirmation.
- Shows the active database path and can reveal it in Finder.



### Imports settlement batch PDFs

- Accepts one or more PDFs by drag-and-drop or file picker.
- Uses the settlement template configured for the active store.
- Extracts and previews date, batch number, gross credit, fee, net credit, and site ID.
- Displays parser warnings before anything is saved.
- Rejects empty PDFs, files with no recognized batches, files containing multiple site IDs, and PDFs belonging to a different store.
- Saves all valid files in a multi-file selection while reporting files that were skipped.
- Deduplicates batches by batch date, batch number, and net amount.
- Records the source filename and ingestion time for every saved batch.
- Automatically reruns the store reconciliation after batches are added.

Supported settlement layouts:

- **Chevron**
- **CStore Green Valley**



### Imports EFT prenotification PDFs

- Accepts one or more EFT PDFs by drag-and-drop or file picker.
- Uses the EFT template configured for the active store.
- Extracts and previews the invoice number, total, optional balance, date period, line IDs, batch numbers, dates, and signed amounts.
- Shows a summary card for each file during multi-file imports.
- Displays parser warnings and skips invalid files.
- Rejects files with no invoice summary or no recognized batch lines.
- Prevents duplicate invoice numbers and reports when the original upload occurred.
- Saves invoice headers and line items, then automatically previews reconciliation results.

Supported EFT layouts:

- **Jenkins EFT**
- **Jackson EFT**
- **Jenkins Green Valley**

The parser pair is selected per store. Choose the pair that matches that store's actual settlement and EFT documents.

### Provides a live dashboard

The top of the app summarizes the active store:

- **Credit received gauge** — divides open batch net amounts into received, missing, and expected-on-next-invoice amounts.
- **Total deposit** — gross value of matched batches.
- **Total fees** — processor fees on matched batches.
- **Net credit** — matched deposits minus fees.
- **Credit discrepancy** — credit still missing according to the latest reconciliation preview.
- **Coverage indicator** — reports open batches, open invoice lines, pending confirmations, missing batches, and unmatched lines.
- **Coverage warning** — indicates whether the discrepancy is final or may be provisional because open problems remain.



### Displays and searches the batch ledger

- Shows date, batch number, gross, fee, net, status, matched invoice line, invoice amount, and source PDF.
- Groups repeated dates visually while retaining every underlying row.
- Opens the complete source-upload group when a batch row is selected.
- Searches by a full or partial batch number, ignoring leading zeroes.
- Search results cover:
  - open batches;
  - open invoice lines; and
  - matches already archived in confirmed reconciliation runs.
- Deletes an individual batch after confirmation.
- Deletes every batch from a selected source upload after confirmation.



### Supports manual batch entry

When a settlement batch is not available in a PDF, **Add batch** records it manually using:

- the active store's site ID;
- batch date and number;
- gross credit;
- total fee; and
- net amount.

Net is calculated from gross minus fee until it is manually overridden. Manual entries use `manual-entry` as their source and use the same duplicate protection and reconciliation flow as imported batches.

### Reconciles open batches and invoice lines

Reconciliation is a two-step workflow:

1. **Reconcile store** calculates and saves a preview of all open data.
2. **Confirm matches** archives matched pairs into a timestamped reconciliation run.

Confirmed rows are removed from the open scope. Problems remain open so new settlement or EFT PDFs can resolve them in a later preview.

For standard stores, the matcher:

- normalizes batch numbers by removing leading zeroes;
- groups all open EFT lines with the same batch number;
- nets credits and reversals within each invoice-line group;
- compares the absolute EFT credit with the total net amount of open batches having that number;
- supports one EFT group matching multiple settlement rows;
- finds an exact subset when only part of a repeated batch-number cluster was credited; and
- treats each batch as consumed at most once per preview.

The current standard reconciliation scope is the store's complete set of open batches and open invoice lines. Matching itself is not limited to one selected invoice. The summary invoice-total figure currently sums every stored invoice header for that store, including invoices whose matched lines were already confirmed and archived; Green Valley instead totals only invoices that still have open lines.

Green Valley uses a separate aggregate control:

```text
absolute total of letter-prefixed EFT lines
  - total of numeric/unprefixed invoice rows
  = EFT footer control amount
```

If that equation balances, eligible Green Valley batches are matched as a group. If it does not, the app reports one aggregate amount mismatch instead of inferring a specific missing batch.

### Explains reconciliation statuses

- **Matched** — net EFT credit equals the corresponding batch net amount.
- **Missing from invoice** — an open batch has no corresponding EFT line.
- **Expected on next invoice** — a user-tagged batch is temporarily excluded from missing-credit totals.
- **Unmatched** — an EFT line has no corresponding open batch.
- **Reversed** — lines for a batch number net to zero.
- **Over-credited** — net EFT credit is greater than the batch net total.
- **Amount mismatch** — the EFT group and batch net do not agree.
- **Ambiguous** — reserved in the data model, but the current matcher does not emit new ambiguous results.

For an under-credit, missing credit includes only the unpaid shortfall, not the credit already received.

A batch marked **Expected on next invoice** remains excluded during manual reconciliation. For standard Chevron/Jenkins-style stores, uploading another EFT invoice promotes an unresolved expected batch back to **Missing from invoice**. Green Valley stores keep those tags until they are changed manually. The status can be changed from its status pill.

### Preserves confirmed reconciliation history

- Archives matched batches and invoice lines together under a timestamped run.
- Lists confirmed runs with match count and total credit.
- Expands a run to show batch date, batch number, net amount, invoice number, invoice line ID, and invoice amount.
- Includes confirmed results in batch-number searches.
- Keeps unresolved records available for future reconciliation.



### Manages invoices and corrections

- Lists saved invoices as expandable cards with filename, period, line count, and invoice total.
- Displays each invoice line and its current status.
- Deletes an invoice and all its lines after confirmation.
- Deletes an individual open invoice line from the reconciliation context menu.
- Removes the invoice header automatically if its last line is deleted.
- Reconciles remaining open data after deletions so dashboard totals and statuses stay current.

Deletion is permanent. The app asks for confirmation before destructive UI actions, but it does not provide an undo or recycle bin.

### Lets the user move local storage

The default data root is:

```text
~/Documents/Credit Batch Reconciler/
└── Stores/
    ├── Store One.db
    └── Store Two.db
```

**Change location** opens a native folder picker. If stores already exist, the app can move the `.db`, `.db-wal`, and `.db-shm` files to the new `Stores` folder. It prevents moves that would overwrite an existing database with the same filename.

The selected root is remembered in Electron's per-user `settings.json`.

For backups, close the application before copying a store database. Do not open the same live SQLite database concurrently from multiple computers or place it in a multi-writer synced workflow.

## Typical workflow

1. Open **Stores**, choose **Add store**, and enter the store name, site ID, and correct parser templates.
2. Select **Add PDF → Chevron settlement** and import one or more settlement PDFs.
3. Review the extracted rows and warnings, then choose **Confirm and save**.
4. Select **Add PDF → EFT invoice**, review the invoice summary and lines, then save it.
5. Open **Reconciliations** and choose **Reconcile store**.
6. Investigate missing, reversed, over-credited, mismatched, or unmatched items.
7. Mark legitimate timing differences as **Expected on next invoice** when appropriate.
8. Choose **Confirm matches** to archive successful pairs.
9. Use batch-number search and confirmed runs to investigate historical activity.



## Installation and development



### Prerequisites

- Node.js 22.12+ and npm (required by `@electron/rebuild`)
- A native build toolchain for `better-sqlite3`
- Internet access during dependency installation so Electron can be downloaded
- macOS is the currently verified development environment

Daily development runs from source on macOS (`npm start` uses POSIX `env -u`). Windows installers are produced on a Windows GitHub Actions runner — do not cross-compile the `.exe` from a Mac, because `better-sqlite3` needs native Windows binaries.

### Install

```bash
npm install
# or, with a clean lockfile install:
npm ci
```

`postinstall` verifies the Electron download and rebuilds `better-sqlite3` for Electron. If Electron was not installed completely, run:

```bash
npm run setup
```

Locked principal versions today: Electron `35.7.5`, `better-sqlite3` `12.11.1`, and `pdfjs-dist` `3.11.174`.

### Start the desktop app

```bash
npm start
```

The start command rebuilds `better-sqlite3` for Electron, unsets `ELECTRON_RUN_AS_NODE`, and launches the app.

### Run the test suite

```bash
npm test
```

Tests rebuild `better-sqlite3` for the current Node.js runtime and cover:

- Chevron settlement parsing;
- CStore Green Valley settlement parsing;
- Jenkins, Jackson, and Jenkins Green Valley EFT parsing;
- standard and Green Valley reconciliation behavior; and
- SQLite storage, migrations, deduplication, deletion, and reconciliation history.

Native module troubleshooting:

```bash
npm run rebuild:node      # prepare better-sqlite3 for Node-based tests
npm run rebuild:electron  # prepare better-sqlite3 for Electron
```

If a command reports a `NODE_MODULE_VERSION` mismatch, run the rebuild command for the runtime you are about to use.

### Package a Windows installer

On a Windows machine (or in CI), after `npm ci`:

```bash
npm run build:win
```

The NSIS installer is written to `dist/` as `Credit Batch Reconciler-Setup-<version>.exe`.

To ship a downloadable release from GitHub:

1. Commit and push the packaging changes.
2. Create and push a version tag, for example:

```bash
git tag v1.0.0
git push origin v1.0.0
```

1. The **Build Windows installer** workflow runs on `windows-latest`, uploads the `.exe` artifact, and attaches it to a GitHub Release for that tag.
2. Download the installer from the repository **Releases** page.

You can also run the workflow manually from the Actions tab (`workflow_dispatch`) without creating a tag; that uploads the artifact but does not create a Release.

Code signing is not configured yet. Windows SmartScreen may warn on first install until a certificate is added.

Local Mac packages for development smoke-tests:

```bash
npm run build:mac
```



## Architecture

```text
frontend/
  index.html              Electron renderer UI
  css/app.css             Application styling
  js/                     Store, import, dashboard, and reconciliation UI

backend/
  main.js                 Electron window and IPC handlers
  preload.js              Context-isolated renderer API
  paths.js                Data-root configuration and store-file moves
  parsing/                PDF ingestion, normalization, and template registry
  reconciling/            Standard and Green Valley reconciliation engines
  reconciling/db/         SQLite schema, migrations, and store manager

test/
  parsing/                Parser regression tests
  reconciling/            Reconciliation and storage tests

Documentation/
  PRD_credit_batch_reconciler.md
  pdf_extraction_methods.md
```

Root `package.json` scripts: `start`, `test`, `setup`, `build:mac`, `build:win`.
Windows installers are built by `.github/workflows/build-windows.yml` on version tags.

The renderer has no direct Node.js or database access. It uses the context-isolated API in `backend/preload.js`; Electron's main process performs filesystem access, parsing, database work, and reconciliation.

Each store database currently contains:

- store metadata and selected templates;
- settlement batches;
- invoice headers;
- invoice lines;
- schema version information; and
- confirmed reconciliation runs.

Schema migrations run automatically when a store is opened.

## Data and security characteristics

- Processing is local; the application code contains no cloud upload or telemetry integration.
- Electron context isolation is enabled and renderer Node integration is disabled.
- Store databases and imported financial data are not committed because `*.db` is ignored by Git.
- Original PDFs are parsed from the selected files but are not copied into the data folder; the database stores their filenames and extracted values.
- The app is designed for text-based PDFs. It does not perform OCR on scanned images.



## Current limitations

- No Excel or CSV export.
- No import from legacy Excel workbooks.
- No auto-update or code-signing configuration (Windows `.exe` builds via GitHub Actions on version tags).
- No user accounts, permissions, encryption layer, cloud backup, or multi-user synchronization.
- No QuickBooks or other accounting-system integration.
- No OCR for scanned PDFs.
- Unknown PDF layouts require a new parser template in the codebase.
- No manual interface for forcing arbitrary batch-to-line matches.
- No undo for deletions or reconciliation confirmation.

See `Documentation/PRD_credit_batch_reconciler.md` for the broader product roadmap. Treat that document as planning material; this README describes the behavior currently implemented in the repository.

## Adding screenshots

Screenshots are stored in `Screenshots/`. Additional useful captures include:

1. Settlement PDF preview.
2. EFT invoice preview.
3. Open reconciliation with multiple status types.
4. Expanded confirmed run.
5. Expanded invoice card.

Use anonymized store names, site IDs, invoice numbers, filenames, and dollar amounts before committing images.