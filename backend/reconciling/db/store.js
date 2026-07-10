const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { migrate } = require("./migrations");
const Normalize = require("../../parsing/normalize");
const { runStoreReconciliation, resetStoreReconciliationState } = require("../reconcile-service");

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

function readStoreMeta(database) {
  try {
    return database.prepare("SELECT site_id, name, created_at FROM store_meta WHERE id = 1").get() || null;
  } catch {
    return null;
  }
}

function insertStoreMeta(database, name, siteId) {
  database
    .prepare(
      `INSERT INTO store_meta (id, site_id, name, created_at)
       VALUES (1, @site_id, @name, @created_at)`
    )
    .run({
      site_id: normalizeSiteId(siteId),
      name: sanitizeStoreName(name),
      created_at: new Date().toISOString(),
    });
}

function upsertStoreMeta(database, name, siteId) {
  const existing = readStoreMeta(database);
  const payload = {
    site_id: normalizeSiteId(siteId),
    name: sanitizeStoreName(name),
  };
  if (existing) {
    database
      .prepare(`UPDATE store_meta SET site_id = @site_id, name = @name WHERE id = 1`)
      .run(payload);
    return;
  }
  insertStoreMeta(database, payload.name, payload.site_id);
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
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function createStore(name, siteId) {
    const storeName = sanitizeStoreName(name);
    const normalizedSiteId = normalizeSiteId(siteId);
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
    insertStoreMeta(newDb, storeName, normalizedSiteId);
    newDb.close();
    return { name: storeName, site_id: normalizedSiteId };
  }

  function openStore(name) {
    openDatabase(name);
    const meta = readStoreMeta(requireDb());
    return {
      name: currentStoreName,
      site_id: meta ? meta.site_id : null,
      batchCount: getBatchCount(),
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
      batchCount: getBatchCount(),
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
                invoice_line_id, invoice_amount, last_reconciled_at
         FROM batches
         ORDER BY batch_date, batch_number`
      )
      .all();
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
         SET match_status = 'unmatched', batch_id = NULL
         WHERE batch_id IN (${placeholders})`
      )
      .run(...ids);

    const result = database
      .prepare(`DELETE FROM batches WHERE id IN (${placeholders})`)
      .run(...ids);

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

  function updateStore(name, siteId) {
    const database = requireDb();
    const oldName = currentStoreName;
    const meta = ensureStoreMeta(database, oldName);
    const newName = sanitizeStoreName(name);
    const newSiteId = normalizeSiteId(siteId);

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

    upsertStoreMeta(database, newName, newSiteId);

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
      batchCount: getBatchCount(),
    };
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
      throw new Error(
        `Invoice ${invoiceNumber} was already uploaded on ${formatProcessedAt(existing.processed_at)}.`
      );
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

    const reconciliation = reconcileStore();

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
      database.prepare(`DELETE FROM reconciliation_runs WHERE invoice_id = ?`).run(id);
      database.prepare(`DELETE FROM invoice_lines WHERE invoice_id = ?`).run(id);
      database.prepare(`DELETE FROM invoices WHERE id = ?`).run(id);
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
                match_status, invoice_line_id, invoice_amount, last_reconciled_at
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
                l.match_status, l.batch_id, i.invoice_number
         FROM invoice_lines l
         JOIN invoices i ON i.id = l.invoice_id
         ORDER BY l.inv_date, l.invoice_line_id`
      )
      .all();
  }

  function reconcileStore() {
    const database = requireDb();
    return runStoreReconciliation(database, {
      getBatches,
      getAllInvoiceLines,
      getInvoices,
    });
  }

  function getStoreReconciliation() {
    const batches = getBatches();
    const lines = getAllInvoiceLines();
    const invoices = getInvoices();

    if (batches.length === 0 && lines.length === 0) {
      return null;
    }

    const hasReconciled = batches.some((batch) => batch.last_reconciled_at);
    if (!hasReconciled) {
      return null;
    }

    const batchById = new Map(batches.map((batch) => [batch.id, batch]));
    const invoiceTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.invoice_total), 0);
    const runAt = batches.reduce((latest, batch) => {
      if (!batch.last_reconciled_at) return latest;
      if (!latest || batch.last_reconciled_at > latest) return batch.last_reconciled_at;
      return latest;
    }, null);

    const matched = lines
      .filter((line) => line.match_status === "matched" && line.batch_id)
      .map((line) => {
        const batch = batchById.get(line.batch_id);
        if (!batch) return null;
        return {
          batchId: batch.id,
          batchDate: batch.batch_date,
          batchNumber: batch.batch_number,
          grossAmount: batch.gross_amount,
          totalFee: batch.total_fee,
          netAmount: batch.net_amount,
          invoiceLineId: line.invoice_line_id,
          invoiceNumber: line.invoice_number,
          invoiceAmount: Math.abs(Number(line.amount)),
          invDate: line.inv_date,
        };
      })
      .filter(Boolean);

    const missingBatches = batches.filter((batch) => batch.match_status === "missing_from_invoice");
    const totalMissingCredit = missingBatches.reduce((sum, batch) => sum + Number(batch.net_amount), 0);
    const matchedCount = matched.length;
    const totalDeposit = matched.reduce((sum, row) => sum + Number(row.grossAmount), 0);
    const totalFee = matched.reduce((sum, row) => sum + Number(row.totalFee), 0);
    const totalCredit = matched.reduce((sum, row) => sum + Number(row.netAmount), 0);
    const unmatchedLineCount = lines.filter((line) => line.match_status === "unmatched").length;
    const ambiguousLineCount = lines.filter((line) => line.match_status === "ambiguous").length;
    const mismatchCount = lines.filter((line) => line.match_status === "mismatch").length;

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
      } else if (line.match_status === "mismatch" && line.batch_id) {
        const batch = batchById.get(line.batch_id);
        exceptions.push({
          type: "mismatch",
          batchId: line.batch_id,
          batchDate: batch ? batch.batch_date : null,
          batchNumber: line.batch_number,
          netAmount: batch ? batch.net_amount : null,
          invoiceLineId: line.invoice_line_id,
          invoiceAmount: line.amount,
          message: batch
            ? `Batch number matches but amounts differ (invoice ${Math.abs(Number(line.amount))} vs batch ${batch.net_amount}).`
            : "Batch number matches but amounts differ.",
        });
      }
    }

    return {
      runAt,
      invoiceCount: invoices.length,
      summary: {
        scopedBatchCount: batches.length,
        lineCount: lines.length,
        matchedCount,
        missingFromInvoiceCount: missingBatches.length,
        unmatchedLineCount,
        ambiguousLineCount,
        mismatchCount,
        totalDeposit: Math.round(totalDeposit * 100) / 100,
        totalFee: Math.round(totalFee * 100) / 100,
        totalCredit: Math.round(totalCredit * 100) / 100,
        invoiceTotal: Math.round(invoiceTotal * 100) / 100,
        creditDiscrepancy: Math.round((invoiceTotal - totalCredit) * 100) / 100,
        totalMissingCredit: Math.round(totalMissingCredit * 100) / 100,
      },
      matched,
      exceptions,
    };
  }

  function getReconciliationScope() {
    const batches = getBatches();
    const lines = getAllInvoiceLines();
    const invoices = getInvoices();

    return {
      batches,
      lines,
      invoiceCount: invoices.length,
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
    getStoreInfo,
    updateStore,
    insertBatches,
    insertInvoice,
    getInvoices,
    getInvoiceLines,
    getAllInvoiceLines,
    deleteInvoice,
    getInvoiceForReconcile,
    getBatchesInPeriod,
    getReconciliationScope,
    reconcileStore,
    getStoreReconciliation,
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
