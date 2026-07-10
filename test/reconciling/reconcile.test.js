const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { reconcile } = require("../../backend/reconciling/reconcile");
const { createStoreManager } = require("../../backend/reconciling/db/store");

function makeTempStoresDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cbr-reconcile-test-"));
}

function sampleInvoice() {
  return {
    id: 1,
    invoice_number: "0600658",
    invoice_total: 35381.95,
    period_start: "2026-03-29",
    period_end: "2026-03-30",
  };
}

function sampleLines() {
  return [
    {
      id: 1,
      invoice_line_id: "AAE0319",
      batch_number: "0319",
      amount: -2817.73,
      inv_date: "2026-03-30",
    },
    {
      id: 2,
      invoice_line_id: "AAU9086",
      batch_number: "9086",
      amount: -1500,
      inv_date: "2026-03-29",
    },
  ];
}

function sampleBatches() {
  return [
    {
      id: 1,
      batch_date: "2026-03-30",
      batch_number: "0319",
      gross_amount: 2900,
      total_fee: 82.27,
      net_amount: 2817.73,
    },
    {
      id: 2,
      batch_date: "2026-03-29",
      batch_number: "9086",
      gross_amount: 1600,
      total_fee: 100,
      net_amount: 1500,
    },
    {
      id: 3,
      batch_date: "2026-03-30",
      batch_number: "0341",
      gross_amount: 2643.8,
      total_fee: 65.44,
      net_amount: 2578.36,
    },
  ];
}

function testHappyPathMatch() {
  const result = reconcile({
    invoice: sampleInvoice(),
    lines: sampleLines(),
    scopedBatches: sampleBatches(),
  });

  assert.strictEqual(result.matchedPairs.length, 2);
  assert.strictEqual(result.missingBatches.length, 1);
  assert.strictEqual(result.unmatchedLines.length, 0);
  assert.strictEqual(result.summary.matchedCount, 2);
  assert.strictEqual(result.summary.missingFromInvoiceCount, 1);
  assert.strictEqual(result.summary.totalMissingCredit, 2578.36);
  assert.strictEqual(result.missingBatches[0].batch.batch_number, "0341");
}

function testMissingBatchCountedInTotalMissingCredit() {
  const result = reconcile({
    invoice: sampleInvoice(),
    lines: [sampleLines()[0]],
    scopedBatches: sampleBatches(),
  });

  assert.strictEqual(result.matchedPairs.length, 1);
  assert.strictEqual(result.missingBatches.length, 2);
  assert.strictEqual(result.summary.totalMissingCredit, 4078.36);
}

function testUnmatchedInvoiceLine() {
  const result = reconcile({
    invoice: sampleInvoice(),
    lines: sampleLines(),
    scopedBatches: [sampleBatches()[2]],
  });

  assert.strictEqual(result.matchedPairs.length, 0);
  assert.strictEqual(result.unmatchedLines.length, 2);
  assert.strictEqual(result.missingBatches.length, 1);
}

function testLeadingZerosMatch() {
  const result = reconcile({
    invoice: sampleInvoice(),
    lines: [
      {
        id: 1,
        invoice_line_id: "AAE0319",
        batch_number: "319",
        amount: -2817.73,
        inv_date: "2026-03-30",
      },
    ],
    scopedBatches: [sampleBatches()[0]],
  });

  assert.strictEqual(result.matchedPairs.length, 1);
  assert.strictEqual(result.matchedPairs[0].batch.batch_number, "0319");
}

function testSignedInvoiceAmountMatchesPositiveNet() {
  const result = reconcile({
    invoice: sampleInvoice(),
    lines: [sampleLines()[1]],
    scopedBatches: [sampleBatches()[1]],
  });

  assert.strictEqual(result.matchedPairs.length, 1);
  assert.strictEqual(result.matchedPairs[0].invoiceAmount, 1500);
}

function testDuplicateBatchNumberUsesDateProximity() {
  const batches = [
    {
      id: 10,
      batch_date: "2026-03-28",
      batch_number: "100",
      gross_amount: 1100,
      total_fee: 100,
      net_amount: 1000,
    },
    {
      id: 11,
      batch_date: "2026-03-30",
      batch_number: "100",
      gross_amount: 1100,
      total_fee: 100,
      net_amount: 1000,
    },
  ];

  const result = reconcile({
    invoice: {
      id: 1,
      invoice_number: "X",
      invoice_total: 1000,
      period_start: "2026-03-28",
      period_end: "2026-03-30",
    },
    lines: [
      {
        id: 1,
        invoice_line_id: "AA100",
        batch_number: "100",
        amount: -1000,
        inv_date: "2026-03-30",
      },
    ],
    scopedBatches: batches,
  });

  assert.strictEqual(result.matchedPairs.length, 1);
  assert.strictEqual(result.matchedPairs[0].batch.id, 11);
  assert.strictEqual(result.missingBatches.length, 1);
  assert.strictEqual(result.missingBatches[0].batch.id, 10);
}

function testAmbiguousWhenCandidatesTied() {
  const batches = [
    {
      id: 20,
      batch_date: "2026-03-30",
      batch_number: "200",
      gross_amount: 1100,
      total_fee: 100,
      net_amount: 1000,
    },
    {
      id: 21,
      batch_date: "2026-03-30",
      batch_number: "200",
      gross_amount: 1100,
      total_fee: 100,
      net_amount: 1000,
    },
  ];

  const result = reconcile({
    invoice: {
      id: 1,
      invoice_number: "X",
      invoice_total: 1000,
      period_start: "2026-03-30",
      period_end: "2026-03-30",
    },
    lines: [
      {
        id: 1,
        invoice_line_id: "AA200",
        batch_number: "200",
        amount: -1000,
        inv_date: "2026-03-30",
      },
    ],
    scopedBatches: batches,
  });

  assert.strictEqual(result.matchedPairs.length, 0);
  assert.strictEqual(result.ambiguousLines.length, 1);
}

function testCreditDiscrepancyUsesMatchedNetsOnly() {
  const result = reconcile({
    invoice: sampleInvoice(),
    lines: sampleLines(),
    scopedBatches: sampleBatches(),
  });

  assert.strictEqual(result.summary.totalCredit, 4317.73);
  assert.strictEqual(result.summary.creditDiscrepancy, 31064.22);
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

function testStoreReconcileIntegration() {
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
        batch_date: "2026-03-29",
        batch_number: "9086",
        gross_amount: 1600,
        total_fee: 100,
        net_amount: 1500,
      },
      {
        site_id: "309359",
        batch_date: "2026-03-30",
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

  assert.ok(insertResult.reconciliation);
  assert.strictEqual(insertResult.reconciliation.summary.matchedCount, 2);
  assert.strictEqual(insertResult.reconciliation.summary.missingFromInvoiceCount, 1);
  assert.strictEqual(insertResult.reconciliation.summary.totalMissingCredit, 2578.36);

  const rerun = manager.reconcileStore();
  assert.strictEqual(rerun.summary.matchedCount, 2);
  assert.strictEqual(rerun.summary.missingFromInvoiceCount, 1);

  const last = manager.getStoreReconciliation();
  assert.ok(last);
  assert.strictEqual(last.summary.matchedCount, 2);
  assert.strictEqual(last.exceptions.length, 1);
  assert.strictEqual(last.exceptions[0].type, "missing_from_invoice");

  const batches = manager.getBatches();
  const byNumber = Object.fromEntries(batches.map((batch) => [batch.batch_number, batch]));
  assert.strictEqual(byNumber["0319"].match_status, "matched");
  assert.strictEqual(byNumber["0341"].match_status, "missing_from_invoice");

  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testBatchOutsideInvoicePeriodStillMatchesByNumberAndAmount() {
  const result = reconcile({
    invoice: {
      id: 1,
      invoice_number: "0600658",
      invoice_total: 2817.73,
      period_start: "2026-03-30",
      period_end: "2026-03-31",
    },
    lines: [
      {
        id: 1,
        invoice_line_id: "AAE0319",
        batch_number: "0319",
        amount: -2817.73,
        inv_date: "2026-03-30",
      },
    ],
    scopedBatches: [],
    matchableBatches: [
      {
        id: 22,
        batch_date: "2026-03-26",
        batch_number: "0319",
        gross_amount: 2900,
        total_fee: 82.27,
        net_amount: 2817.73,
      },
    ],
  });

  assert.strictEqual(result.matchedPairs.length, 1);
  assert.strictEqual(result.unmatchedLines.length, 0);
  assert.strictEqual(result.matchedPairs[0].batch.batch_date, "2026-03-26");
}

function testAmountMismatchIsFlaggedSeparately() {
  const result = reconcile({
    invoice: sampleInvoice(),
    lines: [
      {
        id: 1,
        invoice_line_id: "AAE0319",
        batch_number: "0319",
        amount: -2817.73,
        inv_date: "2026-03-30",
      },
    ],
    scopedBatches: [
      {
        id: 1,
        batch_date: "2026-03-30",
        batch_number: "0319",
        gross_amount: 2900,
        total_fee: 82.27,
        net_amount: 2800,
      },
    ],
    matchableBatches: [
      {
        id: 1,
        batch_date: "2026-03-30",
        batch_number: "0319",
        gross_amount: 2900,
        total_fee: 82.27,
        net_amount: 2800,
      },
    ],
  });

  assert.strictEqual(result.matchedPairs.length, 0);
  assert.strictEqual(result.mismatchPairs.length, 1);
  assert.strictEqual(result.unmatchedLines.length, 0);
}

function run() {
  testHappyPathMatch();
  testMissingBatchCountedInTotalMissingCredit();
  testUnmatchedInvoiceLine();
  testLeadingZerosMatch();
  testSignedInvoiceAmountMatchesPositiveNet();
  testDuplicateBatchNumberUsesDateProximity();
  testAmbiguousWhenCandidatesTied();
  testCreditDiscrepancyUsesMatchedNetsOnly();
  testBatchOutsideInvoicePeriodStillMatchesByNumberAndAmount();
  testAmountMismatchIsFlaggedSeparately();
  testStoreReconcileIntegration();
  console.log("PASS reconcile tests");
}

run();
