const { BATCH_MATCH_STATUS, round2 } = require("./reconcile");

/**
 * GREEN VALLEY USES A DIFFERENT RECONCILIATION STRATEGY.
 *
 * Unlike the default store logic, Green Valley is not reconciled by matching
 * each EFT line to a batch number. It uses an account-level control equation
 * from the EFT prenotification:
 *
 *   letter-prefixed invoice line total - numeric (no letter prefix) invoice total
 *     = EFT footer control amount after the dashed separator
 *
 * Letter-prefixed EFT rows are the batch settlements on the invoice. Their
 * signed amounts are totaled (as an absolute credit) for the left side.
 * Numeric/unprefixed invoice # rows are totaled into invoice_total.
 *
 * Cash batches tagged "expected on next invoice" stay excluded from matching.
 * A failed control equation is one aggregate amount mismatch; it does not
 * infer a specific missing batch. Keep this strategy separate so existing
 * store reconciliation is unchanged.
 */
function reconcileGreenValley({
  invoiceTotal,
  invoiceBalance,
  lines,
  scopedBatches,
  expectedBatches = [],
}) {
  const eligibleBatches = scopedBatches || [];
  const eftLines = lines || [];
  // Left side comes from letter-prefixed EFT invoice lines, not CStore CC nets.
  // Those cash nets differ slightly from EFT settlements; the footer control is
  // derived from the EFT document itself.
  const letterPrefixedTotal = round2(
    Math.abs(eftLines.reduce((sum, line) => sum + Number(line.amount), 0))
  );
  const numericInvoiceTotal = round2(Number(invoiceTotal) || 0);
  const calculatedControl = round2(letterPrefixedTotal - numericInvoiceTotal);
  const hasFooterControl =
    invoiceBalance !== null &&
    invoiceBalance !== undefined &&
    Number.isFinite(Number(invoiceBalance));
  const footerControl = hasFooterControl
    ? round2(Math.abs(Number(invoiceBalance)))
    : null;
  const controlDifference =
    footerControl === null ? calculatedControl : round2(calculatedControl - footerControl);
  const hasEligibleBatches = eligibleBatches.length > 0;
  const matched =
    hasEligibleBatches &&
    eftLines.length > 0 &&
    footerControl !== null &&
    controlDifference === 0;
  const status = matched ? BATCH_MATCH_STATUS.MATCHED : BATCH_MATCH_STATUS.MISMATCH;
  const message = matched
    ? `Green Valley aggregate control matches: ${letterPrefixedTotal} - ${numericInvoiceTotal} = ${footerControl}.`
    : footerControl === null
      ? "Green Valley EFT footer control amount is missing."
      : `Green Valley aggregate amount mismatch: ${letterPrefixedTotal} - ${numericInvoiceTotal} = ${calculatedControl}, expected ${footerControl}.`;

  const batchGroups =
    eligibleBatches.length === 0
      ? []
      : [
          {
            batch: eligibleBatches[0],
            batches: eligibleBatches,
            batchNetTotal: letterPrefixedTotal,
            lines: eftLines,
            netEft: numericInvoiceTotal,
            status,
            message,
            aggregate: true,
          },
        ];

  return {
    batchGroups,
    missingBatches: [],
    expectedOnNextInvoiceBatches: expectedBatches.map((batch) => ({
      batch,
      message: "Marked as expected on next invoice.",
    })),
    unmatchedLineGroups: [],
    ambiguousGroups: [],
    matchedPairs: [],
    unmatchedLines: [],
    ambiguousLines: [],
    mismatchPairs: [],
    aggregate: {
      strategy: "cstore_green_valley",
      batchNetTotal: letterPrefixedTotal,
      letterPrefixedTotal,
      numericInvoiceTotal,
      calculatedControl,
      footerControl,
      controlDifference,
      matched,
      message,
    },
    summary: {
      scopedBatchCount: eligibleBatches.length + expectedBatches.length,
      lineCount: eftLines.length,
      matchedCount: matched ? eligibleBatches.length : 0,
      missingFromInvoiceCount: 0,
      reversedCount: 0,
      overCreditedCount: 0,
      mismatchCount: matched || !hasEligibleBatches ? 0 : 1,
      unmatchedLineCount: 0,
      ambiguousLineCount: 0,
      totalDeposit: 0,
      totalFee: 0,
      totalCredit: matched ? letterPrefixedTotal : 0,
      invoiceTotal: numericInvoiceTotal,
      creditDiscrepancy: matched || !hasEligibleBatches ? 0 : Math.abs(controlDifference),
      totalMissingCredit: matched || !hasEligibleBatches ? 0 : Math.abs(controlDifference),
    },
  };
}

module.exports = { reconcileGreenValley };
