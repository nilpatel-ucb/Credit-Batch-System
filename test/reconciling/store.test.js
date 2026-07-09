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

  manager.createStore("Sunset");
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

  manager.createStore("Mako");
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

  manager.createStore("Sunset");
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
  manager2.openStore("Sunset");
  const batches = manager2.getBatches();

  assert.strictEqual(batches.length, 1);
  assert.strictEqual(batches[0].batch_number, "0341");
  assert.strictEqual(batches[0].source_pdf, "persist.pdf");

  manager2.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testListStores() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);

  manager.createStore("Alpha");
  manager.createStore("Beta");

  const stores = manager.listStores();
  assert.deepStrictEqual(stores, ["Alpha", "Beta"]);

  fs.rmSync(dir, { recursive: true, force: true });
}

function testSchemaCreated() {
  const dir = makeTempStoresDir();
  const manager = createStoreManager(dir);
  manager.createStore("Test");
  manager.close();

  const db = new Database(path.join(dir, "Test.db"));
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name);

  assert.ok(tables.includes("batches"));
  assert.ok(tables.includes("invoices"));
  assert.ok(tables.includes("invoice_lines"));
  assert.ok(tables.includes("reconciliation_runs"));
  assert.ok(tables.includes("schema_version"));

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function run() {
  testCreateInsertAndCount();
  testDedupeOnInsert();
  testPersistenceAfterReopen();
  testListStores();
  testSchemaCreated();
  console.log("PASS store tests");
}

run();
