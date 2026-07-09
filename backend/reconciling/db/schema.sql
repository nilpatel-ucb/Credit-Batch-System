CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  batch_date TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  gross_amount REAL NOT NULL,
  total_fee REAL NOT NULL,
  net_amount REAL NOT NULL,
  source_pdf TEXT,
  ingested_at TEXT NOT NULL,
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  invoice_line_id TEXT,
  invoice_amount REAL,
  last_reconciled_at TEXT,
  UNIQUE (batch_date, batch_number, net_amount)
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL,
  invoice_total REAL NOT NULL,
  pdf_filename TEXT,
  processed_at TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices (id),
  invoice_line_id TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  amount REAL NOT NULL,
  inv_date TEXT NOT NULL,
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  batch_id INTEGER REFERENCES batches (id)
);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices (id),
  run_at TEXT NOT NULL,
  scoped_batch_count INTEGER NOT NULL,
  matched_count INTEGER NOT NULL,
  missing_from_invoice_count INTEGER NOT NULL,
  unmatched_line_count INTEGER NOT NULL,
  mismatch_count INTEGER NOT NULL,
  total_deposit REAL NOT NULL,
  total_fee REAL NOT NULL,
  total_credit REAL NOT NULL,
  credit_discrepancy REAL NOT NULL
);
