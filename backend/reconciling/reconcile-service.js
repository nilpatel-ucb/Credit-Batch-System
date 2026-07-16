const {
  reconcile,
  BATCH_MATCH_STATUS,
  sumMismatchShortfall,
} = require("./reconcile");
const { reconcileGreenValley } = require("./reconcile-green-valley");

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function groupBatches(group) {
  return group.batches && group.batches.length > 0 ? group.batches : [group.batch];
}

function isOpenRow(row) {
  return row.reconciliation_run_id == null;
}

function buildExceptions(result) {
  const exceptions = [];

  for (const { batch, message } of result.missingBatches) {
    exceptions.push({
      type: "missing_from_invoice",
      batchId: batch.id,
      batchDate: batch.batch_date,
      batchNumber: batch.batch_number,
      netAmount: batch.net_amount,
      netEft: null,
      invoiceLineId: null,
      invoiceAmount: null,
      message,
    });
  }

  for (const { batch, message } of result.expectedOnNextInvoiceBatches || []) {
    exceptions.push({
      type: BATCH_MATCH_STATUS.EXPECTED_ON_NEXT_INVOICE,
      batchId: batch.id,
      batchDate: batch.batch_date,
      batchNumber: batch.batch_number,
      netAmount: batch.net_amount,
      netEft: null,
      invoiceLineId: null,
      invoiceAmount: null,
      message,
    });
  }

  for (const group of result.batchGroups || []) {
    if (group.status === BATCH_MATCH_STATUS.MATCHED) {
      continue;
    }

    const batches = groupBatches(group);
    exceptions.push({
      type: group.status,
      batchId: batches.map((batch) => batch.id).join(","),
      batchDate: batches.map((batch) => batch.batch_date).join(", "),
      batchNumber: group.batch.batch_number,
      netAmount: group.batchNetTotal != null ? group.batchNetTotal : computeFallbackNet(batches),
      netEft: group.netEft,
      invoiceLineId: group.lines.map((line) => line.invoice_line_id).join(", "),
      invoiceAmount: group.netEft,
      lineCount: group.lines.length,
      batchCount: batches.length,
      message: group.message,
    });
  }

  for (const { lines, netEft, message } of result.unmatchedLineGroups || []) {
    for (const line of lines) {
      exceptions.push({
        type: "unmatched_line",
        batchId: null,
        batchDate: null,
        batchNumber: line.batch_number,
        netAmount: null,
        netEft,
        invoiceLineId: line.invoice_line_id,
        invoiceAmount: line.amount,
        message,
      });
    }
  }

  for (const { lines, netEft, message } of result.ambiguousGroups || []) {
    for (const line of lines) {
      exceptions.push({
        type: "ambiguous",
        batchId: null,
        batchDate: null,
        batchNumber: line.batch_number,
        netAmount: null,
        netEft,
        invoiceLineId: line.invoice_line_id,
        invoiceAmount: line.amount,
        message,
      });
    }
  }

  return exceptions;
}

function computeFallbackNet(batches) {
  return round2(batches.reduce((sum, batch) => sum + Number(batch.net_amount), 0));
}

function buildMatchedRows(result) {
  const rows = [];

  for (const group of result.batchGroups || []) {
    if (group.status !== BATCH_MATCH_STATUS.MATCHED) {
      continue;
    }

    const batches = groupBatches(group);
    const primaryLine = group.lines.find((line) => Number(line.amount) < 0) || group.lines[0];
    const lineIds = group.lines.map((line) => line.invoice_line_id).join(", ");

    for (const batch of batches) {
      rows.push({
        batchId: batch.id,
        batchDate: batch.batch_date,
        batchNumber: batch.batch_number,
        grossAmount: batch.gross_amount,
        totalFee: batch.total_fee,
        netAmount: batch.net_amount,
        invoiceLineId: lineIds,
        invoiceNumber: primaryLine.invoice_number || null,
        invoiceAmount: round2(Number(batch.net_amount)),
        netEft: group.netEft,
        lineCount: group.lines.length,
        batchCount: batches.length,
        invDate: primaryLine.inv_date,
      });
    }
  }

  return rows;
}

function formatStoreReconciliationResult(result, runAt, invoiceCount) {
  return {
    runAt,
    invoiceCount,
    summary: result.summary,
    matched: buildMatchedRows(result),
    exceptions: buildExceptions(result),
  };
}

function resetStoreReconciliationState(database) {
  database
    .prepare(
      `UPDATE invoice_lines
       SET match_status = 'unmatched', batch_id = NULL
       WHERE reconciliation_run_id IS NULL`
    )
    .run();

  database
    .prepare(
      `UPDATE batches
       SET match_status = 'unmatched',
           invoice_line_id = NULL,
           invoice_amount = NULL,
           last_reconciled_at = NULL
       WHERE reconciliation_run_id IS NULL`
    )
    .run();
}

function applyReconciliation(database, result, runAt, { expectedBatchIds = new Set(), promoteExpected = false } = {}) {
  const updateBatch = database.prepare(
    `UPDATE batches
     SET match_status = @match_status,
         invoice_line_id = @invoice_line_id,
         invoice_amount = @invoice_amount,
         last_reconciled_at = @last_reconciled_at
     WHERE id = @id AND reconciliation_run_id IS NULL`
  );

  const updateLine = database.prepare(
    `UPDATE invoice_lines
     SET match_status = @match_status,
         batch_id = @batch_id
     WHERE id = @id AND reconciliation_run_id IS NULL`
  );

  const run = database.transaction(() => {
    for (const group of result.batchGroups || []) {
      const batches = groupBatches(group);
      const primaryLine = group.lines.find((line) => Number(line.amount) < 0) || group.lines[0];
      const primaryBatch = batches[0];

      for (const batch of batches) {
        updateBatch.run({
          id: batch.id,
          match_status: group.status,
          invoice_line_id: primaryLine ? primaryLine.invoice_line_id : null,
          invoice_amount: round2(Number(batch.net_amount)),
          last_reconciled_at: runAt,
        });
      }

      for (const line of group.lines) {
        updateLine.run({
          id: line.id,
          match_status: group.status,
          batch_id: primaryBatch.id,
        });
      }
    }

    for (const { batch } of result.missingBatches) {
      const keepExpected = !promoteExpected && expectedBatchIds.has(batch.id);
      updateBatch.run({
        id: batch.id,
        match_status: keepExpected
          ? BATCH_MATCH_STATUS.EXPECTED_ON_NEXT_INVOICE
          : BATCH_MATCH_STATUS.MISSING,
        invoice_line_id: null,
        invoice_amount: null,
        last_reconciled_at: runAt,
      });
    }

    for (const { batch } of result.expectedOnNextInvoiceBatches || []) {
      updateBatch.run({
        id: batch.id,
        match_status: BATCH_MATCH_STATUS.EXPECTED_ON_NEXT_INVOICE,
        invoice_line_id: null,
        invoice_amount: null,
        last_reconciled_at: runAt,
      });
    }

    for (const { lines } of result.unmatchedLineGroups || []) {
      for (const line of lines) {
        updateLine.run({
          id: line.id,
          match_status: "unmatched",
          batch_id: null,
        });
      }
    }

    for (const { lines } of result.ambiguousGroups || []) {
      for (const line of lines) {
        updateLine.run({
          id: line.id,
          match_status: "ambiguous",
          batch_id: null,
        });
      }
    }
  });

  run();
}

function adjustResultForExpected(result, expectedBatchIds, promoteExpected) {
  if (promoteExpected || expectedBatchIds.size === 0) {
    return result;
  }

  const expectedMissing = [];
  const trueMissing = [];
  for (const entry of result.missingBatches) {
    if (expectedBatchIds.has(entry.batch.id)) {
      expectedMissing.push(entry.batch);
    } else {
      trueMissing.push(entry);
    }
  }

  if (expectedMissing.length === 0) {
    return result;
  }

  const totalMissingCredit = round2(
    trueMissing.reduce((sum, entry) => sum + Number(entry.batch.net_amount), 0) +
      sumMismatchShortfall(result.batchGroups)
  );

  return {
    ...result,
    missingBatches: trueMissing,
    expectedOnNextInvoiceBatches: expectedMissing.map((batch) => ({
      batch,
      message: "Marked as expected on next invoice.",
    })),
    summary: {
      ...result.summary,
      missingFromInvoiceCount: trueMissing.length,
      creditDiscrepancy: totalMissingCredit,
      totalMissingCredit,
    },
  };
}

/**
 * @param {{ promoteExpected?: boolean }} [options]
 *   promoteExpected — when true (new EFT upload), batches previously tagged
 *   expected_on_next_invoice that still have no line become missing_from_invoice.
 *   Otherwise those tags are preserved and excluded from missing credit.
 */
function runStoreReconciliation(database, loaders, options = {}) {
  const promoteExpected = Boolean(options.promoteExpected);
  const useGreenValleyLogic = options.batchTemplate === "cstore_green_valley";
  const allBatches = loaders.getBatches();
  const allLines = loaders.getAllInvoiceLines();
  const openBatches = allBatches.filter(isOpenRow);
  const openLines = allLines.filter(isOpenRow);
  const invoices = loaders.getInvoices();
  const invoiceTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.invoice_total), 0);
  const runAt = new Date().toISOString();
  const expectedBatchIds = new Set(
    openBatches
      .filter((batch) => batch.match_status === BATCH_MATCH_STATUS.EXPECTED_ON_NEXT_INVOICE)
      .map((batch) => batch.id)
  );

  resetStoreReconciliationState(database);

  // Green Valley intentionally uses a separate aggregate control calculation.
  // All other stores continue through the existing per-batch reconciler below.
  if (useGreenValleyLogic) {
    const expectedBatches = openBatches.filter((batch) => expectedBatchIds.has(batch.id));
    const eligibleBatches = openBatches.filter((batch) => !expectedBatchIds.has(batch.id));
    const openInvoiceIds = new Set(openLines.map((line) => Number(line.invoice_id)));
    const openInvoices = invoices.filter((invoice) => openInvoiceIds.has(Number(invoice.id)));
    const invoiceTotal = round2(
      openInvoices.reduce((sum, invoice) => sum + Number(invoice.invoice_total), 0)
    );
    const balances = openInvoices
      .map((invoice) => invoice.invoice_balance)
      .filter((balance) => balance !== null && balance !== undefined);
    const invoiceBalance =
      balances.length === openInvoices.length && balances.length > 0
        ? round2(balances.reduce((sum, balance) => sum + Number(balance), 0))
        : null;
    const result = reconcileGreenValley({
      invoiceTotal,
      invoiceBalance,
      lines: openLines,
      scopedBatches: eligibleBatches,
      expectedBatches,
    });

    applyReconciliation(database, result, runAt, {
      expectedBatchIds,
      promoteExpected: false,
    });
    return formatStoreReconciliationResult(result, runAt, openInvoices.length);
  }

  const rawResult = reconcile({
    invoiceTotal,
    lines: openLines,
    scopedBatches: openBatches,
    matchableBatches: openBatches,
  });

  applyReconciliation(database, rawResult, runAt, { expectedBatchIds, promoteExpected });
  const result = adjustResultForExpected(rawResult, expectedBatchIds, promoteExpected);
  return formatStoreReconciliationResult(result, runAt, invoices.length);
}

module.exports = {
  runStoreReconciliation,
  formatStoreReconciliationResult,
  resetStoreReconciliationState,
  applyReconciliation,
  buildExceptions,
  buildMatchedRows,
  isOpenRow,
  round2,
};
