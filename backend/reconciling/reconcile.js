const Normalize = require("../parsing/normalize");

const RECONCILE_DATE_BUFFER_DAYS = 7;

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeBatchNumber(batchNumber) {
  return Normalize.stripLeadingZeros(batchNumber);
}

function parseIsoDate(isoDate) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDaysToIsoDate(isoDate, dayDelta) {
  const date = parseIsoDate(isoDate);
  date.setDate(date.getDate() + dayDelta);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function expandReconcilePeriod(periodStart, periodEnd, bufferDays = RECONCILE_DATE_BUFFER_DAYS) {
  return {
    scopeStart: addDaysToIsoDate(periodStart, -bufferDays),
    scopeEnd: addDaysToIsoDate(periodEnd, bufferDays),
  };
}

function dateDistanceDays(batchDate, invDate) {
  const batchMs = parseIsoDate(batchDate).getTime();
  const invMs = parseIsoDate(invDate).getTime();
  return Math.abs(batchMs - invMs) / (24 * 60 * 60 * 1000);
}

function amountsMatch(lineAmount, batchNetAmount) {
  return round2(Math.abs(Number(lineAmount))) === round2(Number(batchNetAmount));
}

function compareBatchCandidates(a, b, invDate) {
  const distA = dateDistanceDays(a.batch_date, invDate);
  const distB = dateDistanceDays(b.batch_date, invDate);
  if (distA !== distB) {
    return distA - distB;
  }

  const dateCmp = String(a.batch_date).localeCompare(String(b.batch_date));
  if (dateCmp !== 0) {
    return dateCmp;
  }

  return Number(a.id) - Number(b.id);
}

function pickBatchCandidate(candidates, invDate) {
  if (candidates.length === 0) {
    return { batch: null, ambiguous: false };
  }

  const sorted = [...candidates].sort((a, b) => compareBatchCandidates(a, b, invDate));
  if (sorted.length > 1) {
    const firstDist = dateDistanceDays(sorted[0].batch_date, invDate);
    const secondDist = dateDistanceDays(sorted[1].batch_date, invDate);
    if (firstDist === secondDist && sorted[0].batch_date === sorted[1].batch_date) {
      return { batch: null, ambiguous: true };
    }
  }

  return { batch: sorted[0], ambiguous: false };
}

function findBatchCandidates(line, scopedBatches, usedBatchIds) {
  const targetNumber = normalizeBatchNumber(line.batch_number);

  return scopedBatches.filter((batch) => {
    if (usedBatchIds.has(batch.id)) {
      return false;
    }
    if (normalizeBatchNumber(batch.batch_number) !== targetNumber) {
      return false;
    }
    return amountsMatch(line.amount, batch.net_amount);
  });
}

function findAmountMismatchBatch(line, matchableBatches, usedBatchIds) {
  const targetNumber = normalizeBatchNumber(line.batch_number);

  return (
    matchableBatches.find((batch) => {
      if (usedBatchIds.has(batch.id)) {
        return false;
      }
      if (normalizeBatchNumber(batch.batch_number) !== targetNumber) {
        return false;
      }
      return !amountsMatch(line.amount, batch.net_amount);
    }) || null
  );
}

function buildSummary(
  invoiceTotal,
  scopedBatches,
  matchedPairs,
  missingBatches,
  unmatchedLines,
  ambiguousLines,
  mismatchPairs
) {
  const totalDeposit = matchedPairs.reduce((sum, pair) => sum + Number(pair.batch.gross_amount), 0);
  const totalFee = matchedPairs.reduce((sum, pair) => sum + Number(pair.batch.total_fee), 0);
  const totalCredit = matchedPairs.reduce((sum, pair) => sum + Number(pair.batch.net_amount), 0);
  const totalMissingCredit = missingBatches.reduce((sum, batch) => sum + Number(batch.net_amount), 0);
  const normalizedInvoiceTotal = round2(Number(invoiceTotal || 0));

  return {
    scopedBatchCount: scopedBatches.length,
    lineCount: unmatchedLines.length + ambiguousLines.length + matchedPairs.length,
    matchedCount: matchedPairs.length,
    missingFromInvoiceCount: missingBatches.length,
    unmatchedLineCount: unmatchedLines.length,
    ambiguousLineCount: ambiguousLines.length,
    mismatchCount: mismatchPairs.length,
    totalDeposit: round2(totalDeposit),
    totalFee: round2(totalFee),
    totalCredit: round2(totalCredit),
    invoiceTotal: normalizedInvoiceTotal,
    creditDiscrepancy: round2(normalizedInvoiceTotal - totalCredit),
    totalMissingCredit: round2(totalMissingCredit),
  };
}

function reconcile({ invoice, invoiceTotal, lines, scopedBatches, matchableBatches }) {
  const resolvedInvoiceTotal =
    invoiceTotal != null ? invoiceTotal : invoice ? Number(invoice.invoice_total) : 0;
  const searchableBatches = matchableBatches || scopedBatches;
  const usedBatchIds = new Set();
  const matchedPairs = [];
  const unmatchedLines = [];
  const ambiguousLines = [];
  const mismatchPairs = [];

  for (const line of lines) {
    const candidates = findBatchCandidates(line, searchableBatches, usedBatchIds);
    const { batch, ambiguous } = pickBatchCandidate(candidates, line.inv_date);

    if (ambiguous) {
      ambiguousLines.push({ line, message: "Multiple batch candidates with the same date proximity." });
      continue;
    }

    if (batch) {
      usedBatchIds.add(batch.id);
      matchedPairs.push({
        line,
        batch,
        invoiceAmount: round2(Math.abs(Number(line.amount))),
      });
      continue;
    }

    const mismatchBatch = findAmountMismatchBatch(line, searchableBatches, usedBatchIds);
    if (mismatchBatch) {
      usedBatchIds.add(mismatchBatch.id);
      mismatchPairs.push({
        line,
        batch: mismatchBatch,
        message: `Batch number matches but amounts differ (invoice ${round2(Math.abs(Number(line.amount)))} vs batch ${round2(Number(mismatchBatch.net_amount))}).`,
      });
      continue;
    }

    unmatchedLines.push({ line, message: "No matching batch found in store for this invoice line." });
  }

  const missingBatches = scopedBatches
    .filter((batch) => !usedBatchIds.has(batch.id))
    .map((batch) => ({
      batch,
      message: "Batch has no matching invoice line.",
    }));

  const summary = buildSummary(
    resolvedInvoiceTotal,
    scopedBatches,
    matchedPairs,
    missingBatches.map((entry) => entry.batch),
    unmatchedLines,
    ambiguousLines,
    mismatchPairs
  );

  return {
    matchedPairs,
    missingBatches,
    unmatchedLines,
    ambiguousLines,
    mismatchPairs,
    summary,
  };
}

module.exports = {
  reconcile,
  round2,
  normalizeBatchNumber,
  amountsMatch,
  dateDistanceDays,
  addDaysToIsoDate,
  expandReconcilePeriod,
  RECONCILE_DATE_BUFFER_DAYS,
};
