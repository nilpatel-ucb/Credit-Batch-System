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

/**
 * When EFT credit is less than the full cluster, prefer rows whose nets
 * exactly equal the credited amount (or an exact subset). Unmatched rows
 * stay unused and become missing_from_invoice.
 */
function findExactCreditSubset(batches, targetAmount) {
  const target = round2(Number(targetAmount));
  if (target <= 0 || !batches || batches.length === 0) {
    return null;
  }

  const sorted = pickBatchesForNumber(batches);
  const exactSingles = sorted.filter((batch) => round2(Number(batch.net_amount)) === target);
  if (exactSingles.length > 0) {
    return [exactSingles[0]];
  }

  let best = null;
  const chosen = [];

  function dfs(start, remaining) {
    if (round2(remaining) === 0) {
      if (!best || chosen.length < best.length) {
        best = [...chosen];
      }
      return;
    }
    if (remaining < 0 || start >= sorted.length) {
      return;
    }
    if (best && chosen.length >= best.length) {
      return;
    }

    for (let i = start; i < sorted.length; i += 1) {
      const net = round2(Number(sorted[i].net_amount));
      chosen.push(sorted[i]);
      dfs(i + 1, round2(remaining - net));
      chosen.pop();
      if (best && best.length === 1) {
        return;
      }
    }
  }

  dfs(0, target);
  return best;
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

/** Under-credited mismatch shortfall only — never the already-received credit. */
function computeMismatchShortfall(batchNetTotal, netEft) {
  const batchNet = round2(Number(batchNetTotal) || 0);
  const net = round2(Number(netEft) || 0);
  if (batchNet <= 0) {
    return 0;
  }
  if (net >= 0) {
    return batchNet;
  }
  return round2(Math.max(0, batchNet - Math.abs(net)));
}

function sumMismatchShortfall(batchGroups) {
  return round2(
    (batchGroups || [])
      .filter((group) => group.status === BATCH_MATCH_STATUS.MISMATCH)
      .reduce(
        (sum, group) =>
          sum + computeMismatchShortfall(group.batchNetTotal, group.netEft),
        0
      )
  );
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
  const missingBatchCredit = missingBatches.reduce((sum, batch) => sum + Number(batch.net_amount), 0);
  const totalMissingCredit = round2(missingBatchCredit + sumMismatchShortfall(batchGroups));
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
    creditDiscrepancy: totalMissingCredit,
    totalMissingCredit,
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
    const classification = classifyNetMatch(
      netEft,
      batchNetTotal,
      groupLines.length,
      cluster.length
    );

    // Under-credited multi-row batch #: match an exact credit subset; leave the rest missing.
    const absCredit = round2(Math.abs(netEft));
    if (
      classification.status === BATCH_MATCH_STATUS.MISMATCH &&
      netEft < 0 &&
      absCredit < batchNetTotal &&
      cluster.length > 1
    ) {
      const matchedSubset = findExactCreditSubset(cluster, absCredit);
      if (matchedSubset && matchedSubset.length > 0) {
        for (const batch of matchedSubset) {
          usedBatchIds.add(batch.id);
        }
        batchGroups.push({
          batch: matchedSubset[0],
          batches: matchedSubset,
          batchNetTotal: computeBatchNetTotal(matchedSubset),
          lines: groupLines,
          netEft,
          status: BATCH_MATCH_STATUS.MATCHED,
          message: `Net EFT credit ${absCredit} matches ${
            matchedSubset.length === 1 ? "batch net" : `${matchedSubset.length} batch nets totaling`
          } ${absCredit} across ${
            groupLines.length === 1 ? "1 invoice line" : `${groupLines.length} invoice lines`
          }.`,
        });
        continue;
      }
    }

    for (const batch of cluster) {
      usedBatchIds.add(batch.id);
    }

    batchGroups.push({
      batch: cluster[0],
      batches: cluster,
      batchNetTotal,
      lines: groupLines,
      netEft,
      status: classification.status,
      message: classification.message,
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
  computeMismatchShortfall,
  sumMismatchShortfall,
  pickBatchesForNumber,
  findExactCreditSubset,
  classifyNetMatch,
  BATCH_MATCH_STATUS,
  RECONCILE_DATE_BUFFER_DAYS,
};
