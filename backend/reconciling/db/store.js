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
    const filePath = dbPath(name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Store "${name}" does not exist.`);
    }
    db = new Database(filePath);
    migrate(db);
    currentStoreName = sanitizeStoreName(name);
    return db;
  }

  function listStores() {
    return fs
      .readdirSync(storesDir)
      .filter((file) => file.endsWith(".db"))
      .map((file) => path.basename(file, ".db"))
      .sort((a, b) => a.localeCompare(b));
  }

  function createStore(name) {
    const storeName = sanitizeStoreName(name);
    const filePath = dbPath(storeName);
    if (fs.existsSync(filePath)) {
      throw new Error(`Store "${storeName}" already exists.`);
    }
    const newDb = new Database(filePath);
    migrate(newDb);
    newDb.close();
    return { name: storeName };
  }

  function openStore(name) {
    openDatabase(name);
    return {
      name: currentStoreName,
      batchCount: getBatchCount(),
    };
  }

  function requireDb() {
    if (!db) {
      throw new Error("No store is open. Select or create a store first.");
    }
    return db;
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

  return {
    listStores,
    createStore,
    openStore,
    close,
    getBatches,
    getBatchCount,
    insertBatches,
    getCurrentStoreName: () => currentStoreName,
  };
}

module.exports = { createStoreManager, sanitizeStoreName };
