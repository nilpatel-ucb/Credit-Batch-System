const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { migrate } = require("./migrations");
const Normalize = require("../../parsing/normalize");

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

  function getBatches() {
    return requireDb()
      .prepare(
        `SELECT id, site_id, batch_date, batch_number, gross_amount, total_fee,
                net_amount, source_pdf, ingested_at, match_status
         FROM batches
         ORDER BY batch_date, batch_number`
      )
      .all();
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
    return { added, skipped };
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
      throw new Error("Invoice has no AA batch lines to save.");
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

    return {
      invoiceId,
      lineCount: normalizedLines.length,
      periodStart,
      periodEnd,
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
        `SELECT id, invoice_line_id, batch_number, amount, inv_date, match_status
         FROM invoice_lines
         WHERE invoice_id = ?
         ORDER BY inv_date, invoice_line_id`
      )
      .all(invoiceId);
  }

  return {
    listStores,
    createStore,
    openStore,
    close,
    getBatches,
    getBatchCount,
    getStoreInfo,
    updateStore,
    insertBatches,
    insertInvoice,
    getInvoices,
    getInvoiceLines,
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
