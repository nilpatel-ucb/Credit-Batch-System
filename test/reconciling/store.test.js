const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { createStoreManager } = require("../../backend/reconciling/db/store");

function makeTempStoresDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cbr-store-test-"));
}

function testCreateInsertAndCount() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");

  const records = [
    {
      site_id: "309359",
      batch_date: "2026-03-31",
      batch_number: "0341",
      gross_amount: 2643.8,
      total_fee: 65.44,
      net_amount: 2578.36,
    },
    {
      site_id: "309359",
      batch_date: "2026-03-31",
      batch_number: "0857",
      gross_amount: 2781.16,
      total_fee: 68.62,
      net_amount: 2712.54,
    },
  ];

  const result = manager.insertBatches(records, "test.pdf");
  assert.strictEqual(result.added, 2);
  assert.strictEqual(result.skipped, 0);
  assert.strictEqual(manager.getBatchCount(), 2);

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testDedupeOnInsert() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Mako", "30935");
  manager.openStore("Mako");

  const record = {
    site_id: "30935",
    batch_date: "2026-03-31",
    batch_number: "0857",
    gross_amount: 2781.16,
    total_fee: 68.62,
    net_amount: 2712.54,
  };

  const first = manager.insertBatches([record], "a.pdf");
  assert.strictEqual(first.added, 1);
  assert.strictEqual(first.skipped, 0);

  const second = manager.insertBatches([record], "b.pdf");
  assert.strictEqual(second.added, 0);
  assert.strictEqual(second.skipped, 1);
  assert.strictEqual(manager.getBatchCount(), 1);

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testPersistenceAfterReopen() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");
  manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-31",
        batch_number: "0341",
        gross_amount: 2643.8,
        total_fee: 65.44,
        net_amount: 2578.36,
      },
    ],
    "persist.pdf"
  );
  manager.close();

  const manager2 = createStoreManager(dir);
  const opened = manager2.openStore("Sunset");
  const batches = manager2.getBatches();

  assert.strictEqual(opened.site_id, "309359");
  assert.strictEqual(batches.length, 1);
  assert.strictEqual(batches[0].batch_number, "0341");
  assert.strictEqual(batches[0].source_pdf, "persist.pdf");

  manager2.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testListStores() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Alpha", "111111");
  manager.createStore("Beta", "222222");

  const stores = manager.listStores();
  assert.deepStrictEqual(stores, [
    {
      name: "Alpha",
      site_id: "111111",
      batch_template: "chevron",
      eft_template: "jenkins_eft",
    },
    {
      name: "Beta",
      site_id: "222222",
      batch_template: "chevron",
      eft_template: "jenkins_eft",
    },
  ]);

  fs.rmSync(dir, { recursive: true, force: true });
}

function testRejectMismatchedSiteId() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");

  assert.throws(
    () =>
      manager.insertBatches(
        [
          {
            site_id: "30935",
            batch_date: "2026-03-31",
            batch_number: "0341",
            gross_amount: 2643.8,
            total_fee: 65.44,
            net_amount: 2578.36,
          },
        ],
        "wrong-site.pdf"
      ),
    /does not match this store's site ID/
  );

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testRejectDuplicateSiteIdAcrossStores() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  assert.throws(() => manager.createStore("Sunset 2", "309359"), /already linked/);

  fs.rmSync(dir, { recursive: true, force: true });
}

function testSchemaCreated() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);
  manager.createStore("Test", "309359");
  manager.close();

  const db = new Database(path.join(dir, "Test.db"));
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name);

  assert.ok(tables.includes("batches"));
  assert.ok(tables.includes("store_meta"));
  assert.ok(tables.includes("invoices"));
  assert.ok(tables.includes("invoice_lines"));
  assert.ok(tables.includes("reconciliation_runs"));
  assert.ok(tables.includes("schema_version"));

  const meta = db
    .prepare("SELECT site_id, name, batch_template, eft_template FROM store_meta WHERE id = 1")
    .get();
  assert.strictEqual(meta.site_id, "309359");
  assert.strictEqual(meta.name, "Test");
  assert.strictEqual(meta.batch_template, "chevron");
  assert.strictEqual(meta.eft_template, "jenkins_eft");

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testUpdateStoreNameAndSiteId() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");

  const updated = manager.updateStore("Sunset Plaza", "309359");
  assert.strictEqual(updated.name, "Sunset Plaza");
  assert.strictEqual(updated.site_id, "309359");
  assert.ok(fs.existsSync(path.join(dir, "Sunset Plaza.db")));
  assert.ok(!fs.existsSync(path.join(dir, "Sunset.db")));

  manager.close();

  const manager2 = createStoreManager(dir);
  const stores = manager2.listStores();
  assert.deepStrictEqual(stores, [
    {
      name: "Sunset Plaza",
      site_id: "309359",
      batch_template: "chevron",
      eft_template: "jenkins_eft",
    },
  ]);

  manager2.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testStoreTemplatesDefaultAndUpdate() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  const created = manager.createStore("Sunset", "309359");
  assert.strictEqual(created.batch_template, "chevron");
  assert.strictEqual(created.eft_template, "jenkins_eft");

  const opened = manager.openStore("Sunset");
  assert.strictEqual(opened.batch_template, "chevron");
  assert.strictEqual(opened.eft_template, "jenkins_eft");

  const updated = manager.updateStore("Sunset", "309359", "chevron", "jenkins_eft");
  assert.strictEqual(updated.batch_template, "chevron");
  assert.strictEqual(updated.eft_template, "jenkins_eft");

  assert.throws(
    () => manager.updateStore("Sunset", "309359", "unknown_batch", "jenkins_eft"),
    /Unknown credit batch template/
  );

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testDeleteStore() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.createStore("Mako", "222222");
  manager.openStore("Sunset");

  const result = manager.deleteStore("Sunset");
  assert.strictEqual(result.deleted, "Sunset");
  assert.ok(!fs.existsSync(path.join(dir, "Sunset.db")));
  assert.strictEqual(manager.getCurrentStoreName(), null);

  const stores = manager.listStores();
  assert.deepStrictEqual(stores, [
    {
      name: "Mako",
      site_id: "222222",
      batch_template: "chevron",
      eft_template: "jenkins_eft",
    },
  ]);

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testRejectSiteIdChangeWhenBatchesExist() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");
  manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-31",
        batch_number: "0341",
        gross_amount: 2643.8,
        total_fee: 65.44,
        net_amount: 2578.36,
      },
    ],
    "test.pdf"
  );

  assert.throws(
    () => manager.updateStore("Sunset", "30935"),
    /Cannot change site ID while this store has batches/
  );

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function sampleInvoicePayload() {
  return {
    summary: { invoiceNumber: "0600658", amount: 35381.95, balance: -4267.8 },
    batchLines: [
      {
        invoiceId: "AAE0319",
        batchNumber: "0319",
        amount: -2817.73,
        invDate: "2026-03-30",
      },
      {
        invoiceId: "AAU9086",
        batchNumber: "9086",
        amount: -1500,
        invDate: "2026-03-29",
      },
    ],
  };
}

function testInsertInvoicePersistsHeaderAndLines() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");

  const { summary, batchLines } = sampleInvoicePayload();
  const result = manager.insertInvoice(summary, batchLines, "eft.pdf");

  assert.ok(result.invoiceId > 0);
  assert.strictEqual(result.lineCount, 2);
  assert.strictEqual(result.periodStart, "2026-03-29");
  assert.strictEqual(result.periodEnd, "2026-03-30");

  const invoices = manager.getInvoices();
  assert.strictEqual(invoices.length, 1);
  assert.strictEqual(invoices[0].invoice_number, "0600658");
  assert.strictEqual(invoices[0].invoice_total, 35381.95);
  assert.strictEqual(invoices[0].invoice_balance, -4267.8);
  assert.strictEqual(invoices[0].line_count, 2);
  assert.strictEqual(invoices[0].period_start, "2026-03-29");
  assert.strictEqual(invoices[0].period_end, "2026-03-30");

  const lines = manager.getInvoiceLines(result.invoiceId);
  assert.strictEqual(lines.length, 2);
  assert.ok(lines.every((line) => line.match_status === "unmatched"));
  const byId = Object.fromEntries(lines.map((line) => [line.invoice_line_id, line]));
  assert.strictEqual(byId.AAE0319.batch_number, "0319");
  assert.strictEqual(byId.AAU9086.batch_number, "9086");

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testRejectDuplicateInvoiceNumber() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");

  const { summary, batchLines } = sampleInvoicePayload();
  manager.insertInvoice(summary, batchLines, "eft-a.pdf");

  const duplicate = manager.insertInvoice(summary, batchLines, "eft-b.pdf");
  assert.strictEqual(duplicate.skipped, true);
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(duplicate.invoiceNumber, summary.invoiceNumber);

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testDeleteBatchRemovesRow() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");
  manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-31",
        batch_number: "0341",
        gross_amount: 2643.8,
        total_fee: 65.44,
        net_amount: 2578.36,
      },
      {
        site_id: "309359",
        batch_date: "2026-03-31",
        batch_number: "0857",
        gross_amount: 2781.16,
        total_fee: 68.62,
        net_amount: 2712.54,
      },
    ],
    "test.pdf"
  );

  const batches = manager.getBatches();
  const result = manager.deleteBatch(batches[0].id);

  assert.strictEqual(result.batchCount, 1);
  assert.strictEqual(manager.getBatches().length, 1);
  assert.strictEqual(manager.getBatches()[0].batch_number, "0857");

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testDeleteMatchedBatchClearsInvoiceLineLink() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");
  manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-30",
        batch_number: "0319",
        gross_amount: 2900,
        total_fee: 82.27,
        net_amount: 2817.73,
      },
    ],
    "chevron.pdf"
  );

  const { summary, batchLines } = sampleInvoicePayload();
  const insertResult = manager.insertInvoice(summary, batchLines, "eft.pdf");
  const matchedBatch = manager.getBatches().find((batch) => batch.batch_number === "0319");
  assert.ok(matchedBatch);
  assert.strictEqual(matchedBatch.match_status, "matched");

  manager.deleteBatch(matchedBatch.id);

  const lines = manager.getInvoiceLines(insertResult.invoiceId);
  const line = lines.find((entry) => entry.invoice_line_id === "AAE0319");
  assert.ok(line);
  assert.strictEqual(line.match_status, "unmatched");
  assert.strictEqual(line.batch_id, null);
  assert.strictEqual(manager.getBatchCount(), 0);

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testDeleteBatchSourceRemovesEntireUpload() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");
  manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-31",
        batch_number: "0341",
        gross_amount: 2643.8,
        total_fee: 65.44,
        net_amount: 2578.36,
      },
      {
        site_id: "309359",
        batch_date: "2026-03-31",
        batch_number: "0857",
        gross_amount: 2781.16,
        total_fee: 68.62,
        net_amount: 2712.54,
      },
    ],
    "upload-a.pdf"
  );
  manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-04-01",
        batch_number: "0100",
        gross_amount: 1000,
        total_fee: 10,
        net_amount: 990,
      },
    ],
    "upload-b.pdf"
  );

  const uploadA = manager.getBatches().find((batch) => batch.source_pdf === "upload-a.pdf");
  assert.ok(uploadA);

  const result = manager.deleteBatchSource("upload-a.pdf", uploadA.ingested_at);
  assert.strictEqual(result.deletedCount, 2);
  assert.strictEqual(manager.getBatchCount(), 1);
  assert.strictEqual(manager.getBatches()[0].source_pdf, "upload-b.pdf");

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testDeleteInvoiceRemovesHeaderLinesAndResetsLinkedBatches() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");
  manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-30",
        batch_number: "0319",
        gross_amount: 2900,
        total_fee: 82.27,
        net_amount: 2817.73,
      },
    ],
    "chevron.pdf"
  );

  const { summary, batchLines } = sampleInvoicePayload();
  const insertResult = manager.insertInvoice(summary, batchLines, "eft.pdf");
  const batch = manager.getBatches().find((row) => row.batch_number === "0319");
  assert.strictEqual(batch.match_status, "matched");

  const deleted = manager.deleteInvoice(insertResult.invoiceId);
  assert.strictEqual(deleted.invoiceNumber, "0600658");
  assert.strictEqual(deleted.lineCount, 2);
  assert.strictEqual(deleted.invoiceCount, 0);
  assert.strictEqual(manager.getInvoices().length, 0);

  const resetBatch = manager.getBatches()[0];
  assert.strictEqual(resetBatch.match_status, "unmatched");
  assert.strictEqual(resetBatch.invoice_line_id, null);

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testDeleteInvoiceLineRemovesLineAndUnlinksBatch() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");
  manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-30",
        batch_number: "0319",
        gross_amount: 2900,
        total_fee: 82.27,
        net_amount: 2817.73,
      },
    ],
    "chevron.pdf"
  );

  const { summary, batchLines } = sampleInvoicePayload();
  const insertResult = manager.insertInvoice(summary, batchLines, "eft.pdf");
  const matchedBatch = manager.getBatches().find((batch) => batch.batch_number === "0319");
  assert.strictEqual(matchedBatch.match_status, "matched");

  const lines = manager.getInvoiceLines(insertResult.invoiceId);
  const matchedLine = lines.find((line) => line.invoice_line_id === "AAE0319");
  assert.ok(matchedLine);

  const deleted = manager.deleteInvoiceLine(matchedLine.id);
  assert.strictEqual(deleted.invoiceLineId, "AAE0319");
  assert.strictEqual(deleted.invoiceDeleted, false);
  assert.strictEqual(deleted.invoiceCount, 1);

  const remaining = manager.getInvoiceLines(insertResult.invoiceId);
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].invoice_line_id, "AAU9086");

  const invoice = manager.getInvoices()[0];
  assert.strictEqual(invoice.invoice_total, -1500);

  const resetBatch = manager.getBatches()[0];
  assert.strictEqual(resetBatch.match_status, "missing_from_invoice");
  assert.strictEqual(resetBatch.invoice_line_id, null);

  const lastLine = manager.deleteInvoiceLine(remaining[0].id);
  assert.strictEqual(lastLine.invoiceDeleted, true);
  assert.strictEqual(lastLine.invoiceCount, 0);
  assert.strictEqual(manager.getInvoices().length, 0);
  assert.strictEqual(manager.getBatches()[0].match_status, "unmatched");

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testBatchIngestAfterInvoiceAutoReconciles() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");

  // Invoice uploaded first: its lines start out unmatched.
  const { summary, batchLines } = sampleInvoicePayload();
  const insertResult = manager.insertInvoice(summary, batchLines, "eft.pdf");
  let lines = manager.getInvoiceLines(insertResult.invoiceId);
  assert.ok(lines.every((line) => line.match_status === "unmatched"));

  // Uploading the matching Chevron batch afterwards must re-reconcile.
  const batchResult = manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-30",
        batch_number: "0319",
        gross_amount: 2900,
        total_fee: 82.27,
        net_amount: 2817.73,
      },
    ],
    "chevron.pdf"
  );

  assert.ok(batchResult.reconciliation);
  assert.strictEqual(batchResult.reconciliation.summary.matchedCount, 1);

  const batch = manager.getBatches().find((row) => row.batch_number === "0319");
  assert.strictEqual(batch.match_status, "matched");

  lines = manager.getInvoiceLines(insertResult.invoiceId);
  const line = lines.find((entry) => entry.invoice_line_id === "AAE0319");
  assert.strictEqual(line.match_status, "matched");
  assert.strictEqual(line.batch_id, batch.id);

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testBatchIngestWithoutInvoicesLeavesBatchesUnmatched() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");

  const result = manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-31",
        batch_number: "0341",
        gross_amount: 2643.8,
        total_fee: 65.44,
        net_amount: 2578.36,
      },
    ],
    "chevron.pdf"
  );

  assert.strictEqual(result.reconciliation, null);
  assert.strictEqual(manager.getBatches()[0].match_status, "unmatched");

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testTotalMissingCreditCountsOnlyMissingFromInvoice() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");

  manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-30",
        batch_number: "0319",
        gross_amount: 2900,
        total_fee: 82.27,
        net_amount: 2817.73,
      },
      {
        site_id: "309359",
        batch_date: "2026-03-31",
        batch_number: "0341",
        gross_amount: 2643.8,
        total_fee: 65.44,
        net_amount: 2578.36,
      },
    ],
    "chevron.pdf"
  );

  const { summary, batchLines } = sampleInvoicePayload();
  batchLines[0] = {
    ...batchLines[0],
    amount: -2700,
  };

  manager.insertInvoice(summary, batchLines, "eft.pdf");

  const reconciliation = manager.getStoreReconciliation();
  // Missing batch 0341 (2578.36) + mismatch shortfall on 0319 (2817.73 - 2700 = 117.73)
  assert.strictEqual(reconciliation.summary.totalMissingCredit, 2696.09);
  assert.strictEqual(reconciliation.summary.missingFromInvoiceCount, 1);
  assert.strictEqual(reconciliation.summary.mismatchCount, 1);

  const byNumber = Object.fromEntries(
    manager.getBatches().map((batch) => [batch.batch_number, batch])
  );
  assert.strictEqual(byNumber["0319"].match_status, "mismatch");
  assert.strictEqual(byNumber["0341"].match_status, "missing_from_invoice");

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testMismatchShortfallOnlyInTotalMissingCredit() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");

  manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-28",
        batch_number: "9147",
        gross_amount: 110,
        total_fee: 4.75,
        net_amount: 105.25,
      },
      {
        site_id: "309359",
        batch_date: "2026-03-29",
        batch_number: "9147",
        gross_amount: 230,
        total_fee: 8.86,
        net_amount: 221.14,
      },
    ],
    "chevron.pdf"
  );

  manager.insertInvoice(
    { invoiceNumber: "0600914", amount: 105.25, balance: 0 },
    [
      {
        invoiceId: "AA9147",
        batchNumber: "9147",
        amount: -105.25,
        invDate: "2026-03-30",
      },
    ],
    "eft.pdf"
  );

  const batches = manager.getBatches();
  assert.strictEqual(batches.length, 2);
  const byNet = Object.fromEntries(batches.map((batch) => [String(batch.net_amount), batch]));
  assert.strictEqual(byNet["105.25"].match_status, "matched");
  assert.strictEqual(byNet["221.14"].match_status, "missing_from_invoice");

  const reconciliation = manager.getStoreReconciliation();
  assert.strictEqual(reconciliation.summary.matchedCount, 1);
  assert.strictEqual(reconciliation.summary.mismatchCount, 0);
  assert.strictEqual(reconciliation.summary.missingFromInvoiceCount, 1);
  assert.strictEqual(reconciliation.summary.totalMissingCredit, 221.14);

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testDeleteInvoiceClearsMissingFromInvoiceFlags() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");

  // Batch that matches no invoice line — reconciliation flags it missing.
  manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-31",
        batch_number: "0341",
        gross_amount: 2643.8,
        total_fee: 65.44,
        net_amount: 2578.36,
      },
    ],
    "chevron.pdf"
  );

  const { summary, batchLines } = sampleInvoicePayload();
  const insertResult = manager.insertInvoice(summary, batchLines, "eft.pdf");

  let batch = manager.getBatches()[0];
  assert.strictEqual(batch.match_status, "missing_from_invoice");

  manager.deleteInvoice(insertResult.invoiceId);

  batch = manager.getBatches()[0];
  assert.strictEqual(batch.match_status, "unmatched");
  assert.strictEqual(batch.last_reconciled_at, null);
  assert.strictEqual(manager.getStoreReconciliation(), null);

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testExpectedOnNextInvoiceExcludedUntilNewEft() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Sunset", "309359");
  manager.openStore("Sunset");

  manager.insertBatches(
    [
      {
        site_id: "309359",
        batch_date: "2026-03-31",
        batch_number: "0341",
        gross_amount: 2643.8,
        total_fee: 65.44,
        net_amount: 2578.36,
      },
      {
        site_id: "309359",
        batch_date: "2026-04-01",
        batch_number: "0999",
        gross_amount: 1100,
        total_fee: 20,
        net_amount: 1080,
      },
    ],
    "chevron.pdf"
  );

  const { summary, batchLines } = sampleInvoicePayload();
  manager.insertInvoice(summary, batchLines, "eft-1.pdf");

  const byNumber = Object.fromEntries(
    manager.getBatches().map((batch) => [batch.batch_number, batch])
  );
  assert.strictEqual(byNumber["0341"].match_status, "missing_from_invoice");
  assert.strictEqual(byNumber["0999"].match_status, "missing_from_invoice");

  manager.setBatchExpectedOnNextInvoice(byNumber["0999"].id, true);

  let expected = manager.getBatches().find((batch) => batch.batch_number === "0999");
  assert.strictEqual(expected.match_status, "expected_on_next_invoice");

  const working = manager.getStoreReconciliation();
  assert.strictEqual(working.summary.totalMissingCredit, 2578.36);
  assert.strictEqual(working.summary.missingFromInvoiceCount, 1);
  assert.ok(
    working.exceptions.some(
      (row) => row.type === "expected_on_next_invoice" && row.batchNumber === "0999"
    )
  );

  // Manual re-reconcile must preserve the tag and keep it out of missing credit.
  const manual = manager.reconcileStore();
  assert.strictEqual(manual.summary.totalMissingCredit, 2578.36);
  expected = manager.getBatches().find((batch) => batch.batch_number === "0999");
  assert.strictEqual(expected.match_status, "expected_on_next_invoice");

  // New EFT with no line for 0999 promotes expected → missing.
  manager.insertInvoice(
    { invoiceNumber: "0600999", amount: 1500, balance: 0 },
    [
      {
        invoiceId: "AAE9086",
        batchNumber: "9086",
        amount: -1500,
        invDate: "2026-04-02",
      },
    ],
    "eft-2.pdf"
  );

  expected = manager.getBatches().find((batch) => batch.batch_number === "0999");
  assert.strictEqual(expected.match_status, "missing_from_invoice");

  const afterEft = manager.getStoreReconciliation();
  assert.strictEqual(afterEft.summary.totalMissingCredit, 2578.36 + 1080);
  assert.strictEqual(afterEft.summary.missingFromInvoiceCount, 2);

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testGreenValleyUsesSeparateAggregateReconciliation() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore(
    "Green Valley",
    "123456",
    "cstore_green_valley",
    "jenkins_green_valley_eft"
  );
  manager.openStore("Green Valley");
  manager.insertBatches(
    [
      {
        site_id: "123456",
        batch_date: "2026-06-01",
        batch_number: "0602",
        gross_amount: 0,
        total_fee: 0,
        net_amount: 60000,
      },
      {
        site_id: "123456",
        batch_date: "2026-06-02",
        batch_number: "0603",
        gross_amount: 0,
        total_fee: 0,
        net_amount: 49616.19,
      },
      {
        site_id: "123456",
        batch_date: "2026-06-30",
        batch_number: "0701",
        gross_amount: 0,
        total_fee: 0,
        net_amount: 1000,
      },
    ],
    "green-valley.pdf"
  );

  const expected = manager.getBatches().find((batch) => batch.batch_number === "0701");
  manager.setBatchExpectedOnNextInvoice(expected.id, true);

  const inserted = manager.insertInvoice(
    {
      invoiceNumber: "0619631",
      amount: 58604.07,
      balance: -51012.12,
    },
    [
      {
        invoiceId: "BBB8622",
        batchNumber: "0614",
        amount: -50000,
        invDate: "2026-06-14",
      },
      {
        invoiceId: "BBB8623",
        batchNumber: "0615",
        amount: -59616.19,
        invDate: "2026-06-15",
      },
    ],
    "green-valley-eft.pdf"
  );

  assert.strictEqual(inserted.reconciliation.summary.matchedCount, 2);
  assert.strictEqual(inserted.reconciliation.summary.mismatchCount, 0);
  assert.strictEqual(inserted.reconciliation.summary.missingFromInvoiceCount, 0);
  assert.strictEqual(inserted.reconciliation.summary.invoiceTotal, 58604.07);
  assert.strictEqual(inserted.reconciliation.summary.creditDiscrepancy, 0);

  const batches = manager.getBatches();
  assert.strictEqual(
    batches.find((batch) => batch.batch_number === "0701").match_status,
    "expected_on_next_invoice"
  );
  assert.strictEqual(
    batches.filter((batch) => batch.batch_number !== "0701").every(
      (batch) => batch.match_status === "matched"
    ),
    true
  );

  const refreshed = manager.getStoreReconciliation();
  assert.strictEqual(refreshed.summary.matchedCount, 2);
  assert.strictEqual(refreshed.summary.mismatchCount, 0);

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function run() {
  testCreateInsertAndCount();
  testDedupeOnInsert();
  testPersistenceAfterReopen();
  testListStores();
  testRejectMismatchedSiteId();
  testRejectDuplicateSiteIdAcrossStores();
  testUpdateStoreNameAndSiteId();
  testStoreTemplatesDefaultAndUpdate();
  testDeleteStore();
  testRejectSiteIdChangeWhenBatchesExist();
  testSchemaCreated();
  testInsertInvoicePersistsHeaderAndLines();
  testRejectDuplicateInvoiceNumber();
  testDeleteBatchRemovesRow();
  testDeleteMatchedBatchClearsInvoiceLineLink();
  testDeleteBatchSourceRemovesEntireUpload();
  testDeleteInvoiceRemovesHeaderLinesAndResetsLinkedBatches();
  testDeleteInvoiceLineRemovesLineAndUnlinksBatch();
  testBatchIngestAfterInvoiceAutoReconciles();
  testBatchIngestWithoutInvoicesLeavesBatchesUnmatched();
  testTotalMissingCreditCountsOnlyMissingFromInvoice();
  testMismatchShortfallOnlyInTotalMissingCredit();
  testDeleteInvoiceClearsMissingFromInvoiceFlags();
  testExpectedOnNextInvoiceExcludedUntilNewEft();
  testGreenValleyUsesSeparateAggregateReconciliation();
  console.log("PASS store tests");
}

run();
