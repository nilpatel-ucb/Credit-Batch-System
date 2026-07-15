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

function testDuplicateBatchNumberNetsAllRowsRegardlessOfDate() {
  // Two Chevron rows same number, different days, only one EFT credit →
  // exact row matches; the other stays missing from invoice.
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

  assert.strictEqual(result.batchGroups.length, 1);
  assert.strictEqual(result.batchGroups[0].status, "matched");
  assert.strictEqual(result.batchGroups[0].batches.length, 1);
  assert.strictEqual(result.batchGroups[0].batch.id, 10);
  assert.strictEqual(result.missingBatches.length, 1);
  assert.strictEqual(result.missingBatches[0].batch.id, 11);
  assert.strictEqual(result.summary.totalMissingCredit, 1000);
  assert.strictEqual(result.summary.creditDiscrepancy, 1000);
}

function testDifferentDaySameBatchNumberNetsTogether() {
  // Real case: 9001 on Jan 1 (93.71) + Jan 2 (205.07) vs EFT -93.71 + -205.07.
  const batches = [
    {
      id: 1702,
      batch_date: "2026-01-01",
      batch_number: "9001",
      gross_amount: 100,
      total_fee: 6.29,
      net_amount: 93.71,
    },
    {
      id: 1709,
      batch_date: "2026-01-02",
      batch_number: "9001",
      gross_amount: 220,
      total_fee: 14.93,
      net_amount: 205.07,
    },
  ];

  const result = reconcile({
    invoice: {
      id: 1,
      invoice_number: "0084226",
      invoice_total: 298.78,
      period_start: "2026-01-02",
      period_end: "2026-01-05",
    },
    lines: [
      {
        id: 1774,
        invoice_line_id: "AAF9001",
        batch_number: "9001",
        amount: -93.71,
        inv_date: "2026-01-02",
      },
      {
        id: 1793,
        invoice_line_id: "AAX9001",
        batch_number: "9001",
        amount: -205.07,
        inv_date: "2026-01-05",
      },
    ],
    scopedBatches: batches,
  });

  assert.strictEqual(result.batchGroups[0].status, "matched");
  assert.strictEqual(result.batchGroups[0].netEft, -298.78);
  assert.strictEqual(result.batchGroups[0].batchNetTotal, 298.78);
  assert.strictEqual(result.batchGroups[0].batches.length, 2);
  assert.strictEqual(result.summary.matchedCount, 2);
  assert.strictEqual(result.missingBatches.length, 0);
}

function testSameDayDuplicateBatchesAreNettedTogether() {
  // Chevron often splits one batch number into two same-day rows.
  const batches = [
    {
      id: 20,
      batch_date: "2026-04-20",
      batch_number: "9110",
      gross_amount: 20,
      total_fee: 4.62,
      net_amount: 15.38,
    },
    {
      id: 21,
      batch_date: "2026-04-20",
      batch_number: "9110",
      gross_amount: 210,
      total_fee: 9.83,
      net_amount: 200.17,
    },
  ];

  const result = reconcile({
    invoice: {
      id: 1,
      invoice_number: "X",
      invoice_total: 215.55,
      period_start: "2026-04-20",
      period_end: "2026-04-22",
    },
    lines: [
      { id: 1, invoice_line_id: "AAG9110", batch_number: "9110", amount: -15.38, inv_date: "2026-04-20" },
      { id: 2, invoice_line_id: "ABM9110", batch_number: "9110", amount: -15.38, inv_date: "2026-04-21" },
      { id: 3, invoice_line_id: "ACS9110", batch_number: "9110", amount: 15.38, inv_date: "2026-04-21" },
      { id: 4, invoice_line_id: "AAV9110", batch_number: "9110", amount: -200.17, inv_date: "2026-04-20" },
      { id: 5, invoice_line_id: "ACB9110", batch_number: "9110", amount: -200.17, inv_date: "2026-04-22" },
      { id: 6, invoice_line_id: "ADH9110", batch_number: "9110", amount: 200.17, inv_date: "2026-04-22" },
    ],
    scopedBatches: batches,
  });

  assert.strictEqual(result.batchGroups.length, 1);
  assert.strictEqual(result.batchGroups[0].status, "matched");
  assert.strictEqual(result.batchGroups[0].netEft, -215.55);
  assert.strictEqual(result.batchGroups[0].batchNetTotal, 215.55);
  assert.strictEqual(result.batchGroups[0].batches.length, 2);
  assert.strictEqual(result.summary.matchedCount, 2);
  assert.strictEqual(result.missingBatches.length, 0);
  assert.strictEqual(result.unmatchedLines.length, 0);
}

function testSameDayDuplicateBatchesUnderCreditedWhenOnlyOneSidePaid() {
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

  assert.strictEqual(result.batchGroups[0].status, "matched");
  assert.strictEqual(result.batchGroups[0].batchNetTotal, 1000);
  assert.strictEqual(result.summary.matchedCount, 1);
  assert.strictEqual(result.summary.mismatchCount, 0);
  assert.strictEqual(result.missingBatches.length, 1);
  assert.strictEqual(result.summary.totalMissingCredit, 1000);
}

function testCreditDiscrepancyEqualsTotalMissingCredit() {
  const result = reconcile({
    invoice: sampleInvoice(),
    lines: sampleLines(),
    scopedBatches: sampleBatches(),
  });

  assert.strictEqual(result.summary.totalCredit, 4317.73);
  assert.strictEqual(result.summary.totalMissingCredit, 2578.36);
  assert.strictEqual(result.summary.creditDiscrepancy, 2578.36);
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

function testNetMatchWithReversalAndRecredit() {
  const result = reconcile({
    invoice: { id: 1, invoice_number: "X", invoice_total: 0, period_start: "2026-03-01", period_end: "2026-03-31" },
    lines: [
      {
        id: 1,
        invoice_line_id: "AAA0449",
        batch_number: "449",
        amount: -328.51,
        inv_date: "2026-03-10",
      },
      {
        id: 2,
        invoice_line_id: "AAB0449",
        batch_number: "449",
        amount: 328.51,
        inv_date: "2026-03-15",
      },
      {
        id: 3,
        invoice_line_id: "AAC0449",
        batch_number: "449",
        amount: -328.51,
        inv_date: "2026-03-20",
      },
    ],
    scopedBatches: [
      {
        id: 1,
        batch_date: "2026-03-10",
        batch_number: "449",
        gross_amount: 350,
        total_fee: 21.49,
        net_amount: 328.51,
      },
    ],
  });

  assert.strictEqual(result.batchGroups.length, 1);
  assert.strictEqual(result.batchGroups[0].status, "matched");
  assert.strictEqual(result.batchGroups[0].netEft, -328.51);
  assert.strictEqual(result.matchedPairs.length, 3);
  assert.strictEqual(result.missingBatches.length, 0);
  assert.strictEqual(result.unmatchedLines.length, 0);
  assert.strictEqual(result.summary.matchedCount, 1);
}

function testNetZeroMarksReversed() {
  const result = reconcile({
    invoice: { id: 1, invoice_number: "X", invoice_total: 0, period_start: "2026-03-01", period_end: "2026-03-31" },
    lines: [
      {
        id: 1,
        invoice_line_id: "AAA0449",
        batch_number: "449",
        amount: -328.51,
        inv_date: "2026-03-10",
      },
      {
        id: 2,
        invoice_line_id: "AAB0449",
        batch_number: "449",
        amount: 328.51,
        inv_date: "2026-03-15",
      },
    ],
    scopedBatches: [
      {
        id: 1,
        batch_date: "2026-03-10",
        batch_number: "449",
        gross_amount: 350,
        total_fee: 21.49,
        net_amount: 328.51,
      },
    ],
  });

  assert.strictEqual(result.batchGroups.length, 1);
  assert.strictEqual(result.batchGroups[0].status, "reversed");
  assert.strictEqual(result.batchGroups[0].netEft, 0);
  assert.strictEqual(result.matchedPairs.length, 0);
  assert.strictEqual(result.summary.reversedCount, 1);
}

function testOverCreditedWhenDuplicateCreditsWithoutReversal() {
  const result = reconcile({
    invoice: { id: 1, invoice_number: "X", invoice_total: 0, period_start: "2026-03-01", period_end: "2026-03-31" },
    lines: [
      {
        id: 1,
        invoice_line_id: "AAA0449",
        batch_number: "449",
        amount: -328.51,
        inv_date: "2026-03-10",
      },
      {
        id: 2,
        invoice_line_id: "AAB0449",
        batch_number: "449",
        amount: -328.51,
        inv_date: "2026-03-15",
      },
    ],
    scopedBatches: [
      {
        id: 1,
        batch_date: "2026-03-10",
        batch_number: "449",
        gross_amount: 350,
        total_fee: 21.49,
        net_amount: 328.51,
      },
    ],
  });

  assert.strictEqual(result.batchGroups.length, 1);
  assert.strictEqual(result.batchGroups[0].status, "over_credited");
  assert.strictEqual(result.batchGroups[0].netEft, -657.02);
  assert.strictEqual(result.summary.overCreditedCount, 1);
}

function testNetMismatchWhenUnderCredited() {
  const result = reconcile({
    invoice: { id: 1, invoice_number: "X", invoice_total: 0, period_start: "2026-03-01", period_end: "2026-03-31" },
    lines: [
      {
        id: 1,
        invoice_line_id: "AAA0435",
        batch_number: "435",
        amount: -900,
        inv_date: "2026-03-30",
      },
    ],
    scopedBatches: [
      {
        id: 1,
        batch_date: "2026-03-30",
        batch_number: "435",
        gross_amount: 1100,
        total_fee: 100,
        net_amount: 1000,
      },
    ],
  });

  assert.strictEqual(result.batchGroups.length, 1);
  assert.strictEqual(result.batchGroups[0].status, "mismatch");
  assert.strictEqual(result.batchGroups[0].netEft, -900);
  assert.strictEqual(result.matchedPairs.length, 0);
  assert.strictEqual(result.summary.mismatchCount, 1);
  assert.strictEqual(result.summary.totalMissingCredit, 100);
}

function testPartialBatchCreditCountsShortfallOnly() {
  // Real shape: one batch number, two Chevron rows; only part of the credit arrived.
  // Exact row is matched; uncredited row is missing from invoice.
  const result = reconcile({
    invoice: {
      id: 1,
      invoice_number: "X",
      invoice_total: 105.25,
      period_start: "2026-03-28",
      period_end: "2026-03-30",
    },
    lines: [
      {
        id: 1,
        invoice_line_id: "AA9147",
        batch_number: "9147",
        amount: -105.25,
        inv_date: "2026-03-30",
      },
    ],
    scopedBatches: [
      {
        id: 1,
        batch_date: "2026-03-28",
        batch_number: "9147",
        gross_amount: 110,
        total_fee: 4.75,
        net_amount: 105.25,
      },
      {
        id: 2,
        batch_date: "2026-03-29",
        batch_number: "9147",
        gross_amount: 230,
        total_fee: 8.86,
        net_amount: 221.14,
      },
    ],
  });

  assert.strictEqual(result.batchGroups.length, 1);
  assert.strictEqual(result.batchGroups[0].status, "matched");
  assert.strictEqual(result.batchGroups[0].batches.length, 1);
  assert.strictEqual(result.batchGroups[0].batch.net_amount, 105.25);
  assert.strictEqual(result.missingBatches.length, 1);
  assert.strictEqual(result.missingBatches[0].batch.net_amount, 221.14);
  assert.strictEqual(result.summary.mismatchCount, 0);
  assert.strictEqual(result.summary.missingFromInvoiceCount, 1);
  assert.strictEqual(result.summary.totalMissingCredit, 221.14);
  assert.strictEqual(result.summary.creditDiscrepancy, 221.14);
}

function testMismatchCannotStealExactMatch() {
  // With net-by-batch matching, lines for the same batch number are grouped
  // before comparing to the Chevron batch.
  const batches = [
    {
      id: 1,
      batch_date: "2026-03-30",
      batch_number: "435",
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
      period_start: "2026-03-29",
      period_end: "2026-03-30",
    },
    lines: [
      {
        id: 1,
        invoice_line_id: "AAA0435",
        batch_number: "435",
        amount: -900,
        inv_date: "2026-03-29",
      },
      {
        id: 2,
        invoice_line_id: "AAB0435",
        batch_number: "435",
        amount: -1000,
        inv_date: "2026-03-30",
      },
    ],
    scopedBatches: batches,
  });

  assert.strictEqual(result.matchedPairs.length, 0);
  assert.strictEqual(result.batchGroups[0].status, "over_credited");
  assert.strictEqual(result.batchGroups[0].netEft, -1900);
}

function testMismatchNetsAllBatchesWithSameNumber() {
  const batches = [
    {
      id: 1,
      batch_date: "2026-03-20",
      batch_number: "500",
      gross_amount: 1100,
      total_fee: 100,
      net_amount: 1000,
    },
    {
      id: 2,
      batch_date: "2026-03-30",
      batch_number: "500",
      gross_amount: 2200,
      total_fee: 200,
      net_amount: 2000,
    },
  ];

  const result = reconcile({
    invoice: {
      id: 1,
      invoice_number: "X",
      invoice_total: 1500,
      period_start: "2026-03-20",
      period_end: "2026-03-30",
    },
    lines: [
      {
        id: 1,
        invoice_line_id: "AAA0500",
        batch_number: "500",
        amount: -1500,
        inv_date: "2026-03-30",
      },
    ],
    scopedBatches: batches,
  });

  assert.strictEqual(result.batchGroups[0].status, "mismatch");
  assert.strictEqual(result.batchGroups[0].batchNetTotal, 3000);
  assert.strictEqual(result.batchGroups[0].batches.length, 2);
  assert.strictEqual(result.mismatchPairs.length, 1);
}

function run() {
  testHappyPathMatch();
  testMissingBatchCountedInTotalMissingCredit();
  testUnmatchedInvoiceLine();
  testLeadingZerosMatch();
  testSignedInvoiceAmountMatchesPositiveNet();
  testDuplicateBatchNumberNetsAllRowsRegardlessOfDate();
  testDifferentDaySameBatchNumberNetsTogether();
  testSameDayDuplicateBatchesAreNettedTogether();
  testSameDayDuplicateBatchesUnderCreditedWhenOnlyOneSidePaid();
  testCreditDiscrepancyEqualsTotalMissingCredit();
  testBatchOutsideInvoicePeriodStillMatchesByNumberAndAmount();
  testNetMatchWithReversalAndRecredit();
  testNetZeroMarksReversed();
  testOverCreditedWhenDuplicateCreditsWithoutReversal();
  testNetMismatchWhenUnderCredited();
  testPartialBatchCreditCountsShortfallOnly();
  testMismatchCannotStealExactMatch();
  testMismatchNetsAllBatchesWithSameNumber();
  testAmountMismatchIsFlaggedSeparately();
  testStoreReconcileIntegration();
  console.log("PASS reconcile tests");
}

run();
