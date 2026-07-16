const assert = require("assert");
const {
  reconcileGreenValley,
} = require("../../backend/reconciling/reconcile-green-valley");

function batch(id, netAmount, matchStatus = "unmatched") {
  return {
    id,
    batch_date: "2026-06-01",
    batch_number: String(id).padStart(4, "0"),
    gross_amount: 0,
    total_fee: 0,
    net_amount: netAmount,
    match_status: matchStatus,
  };
}

function testAggregateControlMatches() {
  const eligibleBatches = [batch(1, 60000), batch(2, 49616.19)];
  const expectedBatches = [batch(3, 1234.56, "expected_on_next_invoice")];
  // Letter-prefixed EFT lines total -109616.19 (absolute 109616.19).
  const lines = [
    {
      id: 10,
      invoice_line_id: "BBB8622",
      batch_number: "0614",
      amount: -50000,
      inv_date: "2026-06-14",
    },
    {
      id: 11,
      invoice_line_id: "BBB8623",
      batch_number: "0614",
      amount: -59616.19,
      inv_date: "2026-06-14",
    },
  ];

  const result = reconcileGreenValley({
    invoiceTotal: 58604.07,
    invoiceBalance: -51012.12,
    lines,
    scopedBatches: eligibleBatches,
    expectedBatches,
  });

  assert.strictEqual(result.aggregate.letterPrefixedTotal, 109616.19);
  assert.strictEqual(result.aggregate.numericInvoiceTotal, 58604.07);
  assert.strictEqual(result.aggregate.calculatedControl, 51012.12);
  assert.strictEqual(result.aggregate.footerControl, 51012.12);
  assert.strictEqual(result.aggregate.matched, true);
  assert.strictEqual(result.summary.matchedCount, 2);
  assert.strictEqual(result.summary.mismatchCount, 0);
  assert.strictEqual(result.summary.creditDiscrepancy, 0);
  assert.strictEqual(result.expectedOnNextInvoiceBatches.length, 1);
  assert.strictEqual(result.batchGroups[0].status, "matched");
}

function testAggregateDifferenceIsOneAmountMismatch() {
  const result = reconcileGreenValley({
    invoiceTotal: 58604.07,
    invoiceBalance: -51012.11,
    lines: [
      { id: 10, invoice_line_id: "BBB8622", amount: -50000 },
      { id: 11, invoice_line_id: "BBB8623", amount: -59616.19 },
    ],
    scopedBatches: [batch(1, 109616.19)],
  });

  assert.strictEqual(result.aggregate.matched, false);
  assert.strictEqual(result.aggregate.controlDifference, 0.01);
  assert.strictEqual(result.summary.matchedCount, 0);
  assert.strictEqual(result.summary.missingFromInvoiceCount, 0);
  assert.strictEqual(result.summary.mismatchCount, 1);
  assert.strictEqual(result.summary.creditDiscrepancy, 0.01);
  assert.strictEqual(result.batchGroups[0].status, "mismatch");
  assert.match(result.batchGroups[0].message, /aggregate amount mismatch/i);
}

function run() {
  testAggregateControlMatches();
  testAggregateDifferenceIsOneAmountMismatch();
  console.log("PASS Green Valley reconciliation tests");
}

run();
