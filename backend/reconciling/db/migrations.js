const fs = require("fs");
const path = require("path");

const CURRENT_VERSION = 6;

function getSchemaSql() {
  return fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
}

function getSchemaVersion(db) {
  try {
    const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
    return row ? row.version : 0;
  } catch {
    return 0;
  }
}

function setSchemaVersion(db, version) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM schema_version").get().c;
  if (count === 0) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(version);
  } else {
    db.prepare("UPDATE schema_version SET version = ?").run(version);
  }
}

function migrateToV1(db) {
  db.exec(getSchemaSql());
  setSchemaVersion(db, 1);
}

function migrateToV2(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  setSchemaVersion(db, 2);
}

function migrateToV3(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      invoice_total REAL NOT NULL,
      pdf_filename TEXT,
      processed_at TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT
    );

    INSERT INTO invoices_new (id, invoice_number, invoice_total, pdf_filename, processed_at, period_start, period_end)
    SELECT id, invoice_number, invoice_total, pdf_filename, processed_at, period_start, period_end
    FROM invoices;

    DROP TABLE invoices;
    ALTER TABLE invoices_new RENAME TO invoices;
  `);
  setSchemaVersion(db, 3);
}

function migrateToV4(db) {
  const columns = db.prepare("PRAGMA table_info(invoices)").all();
  const hasBalance = columns.some((column) => column.name === "invoice_balance");
  if (!hasBalance) {
    db.exec(`ALTER TABLE invoices ADD COLUMN invoice_balance REAL;`);
  }
  setSchemaVersion(db, 4);
}

function migrateToV5(db) {
  const batchColumns = db.prepare("PRAGMA table_info(batches)").all();
  const lineColumns = db.prepare("PRAGMA table_info(invoice_lines)").all();
  const runColumns = db.prepare("PRAGMA table_info(reconciliation_runs)").all();

  const hasBatchRunId = batchColumns.some((column) => column.name === "reconciliation_run_id");
  const hasLineRunId = lineColumns.some((column) => column.name === "reconciliation_run_id");
  const hasInvoiceIdOnRuns = runColumns.some((column) => column.name === "invoice_id");

  if (hasInvoiceIdOnRuns || runColumns.length === 0) {
    db.exec(`
      DROP TABLE IF EXISTS reconciliation_runs;
      CREATE TABLE reconciliation_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_at TEXT NOT NULL,
        matched_count INTEGER NOT NULL,
        missing_from_invoice_count INTEGER NOT NULL DEFAULT 0,
        unmatched_line_count INTEGER NOT NULL DEFAULT 0,
        mismatch_count INTEGER NOT NULL DEFAULT 0,
        reversed_count INTEGER NOT NULL DEFAULT 0,
        over_credited_count INTEGER NOT NULL DEFAULT 0,
        total_deposit REAL NOT NULL,
        total_fee REAL NOT NULL,
        total_credit REAL NOT NULL,
        credit_discrepancy REAL NOT NULL DEFAULT 0
      );
    `);
  }

  if (!hasBatchRunId) {
    db.exec(
      `ALTER TABLE batches ADD COLUMN reconciliation_run_id INTEGER REFERENCES reconciliation_runs (id);`
    );
  }

  if (!hasLineRunId) {
    db.exec(
      `ALTER TABLE invoice_lines ADD COLUMN reconciliation_run_id INTEGER REFERENCES reconciliation_runs (id);`
    );
  }

  setSchemaVersion(db, 5);
}

function migrateToV6(db) {
  const columns = db.prepare("PRAGMA table_info(store_meta)").all();
  const hasBatchTemplate = columns.some((column) => column.name === "batch_template");
  const hasEftTemplate = columns.some((column) => column.name === "eft_template");

  if (!hasBatchTemplate) {
    db.exec(
      `ALTER TABLE store_meta ADD COLUMN batch_template TEXT NOT NULL DEFAULT 'chevron';`
    );
  }
  if (!hasEftTemplate) {
    db.exec(
      `ALTER TABLE store_meta ADD COLUMN eft_template TEXT NOT NULL DEFAULT 'jenkins_eft';`
    );
  }

  db.exec(`
    UPDATE store_meta
    SET batch_template = COALESCE(NULLIF(TRIM(batch_template), ''), 'chevron'),
        eft_template = COALESCE(NULLIF(TRIM(eft_template), ''), 'jenkins_eft');
  `);

  setSchemaVersion(db, 6);
}

function migrate(db) {
  let version = getSchemaVersion(db);

  if (version < 1) {
    migrateToV1(db);
    version = 1;
  }

  if (version < 2) {
    migrateToV2(db);
    version = 2;
  }

  if (version < 3) {
    migrateToV3(db);
    version = 3;
  }

  if (version < 4) {
    migrateToV4(db);
    version = 4;
  }

  if (version < 5) {
    migrateToV5(db);
    version = 5;
  }

  if (version < 6) {
    migrateToV6(db);
  }
}

module.exports = { migrate, CURRENT_VERSION };
