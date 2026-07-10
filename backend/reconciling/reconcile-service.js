const { reconcile } = require("./reconcile");

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
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
      invoiceLineId: null,
      invoiceAmount: null,
      message,
    });
  }

  for (const { line, message } of result.unmatchedLines) {
    exceptions.push({
      type: "unmatched_line",
      batchId: null,
      batchDate: null,
      batchNumber: line.batch_number,
      netAmount: null,
      invoiceLineId: line.invoice_line_id,
      invoiceAmount: line.amount,
      message,
    });
  }

  for (const { line, message } of result.ambiguousLines) {
    exceptions.push({
      type: "ambiguous",
      batchId: null,
      batchDate: null,
      batchNumber: line.batch_number,
      netAmount: null,
      invoiceLineId: line.invoice_line_id,
      invoiceAmount: line.amount,
      message,
    });
  }

  for (const { line, batch, message } of result.mismatchPairs || []) {
    exceptions.push({
      type: "mismatch",
      batchId: batch.id,
      batchDate: batch.batch_date,
      batchNumber: batch.batch_number,
      netAmount: batch.net_amount,
      invoiceLineId: line.invoice_line_id,
      invoiceAmount: line.amount,
      message,
    });
  }

  return exceptions;
}

function buildMatchedRows(result) {
  return result.matchedPairs.map(({ line, batch, invoiceAmount }) => ({
    batchId: batch.id,
    batchDate: batch.batch_date,
    batchNumber: batch.batch_number,
    grossAmount: batch.gross_amount,
    totalFee: batch.total_fee,
    netAmount: batch.net_amount,
    invoiceLineId: line.invoice_line_id,
    invoiceNumber: line.invoice_number || null,
    invoiceAmount,
    invDate: line.inv_date,
  }));
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
       SET match_status = 'unmatched', batch_id = NULL`
    )
    .run();

  database
    .prepare(
      `UPDATE batches
       SET match_status = 'unmatched',
           invoice_line_id = NULL,
           invoice_amount = NULL,
           last_reconciled_at = NULL`
    )
    .run();
}

function applyReconciliation(database, result, runAt) {
  const updateBatch = database.prepare(
    `UPDATE batches
     SET match_status = @match_status,
         invoice_line_id = @invoice_line_id,
         invoice_amount = @invoice_amount,
         last_reconciled_at = @last_reconciled_at
     WHERE id = @id`
  );

  const updateLine = database.prepare(
    `UPDATE invoice_lines
     SET match_status = @match_status,
         batch_id = @batch_id
     WHERE id = @id`
  );

  const run = database.transaction(() => {
    for (const { line, batch, invoiceAmount } of result.matchedPairs) {
      updateBatch.run({
        id: batch.id,
        match_status: "matched",
        invoice_line_id: line.invoice_line_id,
        invoice_amount: invoiceAmount,
        last_reconciled_at: runAt,
      });
      updateLine.run({
        id: line.id,
        match_status: "matched",
        batch_id: batch.id,
      });
    }

    for (const { batch } of result.missingBatches) {
      updateBatch.run({
        id: batch.id,
        match_status: "missing_from_invoice",
        invoice_line_id: null,
        invoice_amount: null,
        last_reconciled_at: runAt,
      });
    }

    for (const { line } of result.unmatchedLines) {
      updateLine.run({
        id: line.id,
        match_status: "unmatched",
        batch_id: null,
      });
    }

    for (const { line } of result.ambiguousLines) {
      updateLine.run({
        id: line.id,
        match_status: "ambiguous",
        batch_id: null,
      });
    }

    for (const { line, batch } of result.mismatchPairs || []) {
      updateBatch.run({
        id: batch.id,
        match_status: "mismatch",
        invoice_line_id: line.invoice_line_id,
        invoice_amount: round2(Math.abs(Number(line.amount))),
        last_reconciled_at: runAt,
      });
      updateLine.run({
        id: line.id,
        match_status: "mismatch",
        batch_id: batch.id,
      });
    }
  });

  run();
}

function runStoreReconciliation(database, loaders) {
  const batches = loaders.getBatches();
  const lines = loaders.getAllInvoiceLines();
  const invoices = loaders.getInvoices();
  const invoiceTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.invoice_total), 0);
  const runAt = new Date().toISOString();

  resetStoreReconciliationState(database);

  const result = reconcile({
    invoiceTotal,
    lines,
    scopedBatches: batches,
    matchableBatches: batches,
  });

  applyReconciliation(database, result, runAt);
  return formatStoreReconciliationResult(result, runAt, invoices.length);
}

module.exports = {
  runStoreReconciliation,
  formatStoreReconciliationResult,
  resetStoreReconciliationState,
  applyReconciliation,
  buildExceptions,
  buildMatchedRows,
};
