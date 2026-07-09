const { reconcile, expandReconcilePeriod } = require("./reconcile");

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
    invoiceAmount,
    invDate: line.inv_date,
  }));
}

function formatReconciliationResult(invoice, result, runAt, runId = null) {
  return {
    runId,
    runAt,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
    summary: result.summary,
    matched: buildMatchedRows(result),
    exceptions: buildExceptions(result),
  };
}

function resetReconciliationState(database, invoiceId, periodStart, periodEnd) {
  database
    .prepare(
      `UPDATE invoice_lines
       SET match_status = 'unmatched', batch_id = NULL
       WHERE invoice_id = ?`
    )
    .run(invoiceId);

  database
    .prepare(
      `UPDATE batches
       SET match_status = 'unmatched',
           invoice_line_id = NULL,
           invoice_amount = NULL,
           last_reconciled_at = NULL
       WHERE batch_date >= ? AND batch_date <= ?`
    )
    .run(periodStart, periodEnd);
}

function applyReconciliation(database, invoiceId, result, runAt) {
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

  const insertRun = database.prepare(
    `INSERT INTO reconciliation_runs (
       invoice_id, run_at, scoped_batch_count, matched_count,
       missing_from_invoice_count, unmatched_line_count, mismatch_count,
       total_deposit, total_fee, total_credit, credit_discrepancy
     ) VALUES (
       @invoice_id, @run_at, @scoped_batch_count, @matched_count,
       @missing_from_invoice_count, @unmatched_line_count, @mismatch_count,
       @total_deposit, @total_fee, @total_credit, @credit_discrepancy
     )`
  );

  let runId = null;

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

    const summary = result.summary;
    const insertResult = insertRun.run({
      invoice_id: invoiceId,
      run_at: runAt,
      scoped_batch_count: summary.scopedBatchCount,
      matched_count: summary.matchedCount,
      missing_from_invoice_count: summary.missingFromInvoiceCount,
      unmatched_line_count: summary.unmatchedLineCount + summary.ambiguousLineCount,
      mismatch_count: summary.mismatchCount,
      total_deposit: summary.totalDeposit,
      total_fee: summary.totalFee,
      total_credit: summary.totalCredit,
      credit_discrepancy: summary.creditDiscrepancy,
    });
    runId = insertResult.lastInsertRowid;
  });

  run();
  return runId;
}

function runReconciliation(database, invoiceId, loaders) {
  const invoice = loaders.getInvoiceForReconcile(invoiceId);
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} was not found.`);
  }
  if (!invoice.period_start || !invoice.period_end) {
    throw new Error("Invoice is missing a reconciliation period.");
  }

  const lines = loaders.getInvoiceLines(invoiceId);
  const { scopeStart, scopeEnd } = expandReconcilePeriod(invoice.period_start, invoice.period_end);
  const scopedBatches = loaders.getBatchesInPeriod(scopeStart, scopeEnd);
  const matchableBatches = loaders.getBatches ? loaders.getBatches() : scopedBatches;
  const runAt = new Date().toISOString();

  resetReconciliationState(database, invoiceId, scopeStart, scopeEnd);

  const result = reconcile({
    invoice,
    lines,
    scopedBatches,
    matchableBatches,
  });

  const runId = applyReconciliation(database, invoiceId, result, runAt);
  return formatReconciliationResult(invoice, result, runAt, runId);
}

module.exports = {
  runReconciliation,
  formatReconciliationResult,
  resetReconciliationState,
  applyReconciliation,
  buildExceptions,
  buildMatchedRows,
};
