const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { migrate } = require("./migrations");
const Normalize = require("../../parsing/normalize");
const {
  DEFAULT_BATCH_TEMPLATE,
  DEFAULT_EFT_TEMPLATE,
  normalizeBatchTemplateId,
  normalizeEftTemplateId,
} = require("../../parsing/template-registry");
const { runStoreReconciliation, resetStoreReconciliationState } = require("../reconcile-service");
const { computeMismatchShortfall } = require("../reconcile");

function computePersistedMismatchShortfall(mismatchBatches, lines) {
  const groups = new Map();
  for (const batch of mismatchBatches) {
    const key = Normalize.stripLeadingZeros(batch.batch_number);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(batch);
  }

  let shortfall = 0;
  for (const [, group] of groups) {
    const batchNetTotal = group.reduce((sum, batch) => sum + Number(batch.net_amount), 0);
    const batchIds = new Set(group.map((batch) => batch.id));
    const netEft = lines
      .filter((line) => batchIds.has(line.batch_id))
      .reduce((sum, line) => sum + Number(line.amount), 0);
    shortfall += computeMismatchShortfall(batchNetTotal, netEft);
  }
  return Math.round(shortfall * 100) / 100;
}

function sanitizeStoreName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    throw new Error("Store name is required.");
  }
  const sanitized = trimmed.replace(/[/\\?%*:|"<>]/g, "").trim();
  if (!sanitized) {
    throw new Error("Store name contains only invalid characters.");
  }
  return sanitized;
}

function normalizeSiteId(siteId) {
  const normalized = String(siteId || "").trim();
  if (!/^\d{5,6}$/.test(normalized)) {
    throw new Error("Site ID must be a 5–6 digit Chevron site number.");
  }
  return normalized;
}

function normalizeTemplates(batchTemplate, eftTemplate) {
  return {
    batch_template: normalizeBatchTemplateId(batchTemplate || DEFAULT_BATCH_TEMPLATE),
    eft_template: normalizeEftTemplateId(eftTemplate || DEFAULT_EFT_TEMPLATE),
  };
}

function readStoreMeta(database) {
  try {
    const row =
      database
        .prepare(
          `SELECT site_id, name, created_at, batch_template, eft_template
           FROM store_meta WHERE id = 1`
        )
        .get() || null;
    if (!row) return null;
    const templates = normalizeTemplates(row.batch_template, row.eft_template);
    return {
      ...row,
      batch_template: templates.batch_template,
      eft_template: templates.eft_template,
    };
  } catch {
    return null;
  }
}

function insertStoreMeta(database, name, siteId, batchTemplate, eftTemplate) {
  const templates = normalizeTemplates(batchTemplate, eftTemplate);
  database
    .prepare(
      `INSERT INTO store_meta (id, site_id, name, created_at, batch_template, eft_template)
       VALUES (1, @site_id, @name, @created_at, @batch_template, @eft_template)`
    )
    .run({
      site_id: normalizeSiteId(siteId),
      name: sanitizeStoreName(name),
      created_at: new Date().toISOString(),
      batch_template: templates.batch_template,
      eft_template: templates.eft_template,
    });
}

function upsertStoreMeta(database, name, siteId, batchTemplate, eftTemplate) {
  const existing = readStoreMeta(database);
  const templates = normalizeTemplates(
    batchTemplate ?? existing?.batch_template,
    eftTemplate ?? existing?.eft_template
  );
  const payload = {
    site_id: normalizeSiteId(siteId),
    name: sanitizeStoreName(name),
    batch_template: templates.batch_template,
    eft_template: templates.eft_template,
  };
  if (existing) {
    database
      .prepare(
        `UPDATE store_meta
         SET site_id = @site_id,
             name = @name,
             batch_template = @batch_template,
             eft_template = @eft_template
         WHERE id = 1`
      )
      .run(payload);
    return;
  }
  insertStoreMeta(
    database,
    payload.name,
    payload.site_id,
    payload.batch_template,
    payload.eft_template
  );
}

function inferStoreMetaFromBatches(database, storeName) {
  const rows = database.prepare("SELECT DISTINCT site_id FROM batches WHERE site_id != ''").all();
  if (rows.length !== 1) {
    return null;
  }
  insertStoreMeta(database, storeName, rows[0].site_id);
  return readStoreMeta(database);
}

function ensureStoreMeta(database, storeName) {
  const existing = readStoreMeta(database);
  if (existing) {
    return existing;
  }
  return inferStoreMetaFromBatches(database, storeName);
}

function readStoreMetaFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const database = new Database(filePath);
  try {
    migrate(database);
    return readStoreMeta(database);
  } finally {
    database.close();
  }
}

function assertRecordsMatchStoreSite(records, storeSiteId) {
  const expected = normalizeSiteId(storeSiteId);
  const seen = new Set();

  for (const raw of records) {
    const record = Normalize.toDbRecord(raw);
    const recordSiteId = String(record.site_id || "").trim();
    if (!recordSiteId) {
      throw new Error("PDF batch records are missing a site ID.");
    }
    seen.add(recordSiteId);
    if (recordSiteId !== expected) {
      throw new Error(
        `PDF site ID ${recordSiteId} does not match this store's site ID ${expected}. Open the correct store before saving.`
      );
    }
  }

  if (seen.size > 1) {
    throw new Error(
      `PDF contains multiple site IDs (${[...seen].join(", ")}). Upload one site per PDF.`
    );
  }
}

function createStoreManager(storesDir) {
  fs.mkdirSync(storesDir, { recursive: true });

  let db = null;
  let currentStoreName = null;

  function dbPath(name) {
    return path.join(storesDir, `${sanitizeStoreName(name)}.db`);
  }

  function close() {
    if (db) {
      db.close();
      db = null;
      currentStoreName = null;
    }
  }

  function openDatabase(name) {
    close();
    const storeName = sanitizeStoreName(name);
    const filePath = dbPath(storeName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Store "${storeName}" does not exist.`);
    }
    db = new Database(filePath);
    migrate(db);
    ensureStoreMeta(db, storeName);
    currentStoreName = storeName;
    return db;
  }

  function listStores() {
    return fs
      .readdirSync(storesDir)
      .filter((file) => file.endsWith(".db"))
      .map((file) => {
        const name = path.basename(file, ".db");
        const meta = readStoreMetaFromFile(path.join(storesDir, file));
        return {
          name,
          site_id: meta ? meta.site_id : null,
          batch_template: meta ? meta.batch_template : DEFAULT_BATCH_TEMPLATE,
          eft_template: meta ? meta.eft_template : DEFAULT_EFT_TEMPLATE,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function createStore(name, siteId, batchTemplate, eftTemplate) {
    const storeName = sanitizeStoreName(name);
    const normalizedSiteId = normalizeSiteId(siteId);
    const templates = normalizeTemplates(batchTemplate, eftTemplate);
    const filePath = dbPath(storeName);
    if (fs.existsSync(filePath)) {
      throw new Error(`Store "${storeName}" already exists.`);
    }

    const duplicate = listStores().find((store) => store.site_id === normalizedSiteId);
    if (duplicate) {
      throw new Error(
        `Site ID ${normalizedSiteId} is already linked to store "${duplicate.name}".`
      );
    }

    const newDb = new Database(filePath);
    migrate(newDb);
    insertStoreMeta(
      newDb,
      storeName,
      normalizedSiteId,
      templates.batch_template,
      templates.eft_template
    );
    newDb.close();
    return {
      name: storeName,
      site_id: normalizedSiteId,
      batch_template: templates.batch_template,
      eft_template: templates.eft_template,
    };
  }

  function openStore(name) {
    openDatabase(name);
    const meta = readStoreMeta(requireDb());
    return {
      name: currentStoreName,
      site_id: meta ? meta.site_id : null,
      batch_template: meta ? meta.batch_template : DEFAULT_BATCH_TEMPLATE,
      eft_template: meta ? meta.eft_template : DEFAULT_EFT_TEMPLATE,
      batchCount: getBatchCount(),
      dbPath: dbPath(currentStoreName),
    };
  }

  function requireDb() {
    if (!db) {
      throw new Error("No store is open. Select or create a store first.");
    }
    return db;
  }

  function getStoreInfo() {
    const database = requireDb();
    const meta = ensureStoreMeta(database, currentStoreName);
    return {
      name: currentStoreName,
      site_id: meta ? meta.site_id : null,
      batch_template: meta ? meta.batch_template : DEFAULT_BATCH_TEMPLATE,
      eft_template: meta ? meta.eft_template : DEFAULT_EFT_TEMPLATE,
      batchCount: getBatchCount(),
      dbPath: dbPath(currentStoreName),
    };
  }

  function getBatchCount() {
    const row = requireDb().prepare("SELECT COUNT(*) AS c FROM batches").get();
    return row.c;
  }

  /**
   * Bring stored match statuses back in sync after any batch/invoice mutation.
   * Re-runs the full reconciliation when invoices exist; otherwise resets all
   * flags so nothing is left claiming "missing" against zero invoices.
   */
  function resyncReconciliation() {
    const database = requireDb();
    const invoiceCount = database.prepare("SELECT COUNT(*) AS c FROM invoices").get().c;
    if (invoiceCount > 0) {
      return reconcileStore();
    }
    resetStoreReconciliationState(database);
    return null;
  }

  function getBatches() {
    return requireDb()
      .prepare(
        `SELECT id, site_id, batch_date, batch_number, gross_amount, total_fee,
                net_amount, source_pdf, ingested_at, match_status,
                invoice_line_id, invoice_amount, last_reconciled_at, reconciliation_run_id
         FROM batches
         ORDER BY batch_date, batch_number`
      )
      .all();
  }

  function getOpenBatches() {
    return getBatches().filter((batch) => batch.reconciliation_run_id == null);
  }

  function pruneEmptyReconciliationRuns(database) {
    database
      .prepare(
        `DELETE FROM reconciliation_runs
         WHERE id NOT IN (
           SELECT reconciliation_run_id FROM batches WHERE reconciliation_run_id IS NOT NULL
           UNION
           SELECT reconciliation_run_id FROM invoice_lines WHERE reconciliation_run_id IS NOT NULL
         )`
      )
      .run();
  }

  function deleteBatchesByIds(database, ids) {
    if (!ids.length) {
      return { deletedCount: 0, matchedCount: 0 };
    }

    const placeholders = ids.map(() => "?").join(", ");
    const matchedRow = database
      .prepare(
        `SELECT COUNT(*) AS c
         FROM batches
         WHERE id IN (${placeholders}) AND match_status = 'matched'`
      )
      .get(...ids);

    database
      .prepare(
        `UPDATE invoice_lines
         SET match_status = 'unmatched', batch_id = NULL, reconciliation_run_id = NULL
         WHERE batch_id IN (${placeholders})`
      )
      .run(...ids);

    const result = database
      .prepare(`DELETE FROM batches WHERE id IN (${placeholders})`)
      .run(...ids);

    pruneEmptyReconciliationRuns(database);

    return {
      deletedCount: result.changes,
      matchedCount: matchedRow.c,
    };
  }

  function deleteBatch(batchId) {
    const database = requireDb();
    const id = Number(batchId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("A valid batch ID is required.");
    }

    const batch = database
      .prepare(
        `SELECT id, batch_date, batch_number, net_amount, match_status, invoice_line_id
         FROM batches
         WHERE id = ?`
      )
      .get(id);

    if (!batch) {
      throw new Error("Batch not found.");
    }

    const run = database.transaction(() => {
      deleteBatchesByIds(database, [id]);
    });

    run();

    const reconciliation = resyncReconciliation();

    return {
      id: batch.id,
      batchDate: batch.batch_date,
      batchNumber: batch.batch_number,
      netAmount: batch.net_amount,
      wasMatched: batch.match_status === "matched",
      batchCount: getBatchCount(),
      reconciliation,
    };
  }

  function deleteBatchSource(sourcePdf, ingestedAt) {
    const database = requireDb();
    const ingested = String(ingestedAt || "").trim();
    if (!ingested) {
      throw new Error("Upload timestamp is required.");
    }

    const source = sourcePdf == null ? "" : String(sourcePdf);

    const batches = database
      .prepare(
        `SELECT id, source_pdf, ingested_at
         FROM batches
         WHERE COALESCE(source_pdf, '') = ?
           AND ingested_at = ?`
      )
      .all(source, ingested);

    if (!batches.length) {
      throw new Error("No batches found for this upload.");
    }

    const ids = batches.map((batch) => batch.id);
    let deletedCount = 0;
    let matchedCount = 0;

    const run = database.transaction(() => {
      const result = deleteBatchesByIds(database, ids);
      deletedCount = result.deletedCount;
      matchedCount = result.matchedCount;
    });

    run();

    const reconciliation = resyncReconciliation();

    return {
      sourcePdf: batches[0].source_pdf || "",
      ingestedAt: batches[0].ingested_at,
      deletedCount,
      matchedCount,
      batchCount: getBatchCount(),
      reconciliation,
    };
  }

  function insertBatches(records, sourcePdf) {
    const database = requireDb();
    const meta = ensureStoreMeta(database, currentStoreName);
    if (!meta || !meta.site_id) {
      throw new Error(
        "This store has no linked site ID. Create a new store with a site ID, or add batches that all share one site ID first."
      );
    }

    assertRecordsMatchStoreSite(records, meta.site_id);

    const ingestedAt = new Date().toISOString();
    const insert = database.prepare(
      `INSERT OR IGNORE INTO batches (
         site_id, batch_date, batch_number, gross_amount, total_fee, net_amount,
         source_pdf, ingested_at, match_status
       ) VALUES (
         @site_id, @batch_date, @batch_number, @gross_amount, @total_fee, @net_amount,
         @source_pdf, @ingested_at, @match_status
       )`
    );

    let added = 0;
    let skipped = 0;

    const run = database.transaction((rows) => {
      for (const raw of rows) {
        const record = Normalize.toDbRecord(raw);
        const result = insert.run({
          site_id: record.site_id,
          batch_date: record.batch_date,
          batch_number: record.batch_number,
          gross_amount: record.gross_amount,
          total_fee: record.total_fee,
          net_amount: record.net_amount,
          source_pdf: sourcePdf || null,
          ingested_at: ingestedAt,
          match_status: "unmatched",
        });
        if (result.changes > 0) {
          added += 1;
        } else {
          skipped += 1;
        }
      }
    });

    run(records);

    const reconciliation = resyncReconciliation();

    return { added, skipped, reconciliation };
  }

  function updateStore(name, siteId, batchTemplate, eftTemplate) {
    const database = requireDb();
    const oldName = currentStoreName;
    const meta = ensureStoreMeta(database, oldName);
    const newName = sanitizeStoreName(name);
    const newSiteId = normalizeSiteId(siteId);
    const templates = normalizeTemplates(
      batchTemplate ?? meta?.batch_template,
      eftTemplate ?? meta?.eft_template
    );

    const duplicate = listStores().find(
      (store) => store.site_id === newSiteId && store.name !== oldName
    );
    if (duplicate) {
      throw new Error(
        `Site ID ${newSiteId} is already linked to store "${duplicate.name}".`
      );
    }

    const currentSiteId = meta ? meta.site_id : null;
    if (currentSiteId !== newSiteId) {
      const batchSiteIds = database
        .prepare("SELECT DISTINCT site_id FROM batches WHERE site_id != ''")
        .all()
        .map((row) => row.site_id);
      if (batchSiteIds.some((id) => id !== newSiteId)) {
        throw new Error(
          "Cannot change site ID while this store has batches tied to a different site ID."
        );
      }
    }

    upsertStoreMeta(
      database,
      newName,
      newSiteId,
      templates.batch_template,
      templates.eft_template
    );

    if (newName !== oldName) {
      const oldPath = dbPath(oldName);
      const newPath = dbPath(newName);
      if (fs.existsSync(newPath)) {
        throw new Error(`Store "${newName}" already exists.`);
      }
      db.close();
      db = null;
      fs.renameSync(oldPath, newPath);
      db = new Database(newPath);
      migrate(db);
      currentStoreName = newName;
    }

    return {
      name: currentStoreName,
      site_id: newSiteId,
      batch_template: templates.batch_template,
      eft_template: templates.eft_template,
      batchCount: getBatchCount(),
      dbPath: dbPath(currentStoreName),
    };
  }

  function deleteStore(name) {
    const storeName = sanitizeStoreName(name);
    const filePath = dbPath(storeName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Store "${storeName}" does not exist.`);
    }

    if (currentStoreName === storeName) {
      close();
    }

    for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
      if (fs.existsSync(candidate)) {
        fs.unlinkSync(candidate);
      }
    }

    return { deleted: storeName };
  }

  function computeInvoicePeriod(batchLines) {
    if (!batchLines.length) {
      return { periodStart: null, periodEnd: null };
    }

    const dates = batchLines
      .map((line) => line.inv_date)
      .filter(Boolean)
      .sort();

    return {
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
    };
  }

  function formatProcessedAt(iso) {
    if (!iso) return "a previous date";
    const d = new Date(iso);
    return d.toLocaleString();
  }

  function insertInvoice(summary, batchLines, pdfFilename) {
    const database = requireDb();

    if (!summary || !summary.invoiceNumber) {
      throw new Error("Invoice summary is missing an invoice number.");
    }

    const invoiceNumber = String(summary.invoiceNumber).trim();
    if (!invoiceNumber) {
      throw new Error("Invoice number is required.");
    }

    if (!batchLines || batchLines.length === 0) {
      throw new Error("Invoice has no batch lines to save.");
    }

    const existing = database
      .prepare(`SELECT id, processed_at FROM invoices WHERE invoice_number = ?`)
      .get(invoiceNumber);

    if (existing) {
      return {
        skipped: true,
        duplicate: true,
        invoiceNumber,
        uploadedAt: existing.processed_at,
        uploadedAtLabel: formatProcessedAt(existing.processed_at),
        lineCount: 0,
      };
    }

    const normalizedLines = batchLines.map((line) => Normalize.toInvoiceDbLine(line));
    const { periodStart, periodEnd } = computeInvoicePeriod(normalizedLines);
    const processedAt = new Date().toISOString();

    const insertInvoiceStmt = database.prepare(
      `INSERT INTO invoices (
         invoice_number, invoice_total, invoice_balance, pdf_filename, processed_at, period_start, period_end
       ) VALUES (
         @invoice_number, @invoice_total, @invoice_balance, @pdf_filename, @processed_at, @period_start, @period_end
       )`
    );

    const insertLineStmt = database.prepare(
      `INSERT INTO invoice_lines (
         invoice_id, invoice_line_id, batch_number, amount, inv_date, match_status
       ) VALUES (
         @invoice_id, @invoice_line_id, @batch_number, @amount, @inv_date, @match_status
       )`
    );

    let invoiceId = null;

    const run = database.transaction(() => {
      const result = insertInvoiceStmt.run({
        invoice_number: invoiceNumber,
        invoice_total: Number(summary.amount),
        invoice_balance: summary.balance == null ? null : Number(summary.balance),
        pdf_filename: pdfFilename || null,
        processed_at: processedAt,
        period_start: periodStart,
        period_end: periodEnd,
      });
      invoiceId = result.lastInsertRowid;

      for (const line of normalizedLines) {
        insertLineStmt.run({
          invoice_id: invoiceId,
          invoice_line_id: line.invoice_line_id,
          batch_number: line.batch_number,
          amount: line.amount,
          inv_date: line.inv_date,
          match_status: "unmatched",
        });
      }
    });

    run();

    // New EFT: promote any "expected on next invoice" tags that still lack a line.
    const reconciliation = reconcileStore({ promoteExpected: true });

    return {
      invoiceId,
      lineCount: normalizedLines.length,
      periodStart,
      periodEnd,
      reconciliation,
    };
  }

  function getInvoices() {
    return requireDb()
      .prepare(
        `SELECT i.id, i.invoice_number, i.invoice_total, i.invoice_balance, i.pdf_filename,
                i.processed_at, i.period_start, i.period_end,
                COUNT(l.id) AS line_count
         FROM invoices i
         LEFT JOIN invoice_lines l ON l.invoice_id = i.id
         GROUP BY i.id
         ORDER BY i.processed_at DESC`
      )
      .all();
  }

  function getInvoiceLines(invoiceId) {
    return requireDb()
      .prepare(
        `SELECT id, invoice_line_id, batch_number, amount, inv_date, match_status, batch_id
         FROM invoice_lines
         WHERE invoice_id = ?
         ORDER BY inv_date, invoice_line_id`
      )
      .all(invoiceId);
  }

  function deleteInvoice(invoiceId) {
    const database = requireDb();
    const id = Number(invoiceId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("A valid invoice ID is required.");
    }

    const invoice = database
      .prepare(
        `SELECT id, invoice_number, pdf_filename, period_start, period_end
         FROM invoices
         WHERE id = ?`
      )
      .get(id);

    if (!invoice) {
      throw new Error("Invoice not found.");
    }

    const lineCount = database
      .prepare(`SELECT COUNT(*) AS c FROM invoice_lines WHERE invoice_id = ?`)
      .get(id).c;

    const run = database.transaction(() => {
      database.prepare(`DELETE FROM invoice_lines WHERE invoice_id = ?`).run(id);
      database.prepare(`DELETE FROM invoices WHERE id = ?`).run(id);
      pruneEmptyReconciliationRuns(database);
    });

    run();

    // Resets every batch flag (including missing_from_invoice rows that had no
    // line link) and re-reconciles against whatever invoices remain.
    const reconciliation = resyncReconciliation();

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      pdfFilename: invoice.pdf_filename || "",
      lineCount,
      invoiceCount: database.prepare(`SELECT COUNT(*) AS c FROM invoices`).get().c,
      reconciliation,
    };
  }

  function deleteInvoiceLine(lineId) {
    const database = requireDb();
    const id = Number(lineId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("A valid invoice line ID is required.");
    }

    const line = database
      .prepare(
        `SELECT l.id, l.invoice_id, l.invoice_line_id, l.batch_number, l.amount,
                l.inv_date, l.batch_id, i.invoice_number
         FROM invoice_lines l
         JOIN invoices i ON i.id = l.invoice_id
         WHERE l.id = ?`
      )
      .get(id);

    if (!line) {
      throw new Error("Invoice line not found.");
    }

    let invoiceDeleted = false;

    const run = database.transaction(() => {
      if (line.batch_id) {
        database
          .prepare(
            `UPDATE batches
             SET match_status = 'unmatched',
                 invoice_line_id = NULL,
                 invoice_amount = NULL,
                 last_reconciled_at = NULL,
                 reconciliation_run_id = NULL
             WHERE id = ?`
          )
          .run(line.batch_id);
      }

      database.prepare(`DELETE FROM invoice_lines WHERE id = ?`).run(id);

      const remaining = database
        .prepare(
          `SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS total
           FROM invoice_lines
           WHERE invoice_id = ?`
        )
        .get(line.invoice_id);

      if (remaining.c === 0) {
        database.prepare(`DELETE FROM invoices WHERE id = ?`).run(line.invoice_id);
        invoiceDeleted = true;
      } else {
        database
          .prepare(`UPDATE invoices SET invoice_total = ? WHERE id = ?`)
          .run(Number(remaining.total), line.invoice_id);
      }

      pruneEmptyReconciliationRuns(database);
    });

    run();

    const reconciliation = resyncReconciliation();

    return {
      lineId: line.id,
      invoiceId: line.invoice_id,
      invoiceNumber: line.invoice_number,
      invoiceLineId: line.invoice_line_id,
      batchNumber: line.batch_number,
      amount: line.amount,
      invoiceDeleted,
      invoiceCount: database.prepare(`SELECT COUNT(*) AS c FROM invoices`).get().c,
      reconciliation,
    };
  }

  function getInvoiceForReconcile(invoiceId) {
    return requireDb()
      .prepare(
        `SELECT id, invoice_number, invoice_total, period_start, period_end
         FROM invoices
         WHERE id = ?`
      )
      .get(invoiceId);
  }

  function getBatchesInPeriod(periodStart, periodEnd) {
    return requireDb()
      .prepare(
        `SELECT id, site_id, batch_date, batch_number, gross_amount, total_fee, net_amount,
                match_status, invoice_line_id, invoice_amount, last_reconciled_at,
                reconciliation_run_id
         FROM batches
         WHERE batch_date >= ? AND batch_date <= ?
         ORDER BY batch_date, batch_number, id`
      )
      .all(periodStart, periodEnd);
  }

  function getAllInvoiceLines() {
    return requireDb()
      .prepare(
        `SELECT l.id, l.invoice_id, l.invoice_line_id, l.batch_number, l.amount, l.inv_date,
                l.match_status, l.batch_id, l.reconciliation_run_id, i.invoice_number
         FROM invoice_lines l
         JOIN invoices i ON i.id = l.invoice_id
         ORDER BY l.inv_date, l.invoice_line_id`
      )
      .all();
  }

  function getOpenInvoiceLines() {
    return getAllInvoiceLines().filter((line) => line.reconciliation_run_id == null);
  }

  function reconcileStore(options = {}) {
    const database = requireDb();
    const meta = ensureStoreMeta(database, currentStoreName);
    return runStoreReconciliation(
      database,
      {
        getBatches,
        getAllInvoiceLines,
        getInvoices,
      },
      {
        ...options,
        batchTemplate: meta ? meta.batch_template : DEFAULT_BATCH_TEMPLATE,
      }
    );
  }

  /**
   * Manually tag (or clear) an open batch as expected on the next EFT.
   * Open batches only; matched / archived rows are rejected.
   */
  function setBatchExpectedOnNextInvoice(batchId, expected) {
    const database = requireDb();
    const id = Number(batchId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("A valid batch ID is required.");
    }

    const batch = database
      .prepare(
        `SELECT id, batch_date, batch_number, net_amount, match_status, reconciliation_run_id
         FROM batches
         WHERE id = ?`
      )
      .get(id);

    if (!batch) {
      throw new Error("Batch not found.");
    }

    if (batch.reconciliation_run_id != null) {
      throw new Error("Confirmed batches cannot be marked expected on next invoice.");
    }

    const openStatuses = new Set([
      "unmatched",
      "missing_from_invoice",
      "expected_on_next_invoice",
    ]);
    if (!openStatuses.has(batch.match_status)) {
      throw new Error(
        `Only open unmatched or missing batches can be marked expected (got ${batch.match_status}).`
      );
    }

    const wantExpected = Boolean(expected);
    let nextStatus;
    if (wantExpected) {
      nextStatus = "expected_on_next_invoice";
    } else {
      const invoiceCount = database.prepare("SELECT COUNT(*) AS c FROM invoices").get().c;
      nextStatus = invoiceCount > 0 ? "missing_from_invoice" : "unmatched";
    }

    database
      .prepare(`UPDATE batches SET match_status = ? WHERE id = ? AND reconciliation_run_id IS NULL`)
      .run(nextStatus, id);

    return {
      id: batch.id,
      batchDate: batch.batch_date,
      batchNumber: batch.batch_number,
      netAmount: batch.net_amount,
      matchStatus: nextStatus,
      reconciliation: getStoreReconciliation(),
    };
  }

  function buildWorkingReconciliation(batches, lines, invoices) {
    if (batches.length === 0 && lines.length === 0) {
      return null;
    }

    const hasReconciled = batches.some((batch) => batch.last_reconciled_at);
    if (!hasReconciled) {
      return null;
    }

    const invoiceTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.invoice_total), 0);
    const runAt = batches.reduce((latest, batch) => {
      if (!batch.last_reconciled_at) return latest;
      if (!latest || batch.last_reconciled_at > latest) return batch.last_reconciled_at;
      return latest;
    }, null);

    const matchedBatchIds = new Set();
    const matched = [];
    for (const batch of batches) {
      if (batch.match_status !== "matched") {
        continue;
      }
      if (matchedBatchIds.has(batch.id)) {
        continue;
      }
      matchedBatchIds.add(batch.id);
      const linkedLines = lines.filter((line) => line.batch_id === batch.id);
      const primaryLine = linkedLines.find((line) => Number(line.amount) < 0) || linkedLines[0];
      matched.push({
        batchId: batch.id,
        batchDate: batch.batch_date,
        batchNumber: batch.batch_number,
        grossAmount: batch.gross_amount,
        totalFee: batch.total_fee,
        netAmount: batch.net_amount,
        invoiceLineId: linkedLines.map((line) => line.invoice_line_id).join(", "),
        invoiceNumber: primaryLine ? primaryLine.invoice_number : null,
        invoiceAmount: batch.invoice_amount != null ? Number(batch.invoice_amount) : null,
        lineCount: linkedLines.length,
        invDate: primaryLine ? primaryLine.inv_date : null,
      });
    }

    const missingBatches = batches.filter((batch) => batch.match_status === "missing_from_invoice");
    const expectedOnNextInvoiceBatches = batches.filter(
      (batch) => batch.match_status === "expected_on_next_invoice"
    );
    const reversedBatches = batches.filter((batch) => batch.match_status === "reversed");
    const overCreditedBatches = batches.filter((batch) => batch.match_status === "over_credited");
    const mismatchBatches = batches.filter((batch) => batch.match_status === "mismatch");
    // Expected-on-next-invoice is excluded from missing credit until the next EFT.
    // Amount-mismatch contributes shortfall only (batch nets − |invoice credit|).
    const missingBatchCredit = missingBatches.reduce(
      (sum, batch) => sum + Number(batch.net_amount),
      0
    );
    const mismatchShortfall = computePersistedMismatchShortfall(mismatchBatches, lines);
    const totalMissingCredit = Math.round((missingBatchCredit + mismatchShortfall) * 100) / 100;
    const matchedCount = matched.length;
    const totalDeposit = matched.reduce((sum, row) => sum + Number(row.grossAmount), 0);
    const totalFee = matched.reduce((sum, row) => sum + Number(row.totalFee), 0);
    const totalCredit = matched.reduce((sum, row) => sum + Number(row.netAmount), 0);
    const unmatchedLineCount = lines.filter((line) => line.match_status === "unmatched").length;
    const ambiguousLineCount = lines.filter((line) => line.match_status === "ambiguous").length;

    const exceptions = [];
    for (const batch of missingBatches) {
      exceptions.push({
        type: "missing_from_invoice",
        batchId: batch.id,
        batchDate: batch.batch_date,
        batchNumber: batch.batch_number,
        netAmount: batch.net_amount,
        invoiceLineId: null,
        invoiceAmount: null,
        message: "Batch has no matching invoice line.",
      });
    }

    for (const batch of expectedOnNextInvoiceBatches) {
      exceptions.push({
        type: "expected_on_next_invoice",
        batchId: batch.id,
        batchDate: batch.batch_date,
        batchNumber: batch.batch_number,
        netAmount: batch.net_amount,
        invoiceLineId: null,
        invoiceAmount: null,
        message: "Marked as expected on next invoice.",
      });
    }

    for (const batch of [...reversedBatches, ...overCreditedBatches, ...mismatchBatches]) {
      const linkedLines = lines.filter((line) => line.batch_id === batch.id);
      const netEft = linkedLines.reduce((sum, line) => sum + Number(line.amount), 0);
      exceptions.push({
        type: batch.match_status,
        batchId: batch.id,
        batchDate: batch.batch_date,
        batchNumber: batch.batch_number,
        netAmount: batch.net_amount,
        netEft: Math.round(netEft * 100) / 100,
        invoiceLineId: linkedLines.map((line) => line.invoice_line_id).join(", "),
        invoiceAmount: netEft,
        lineCount: linkedLines.length,
        message: `${batch.match_status} for batch ${batch.batch_number}.`,
      });
    }

    for (const line of lines) {
      if (line.match_status === "unmatched") {
        exceptions.push({
          type: "unmatched_line",
          batchId: null,
          batchDate: null,
          batchNumber: line.batch_number,
          netAmount: null,
          invoiceLineId: line.invoice_line_id,
          invoiceAmount: line.amount,
          message: "No matching batch found in store for this invoice line.",
        });
      } else if (line.match_status === "ambiguous") {
        exceptions.push({
          type: "ambiguous",
          batchId: null,
          batchDate: null,
          batchNumber: line.batch_number,
          netAmount: null,
          invoiceLineId: line.invoice_line_id,
          invoiceAmount: line.amount,
          message: "Multiple batch candidates with the same date proximity.",
        });
      }
    }

    return {
      runAt,
      invoiceCount: invoices.length,
      pendingConfirmCount: matchedCount,
      summary: {
        scopedBatchCount: batches.length,
        lineCount: lines.length,
        matchedCount,
        missingFromInvoiceCount: missingBatches.length,
        reversedCount: reversedBatches.length,
        overCreditedCount: overCreditedBatches.length,
        mismatchCount: mismatchBatches.length,
        unmatchedLineCount,
        ambiguousLineCount,
        totalDeposit: Math.round(totalDeposit * 100) / 100,
        totalFee: Math.round(totalFee * 100) / 100,
        totalCredit: Math.round(totalCredit * 100) / 100,
        invoiceTotal: Math.round(invoiceTotal * 100) / 100,
        creditDiscrepancy: Math.round(totalMissingCredit * 100) / 100,
        totalMissingCredit: Math.round(totalMissingCredit * 100) / 100,
      },
      matched,
      exceptions,
    };
  }

  function getStoreReconciliation() {
    const database = requireDb();
    const meta = ensureStoreMeta(database, currentStoreName);
    const openBatches = getOpenBatches();
    const openLines = getOpenInvoiceLines();
    if (
      meta?.batch_template === "cstore_green_valley" &&
      (openBatches.length > 0 || openLines.length > 0)
    ) {
      return reconcileStore();
    }
    return buildWorkingReconciliation(openBatches, openLines, getInvoices());
  }

  function confirmReconciliation() {
    const database = requireDb();
    const openBatches = getOpenBatches();
    const openLines = getOpenInvoiceLines();
    const matchedBatches = openBatches.filter((batch) => batch.match_status === "matched");
    const matchedLines = openLines.filter((line) => line.match_status === "matched");

    if (matchedBatches.length === 0) {
      throw new Error("No matched pairs to confirm. Run Reconcile store first.");
    }

    const meta = ensureStoreMeta(database, currentStoreName);
    const working =
      meta?.batch_template === "cstore_green_valley"
        ? reconcileStore()
        : buildWorkingReconciliation(openBatches, openLines, getInvoices());
    const summary = working.summary;
    const runAt = new Date().toISOString();

    const insertRun = database.prepare(
      `INSERT INTO reconciliation_runs (
         run_at, matched_count, missing_from_invoice_count, unmatched_line_count,
         mismatch_count, reversed_count, over_credited_count,
         total_deposit, total_fee, total_credit, credit_discrepancy
       ) VALUES (
         @run_at, @matched_count, @missing_from_invoice_count, @unmatched_line_count,
         @mismatch_count, @reversed_count, @over_credited_count,
         @total_deposit, @total_fee, @total_credit, @credit_discrepancy
       )`
    );

    const updateBatch = database.prepare(
      `UPDATE batches SET reconciliation_run_id = ? WHERE id = ? AND reconciliation_run_id IS NULL`
    );
    const updateLine = database.prepare(
      `UPDATE invoice_lines SET reconciliation_run_id = ? WHERE id = ? AND reconciliation_run_id IS NULL`
    );

    const run = database.transaction(() => {
      const result = insertRun.run({
        run_at: runAt,
        matched_count: matchedBatches.length,
        missing_from_invoice_count: summary.missingFromInvoiceCount,
        unmatched_line_count: summary.unmatchedLineCount,
        mismatch_count: summary.mismatchCount,
        reversed_count: summary.reversedCount,
        over_credited_count: summary.overCreditedCount,
        total_deposit: summary.totalDeposit,
        total_fee: summary.totalFee,
        total_credit: summary.totalCredit,
        credit_discrepancy: summary.creditDiscrepancy,
      });

      const runId = Number(result.lastInsertRowid);
      for (const batch of matchedBatches) {
        updateBatch.run(runId, batch.id);
      }
      for (const line of matchedLines) {
        updateLine.run(runId, line.id);
      }
      return runId;
    });

    const runId = run();
    return getReconciliationRun(runId);
  }

  function listReconciliationRuns() {
    return requireDb()
      .prepare(
        `SELECT id, run_at, matched_count, missing_from_invoice_count, unmatched_line_count,
                mismatch_count, reversed_count, over_credited_count,
                total_deposit, total_fee, total_credit, credit_discrepancy
         FROM reconciliation_runs
         ORDER BY run_at DESC, id DESC`
      )
      .all();
  }

  function getReconciliationRun(runId) {
    const database = requireDb();
    const id = Number(runId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("A valid reconciliation run ID is required.");
    }

    const run = database
      .prepare(
        `SELECT id, run_at, matched_count, missing_from_invoice_count, unmatched_line_count,
                mismatch_count, reversed_count, over_credited_count,
                total_deposit, total_fee, total_credit, credit_discrepancy
         FROM reconciliation_runs
         WHERE id = ?`
      )
      .get(id);

    if (!run) {
      throw new Error("Reconciliation run not found.");
    }

    const batches = database
      .prepare(
        `SELECT id, batch_date, batch_number, gross_amount, total_fee, net_amount,
                invoice_line_id, invoice_amount, match_status
         FROM batches
         WHERE reconciliation_run_id = ?
         ORDER BY batch_date, batch_number, id`
      )
      .all(id);

    const lines = database
      .prepare(
        `SELECT l.id, l.invoice_line_id, l.batch_number, l.amount, l.inv_date,
                l.batch_id, i.invoice_number
         FROM invoice_lines l
         JOIN invoices i ON i.id = l.invoice_id
         WHERE l.reconciliation_run_id = ?
         ORDER BY l.inv_date, l.invoice_line_id`
      )
      .all(id);

    const matched = batches.map((batch) => {
      const linkedLines = lines.filter((line) => line.batch_id === batch.id);
      const primaryLine = linkedLines.find((line) => Number(line.amount) < 0) || linkedLines[0];
      return {
        batchId: batch.id,
        batchDate: batch.batch_date,
        batchNumber: batch.batch_number,
        grossAmount: batch.gross_amount,
        totalFee: batch.total_fee,
        netAmount: batch.net_amount,
        invoiceLineId:
          linkedLines.map((line) => line.invoice_line_id).join(", ") || batch.invoice_line_id,
        invoiceNumber: primaryLine ? primaryLine.invoice_number : null,
        invoiceAmount: batch.invoice_amount != null ? Number(batch.invoice_amount) : null,
        lineCount: linkedLines.length,
        invDate: primaryLine ? primaryLine.inv_date : null,
      };
    });

    return {
      id: run.id,
      runAt: run.run_at,
      matchedCount: run.matched_count,
      summary: {
        matchedCount: run.matched_count,
        missingFromInvoiceCount: run.missing_from_invoice_count,
        unmatchedLineCount: run.unmatched_line_count,
        mismatchCount: run.mismatch_count,
        reversedCount: run.reversed_count,
        overCreditedCount: run.over_credited_count,
        totalDeposit: run.total_deposit,
        totalFee: run.total_fee,
        totalCredit: run.total_credit,
        creditDiscrepancy: run.credit_discrepancy,
      },
      matched,
    };
  }

  function getReconciliationScope() {
    const batches = getOpenBatches();
    const lines = getOpenInvoiceLines();
    const invoices = getInvoices();
    const pendingConfirmCount = batches.filter((batch) => batch.match_status === "matched").length;

    return {
      batches,
      lines,
      invoiceCount: invoices.length,
      pendingConfirmCount,
    };
  }

  function searchByBatchNumber(rawQuery) {
    requireDb();
    const trimmed = String(rawQuery || "").trim();
    const query = trimmed ? Normalize.stripLeadingZeros(trimmed) : "";
    if (!query) {
      return {
        query: "",
        openBatches: [],
        openLines: [],
        reconciled: [],
      };
    }

    function matches(batchNumber) {
      const normalized = Normalize.stripLeadingZeros(batchNumber);
      return normalized === query || normalized.startsWith(query);
    }

    const allBatches = getBatches();
    const allLines = getAllInvoiceLines();
    const runMeta = new Map(
      listReconciliationRuns().map((run) => [run.id, run])
    );

    const openBatches = allBatches.filter(
      (batch) => batch.reconciliation_run_id == null && matches(batch.batch_number)
    );
    const openLines = allLines.filter(
      (line) => line.reconciliation_run_id == null && matches(line.batch_number)
    );

    const reconciledBatches = allBatches.filter(
      (batch) => batch.reconciliation_run_id != null && matches(batch.batch_number)
    );
    const includedLineIds = new Set();

    const reconciled = reconciledBatches.map((batch) => {
      const linkedLines = allLines.filter((line) => line.batch_id === batch.id);
      linkedLines.forEach((line) => includedLineIds.add(line.id));
      const primaryLine =
        linkedLines.find((line) => Number(line.amount) < 0) || linkedLines[0];
      const run = runMeta.get(batch.reconciliation_run_id);
      return {
        batchId: batch.id,
        batchDate: batch.batch_date,
        batchNumber: batch.batch_number,
        netAmount: batch.net_amount,
        invoiceNumber: primaryLine ? primaryLine.invoice_number : null,
        invoiceLineId:
          linkedLines.map((line) => line.invoice_line_id).join(", ") ||
          batch.invoice_line_id,
        invoiceAmount:
          batch.invoice_amount != null ? Number(batch.invoice_amount) : null,
        runId: batch.reconciliation_run_id,
        runAt: run ? run.run_at : batch.last_reconciled_at,
      };
    });

    const orphanReconciledLines = allLines.filter(
      (line) =>
        line.reconciliation_run_id != null &&
        matches(line.batch_number) &&
        !includedLineIds.has(line.id)
    );

    for (const line of orphanReconciledLines) {
      const run = runMeta.get(line.reconciliation_run_id);
      reconciled.push({
        batchId: line.batch_id,
        batchDate: line.inv_date,
        batchNumber: line.batch_number,
        netAmount: null,
        invoiceNumber: line.invoice_number,
        invoiceLineId: line.invoice_line_id,
        invoiceAmount: Number(line.amount),
        runId: line.reconciliation_run_id,
        runAt: run ? run.run_at : null,
      });
    }

    reconciled.sort((a, b) => {
      const runCmp = String(b.runAt || "").localeCompare(String(a.runAt || ""));
      if (runCmp !== 0) return runCmp;
      const dateCmp = String(a.batchDate || "").localeCompare(String(b.batchDate || ""));
      if (dateCmp !== 0) return dateCmp;
      return String(a.batchNumber).localeCompare(String(b.batchNumber));
    });

    return {
      query,
      openBatches,
      openLines,
      reconciled,
    };
  }

  return {
    listStores,
    createStore,
    openStore,
    close,
    getBatches,
    getBatchCount,
    deleteBatch,
    deleteBatchSource,
    setBatchExpectedOnNextInvoice,
    getStoreInfo,
    updateStore,
    deleteStore,
    insertBatches,
    insertInvoice,
    getInvoices,
    getInvoiceLines,
    getAllInvoiceLines,
    deleteInvoice,
    deleteInvoiceLine,
    getInvoiceForReconcile,
    getBatchesInPeriod,
    getReconciliationScope,
    searchByBatchNumber,
    reconcileStore,
    getStoreReconciliation,
    confirmReconciliation,
    listReconciliationRuns,
    getReconciliationRun,
    getCurrentStoreName: () => currentStoreName,
    normalizeSiteId,
  };
}

module.exports = {
  createStoreManager,
  sanitizeStoreName,
  normalizeSiteId,
  assertRecordsMatchStoreSite,
};
