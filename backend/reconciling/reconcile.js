const Normalize = require("../parsing/normalize");

const RECONCILE_DATE_BUFFER_DAYS = 7;

const BATCH_MATCH_STATUS = {
  MATCHED: "matched",
  MISSING: "missing_from_invoice",
  EXPECTED_ON_NEXT_INVOICE: "expected_on_next_invoice",
  REVERSED: "reversed",
  OVER_CREDITED: "over_credited",
  MISMATCH: "mismatch",
};

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

function groupLinesByBatchNumber(lines) {
  const groups = new Map();
  for (const line of lines) {
    const key = normalizeBatchNumber(line.batch_number);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(line);
  }
  return groups;
}

function computeNetEft(lines) {
  return round2(lines.reduce((sum, line) => sum + Number(line.amount), 0));
}

function computeBatchNetTotal(batches) {
  return round2(batches.reduce((sum, batch) => sum + Number(batch.net_amount), 0));
}

/** All unused Chevron rows with this batch number — date does not split them. */
function pickBatchesForNumber(candidates) {
  return [...candidates].sort((a, b) => {
    const dateCmp = String(a.batch_date).localeCompare(String(b.batch_date));
    if (dateCmp !== 0) {
      return dateCmp;
    }
    return Number(a.id) - Number(b.id);
  });
}

function classifyNetMatch(netEft, batchNetAmount, lineCount, batchCount = 1) {
  const net = round2(Number(netEft));
  const batchNet = round2(Number(batchNetAmount));
  const absNet = round2(Math.abs(net));
  const lineLabel = lineCount === 1 ? "1 invoice line" : `${lineCount} invoice lines`;
  const batchLabel = batchCount === 1 ? "batch net" : `${batchCount} batch nets totaling`;

  if (net === 0) {
    return {
      status: BATCH_MATCH_STATUS.REVERSED,
      message: `Net EFT is zero across ${lineLabel} — credit was fully reversed.`,
    };
  }

  if (net < 0 && absNet === batchNet) {
    return {
      status: BATCH_MATCH_STATUS.MATCHED,
      message: `Net EFT credit ${batchNet} matches ${batchLabel} ${batchNet} across ${lineLabel}.`,
    };
  }

  if (net < 0 && absNet > batchNet) {
    return {
      status: BATCH_MATCH_STATUS.OVER_CREDITED,
      message: `Net EFT credit ${absNet} exceeds ${batchLabel} ${batchNet} across ${lineLabel}.`,
    };
  }

  if (net < 0 && absNet < batchNet) {
    return {
      status: BATCH_MATCH_STATUS.MISMATCH,
      message: `Net EFT credit ${absNet} is less than ${batchLabel} ${batchNet} across ${lineLabel}.`,
    };
  }

  return {
    status: BATCH_MATCH_STATUS.MISMATCH,
    message: `Net EFT ${net} does not match expected credit of -${batchNet} across ${lineLabel}.`,
  };
}

function buildSummary(
  invoiceTotal,
  scopedBatches,
  batchGroups,
  missingBatches,
  unmatchedLineGroups,
  ambiguousGroups
) {
  const matchedGroups = batchGroups.filter((group) => group.status === BATCH_MATCH_STATUS.MATCHED);
  const matchedBatches = matchedGroups.flatMap((group) => group.batches);
  const totalDeposit = matchedBatches.reduce((sum, batch) => sum + Number(batch.gross_amount), 0);
  const totalFee = matchedBatches.reduce((sum, batch) => sum + Number(batch.total_fee), 0);
  const totalCredit = matchedBatches.reduce((sum, batch) => sum + Number(batch.net_amount), 0);
  const totalMissingCredit = missingBatches.reduce((sum, batch) => sum + Number(batch.net_amount), 0);
  const normalizedInvoiceTotal = round2(Number(invoiceTotal || 0));

  const unmatchedLineCount = unmatchedLineGroups.reduce((sum, group) => sum + group.lines.length, 0);
  const ambiguousLineCount = ambiguousGroups.reduce((sum, group) => sum + group.lines.length, 0);
  const reconciledLineCount = batchGroups.reduce((sum, group) => sum + group.lines.length, 0);

  return {
    scopedBatchCount: scopedBatches.length,
    lineCount: reconciledLineCount + unmatchedLineCount + ambiguousLineCount,
    matchedCount: matchedBatches.length,
    missingFromInvoiceCount: missingBatches.length,
    reversedCount: batchGroups
      .filter((group) => group.status === BATCH_MATCH_STATUS.REVERSED)
      .reduce((sum, group) => sum + group.batches.length, 0),
    overCreditedCount: batchGroups
      .filter((group) => group.status === BATCH_MATCH_STATUS.OVER_CREDITED)
      .reduce((sum, group) => sum + group.batches.length, 0),
    mismatchCount: batchGroups
      .filter((group) => group.status === BATCH_MATCH_STATUS.MISMATCH)
      .reduce((sum, group) => sum + group.batches.length, 0),
    unmatchedLineCount,
    ambiguousLineCount,
    totalDeposit: round2(totalDeposit),
    totalFee: round2(totalFee),
    totalCredit: round2(totalCredit),
    invoiceTotal: normalizedInvoiceTotal,
    creditDiscrepancy: round2(totalMissingCredit),
    totalMissingCredit: round2(totalMissingCredit),
  };
}

function flattenMatchedPairs(batchGroups) {
  const matchedPairs = [];
  for (const group of batchGroups) {
    if (group.status !== BATCH_MATCH_STATUS.MATCHED) {
      continue;
    }
    for (const line of group.lines) {
      matchedPairs.push({
        line,
        batch: group.batch,
        batches: group.batches,
        invoiceAmount: round2(Math.abs(Number(group.netEft))),
        netEft: group.netEft,
      });
    }
  }
  return matchedPairs;
}

function flattenMismatchPairs(batchGroups) {
  return batchGroups
    .filter(
      (group) =>
        group.status === BATCH_MATCH_STATUS.MISMATCH ||
        group.status === BATCH_MATCH_STATUS.OVER_CREDITED ||
        group.status === BATCH_MATCH_STATUS.REVERSED
    )
    .flatMap((group) =>
      group.lines.map((line) => ({
        line,
        batch: group.batch,
        batches: group.batches,
        status: group.status,
        netEft: group.netEft,
        message: group.message,
      }))
    );
}

function flattenUnmatchedLines(unmatchedLineGroups) {
  return unmatchedLineGroups.flatMap((group) =>
    group.lines.map((line) => ({
      line,
      message: group.message,
    }))
  );
}

function flattenAmbiguousLines(ambiguousGroups) {
  return ambiguousGroups.flatMap((group) =>
    group.lines.map((line) => ({
      line,
      message: group.message,
    }))
  );
}

function reconcile({ invoice, invoiceTotal, lines, scopedBatches, matchableBatches }) {
  const resolvedInvoiceTotal =
    invoiceTotal != null ? invoiceTotal : invoice ? Number(invoice.invoice_total) : 0;
  const searchableBatches = matchableBatches || scopedBatches;
  const usedBatchIds = new Set();
  const lineGroups = groupLinesByBatchNumber(lines);
  const batchGroups = [];
  const unmatchedLineGroups = [];
  const ambiguousGroups = [];

  for (const [, groupLines] of lineGroups) {
    const netEft = computeNetEft(groupLines);
    const batchNum = normalizeBatchNumber(groupLines[0].batch_number);

    const candidates = searchableBatches.filter((batch) => {
      if (usedBatchIds.has(batch.id)) {
        return false;
      }
      return normalizeBatchNumber(batch.batch_number) === batchNum;
    });

    if (candidates.length === 0) {
      unmatchedLineGroups.push({
        batchNumber: batchNum,
        lines: groupLines,
        netEft,
        message: "No matching batch found in store for these invoice lines.",
      });
      continue;
    }

    const cluster = pickBatchesForNumber(candidates);
    const batchNetTotal = computeBatchNetTotal(cluster);
    const { status, message } = classifyNetMatch(
      netEft,
      batchNetTotal,
      groupLines.length,
      cluster.length
    );

    for (const batch of cluster) {
      usedBatchIds.add(batch.id);
    }

    batchGroups.push({
      batch: cluster[0],
      batches: cluster,
      batchNetTotal,
      lines: groupLines,
      netEft,
      status,
      message,
    });
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
    batchGroups,
    missingBatches.map((entry) => entry.batch),
    unmatchedLineGroups,
    ambiguousGroups
  );

  return {
    batchGroups,
    missingBatches,
    unmatchedLineGroups,
    ambiguousGroups,
    matchedPairs: flattenMatchedPairs(batchGroups),
    unmatchedLines: flattenUnmatchedLines(unmatchedLineGroups),
    ambiguousLines: flattenAmbiguousLines(ambiguousGroups),
    mismatchPairs: flattenMismatchPairs(batchGroups),
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
  computeNetEft,
  computeBatchNetTotal,
  pickBatchesForNumber,
  classifyNetMatch,
  BATCH_MATCH_STATUS,
  RECONCILE_DATE_BUFFER_DAYS,
};
