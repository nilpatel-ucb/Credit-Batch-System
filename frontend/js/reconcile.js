/**
 * Reconciliation layer — join invoice batch lines to normalized batch records.
 * Filters export to invoice-matched rows only; computes file-level summary.
 */
const Reconcile = (() => {
  const NormalizeRef =
    typeof Normalize !== "undefined"
      ? Normalize
      : typeof require !== "undefined"
        ? require("./normalize.js")
        : null;
  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function formatMoney(value) {
    return round2(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function stripLeadingZeros(batchNumber) {
    const stripped = String(batchNumber).replace(/^0+/, "");
    return stripped || "0";
  }

  function recordKey(record) {
    return [
      stripLeadingZeros(record.batch_number),
      round2(record.net_amount),
      record.batch_date instanceof Date
        ? record.batch_date.getTime()
        : new Date(record.batch_date).getTime(),
    ].join("|");
  }

  function findCandidates(batchRecords, batchLine, usedKeys) {
    const targetBatch = stripLeadingZeros(batchLine.batchNumber);
    const targetAmount = round2(Math.abs(batchLine.amount));

    return batchRecords.filter((record) => {
      if (stripLeadingZeros(record.batch_number) !== targetBatch) return false;
      if (round2(record.net_amount) !== targetAmount) return false;
      if (usedKeys.has(recordKey(record))) return false;
      return true;
    });
  }

  function reconcile(batchRecords, invoiceResult) {
    const warnings = [...(invoiceResult.warnings || [])];
    const matchedRecords = [];
    const usedKeys = new Set();

    for (const batchLine of invoiceResult.batchLines || []) {
      const candidates = findCandidates(batchRecords, batchLine, usedKeys);
      const label = `${batchLine.invoiceId} (${formatMoney(batchLine.amount)})`;

      if (candidates.length === 0) {
        warnings.push({
          message: `Invoice ${label}: no matching batch row`,
        });
        continue;
      }

      if (candidates.length > 1) {
        warnings.push({
          message: `Invoice ${label}: ambiguous — multiple batch rows with same # and amount`,
        });
        continue;
      }

      const [match] = candidates;
      usedKeys.add(recordKey(match));
      matchedRecords.push({
        ...match,
        invoice_id: batchLine.invoiceId,
        invoice_amount: round2(Math.abs(batchLine.amount)),
      });
    }

    const totalDeposit = matchedRecords.reduce(
      (sum, record) => sum + Number(record.gross_amount || 0),
      0
    );
    const totalFee = matchedRecords.reduce(
      (sum, record) => sum + Number(record.total_fee || 0),
      0
    );
    const totalCredit = totalDeposit - totalFee;
    const invoiceAmount =
      invoiceResult.summary && invoiceResult.summary.amount != null
        ? round2(invoiceResult.summary.amount)
        : null;
    const invoiceNumber = invoiceResult.summary
      ? invoiceResult.summary.invoiceNumber || ""
      : "";
    const credit =
      invoiceAmount != null ? round2(invoiceAmount - totalCredit) : null;

    const exportRows = NormalizeRef.toExportRows(matchedRecords);

    return {
      matchedRecords,
      exportRows,
      summary: {
        invoiceNumber,
        invoiceAmount,
        totalDeposit: round2(totalDeposit),
        totalFee: round2(totalFee),
        totalCredit: round2(totalCredit),
        credit,
      },
      warnings,
    };
  }

  return {
    reconcile,
    round2,
    stripLeadingZeros,
    recordKey,
  };
})();

if (typeof module !== "undefined") {
  module.exports = Reconcile;
}
