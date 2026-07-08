const assert = require("assert");
const Normalize = require("../js/normalize.js");
const Reconcile = require("../js/reconcile.js");

function makeBatchRecord(batchNumber, grossAmount, netAmount, fee, dateStr) {
  return {
    site_id: "71122",
    batch_date: new Date(dateStr),
    batch_number: batchNumber,
    gross_amount: grossAmount,
    total_fee: fee,
    net_amount: netAmount,
  };
}

const batchRecords = Normalize.normalizeAll([
  makeBatchRecord("0319", 2891.72, 2817.73, 73.99, "2026-03-30"),
  makeBatchRecord("09086", 150.0, 145.0, 5.0, "2026-03-30"),
  makeBatchRecord("9086", 91.13, 89.99, 1.14, "2026-03-30"),
  makeBatchRecord("9087", 57.56, 56.23, 1.33, "2026-03-30"),
  makeBatchRecord("9087", 341.58, 337.06, 4.52, "2026-03-30"),
  makeBatchRecord("0999", 500.0, 490.0, 10.0, "2026-03-30"),
]);

const invoiceResult = {
  batchLines: [
    { invoiceId: "AAE0319", batchNumber: "0319", amount: -2817.73 },
    { invoiceId: "AAU9086", batchNumber: "9086", amount: -89.99 },
    { invoiceId: "AAM9087", batchNumber: "9087", amount: -56.23 },
    { invoiceId: "AAN9087", batchNumber: "9087", amount: -337.06 },
  ],
  summary: { invoiceNumber: "0600658", amount: 35381.95 },
  warnings: [],
};

function testMatches9086ByNetAmount() {
  const result = Reconcile.reconcile(batchRecords, invoiceResult);
  const batch9086Rows = result.matchedRecords.filter(
    (record) => Reconcile.stripLeadingZeros(record.batch_number) === "9086"
  );

  assert.strictEqual(batch9086Rows.length, 1, "Expected one matched 9086 row");
  assert.strictEqual(batch9086Rows[0].net_amount, 89.99);
  assert.strictEqual(batch9086Rows[0].invoice_id, "AAU9086");
}

function testMatchesDual9087Lines() {
  const result = Reconcile.reconcile(batchRecords, invoiceResult);
  const batch9087Rows = result.matchedRecords.filter(
    (record) => Reconcile.stripLeadingZeros(record.batch_number) === "9087"
  );

  assert.strictEqual(batch9087Rows.length, 2, "Expected two matched 9087 rows");
  assert.deepStrictEqual(
    batch9087Rows.map((record) => record.net_amount).sort((a, b) => a - b),
    [56.23, 337.06]
  );
}

function testExcludesBatchesNotOnInvoice() {
  const result = Reconcile.reconcile(batchRecords, invoiceResult);
  const batchNumbers = result.matchedRecords.map((record) =>
    Reconcile.stripLeadingZeros(record.batch_number)
  );

  assert.ok(!batchNumbers.includes("999"), "Batch 999 should be excluded");
  assert.strictEqual(result.matchedRecords.length, 4);
}

function testSummaryTotalsUseFilteredRowsOnly() {
  const result = Reconcile.reconcile(batchRecords, invoiceResult);

  assert.strictEqual(result.summary.invoiceNumber, "0600658");
  assert.strictEqual(result.summary.invoiceAmount, 35381.95);
  assert.strictEqual(result.summary.totalDeposit, 3381.99);
  assert.strictEqual(result.summary.totalFee, 80.98);
  assert.strictEqual(result.summary.totalCredit, 3301.01);
  assert.strictEqual(result.summary.credit, 32080.94);
}

function testExportRowsIncludeInvoiceAmount() {
  const result = Reconcile.reconcile(batchRecords, invoiceResult);
  const row9086 = result.exportRows.find((row) => row.batchNumber === "9086");

  assert.ok(row9086, "Expected export row for batch 9086");
  assert.strictEqual(row9086.invoiceAmount, 89.99);
}

function run() {
  testMatches9086ByNetAmount();
  testMatchesDual9087Lines();
  testExcludesBatchesNotOnInvoice();
  testSummaryTotalsUseFilteredRowsOnly();
  testExportRowsIncludeInvoiceAmount();
  console.log("PASS reconcile tests");
}

run();
