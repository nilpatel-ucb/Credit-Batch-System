/**
 * Jackson Energy EFT notification invoice PDF template.
 * Keeps only "Chevron Credit Cards" rows.
 */

const JacksonEftInvoiceTemplate = (() => {
  const CREDIT_CARD_LINE_RE =
    /^(\d{2}\/\d{2}\/\d{4})\s+.+?(\d+)-(\d{1,2}\/\d{1,2}\/\d{2,4})-(\d{1,2}\/\d{1,2}\/\d{2,4})\s*Chevron Credit Cards\s+([\d,]+\.\d{2}-?)/i;
  const REFERENCE_NO_RE = /Reference No\.:\s*([A-Z0-9-]+)/i;
  const TOTAL_DRAFT_RE = /Total Draft Amount:\s*([\d,]+\.\d{2}-?)/i;
  const CREDIT_CARDS_SUMMARY_RE = /^Chevron Credit Cards\s+([\d,]+\.\d{2}-?)\s*$/i;

  function normalizeLine(line) {
    return String(line || "")
      .replace(/\u2212/g, "-")
      .replace(/\u2013/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseAmount(value) {
    const raw = String(value).trim().replace(/,/g, "");
    if (!raw) return NaN;
    if (raw.endsWith("-")) {
      return -parseFloat(raw.slice(0, -1));
    }
    return parseFloat(raw);
  }

  function parseInvoiceDate(dateStr) {
    const [month, day, yearPart] = dateStr.split("/").map(Number);
    const year = yearPart < 100 ? 2000 + yearPart : yearPart;
    return new Date(year, month - 1, day);
  }

  function extractBatchNumber(referenceDigits) {
    const digits = String(referenceDigits || "");
    if (digits.length < 4) {
      return null;
    }
    return digits.slice(-4);
  }

  function extractFromLines(lines) {
    const batchLines = [];
    const warnings = [];
    let invoiceNumber = null;
    let amount = null;
    let balance = null;

    lines.forEach((rawLine, index) => {
      const line = normalizeLine(rawLine);
      const lineNumber = index + 1;
      if (!line) return;

      if (!invoiceNumber) {
        const refMatch = line.match(REFERENCE_NO_RE);
        if (refMatch) {
          invoiceNumber = refMatch[1];
        }
      }

      const draftMatch = line.match(TOTAL_DRAFT_RE);
      if (draftMatch) {
        balance = parseAmount(draftMatch[1]);
      }

      const summaryMatch = line.match(CREDIT_CARDS_SUMMARY_RE);
      if (summaryMatch) {
        amount = parseAmount(summaryMatch[1]);
        return;
      }

      const match = line.match(CREDIT_CARD_LINE_RE);
      if (!match) return;

      const [, invDateStr, referenceDigits, datePart1, datePart2, amountStr] = match;
      const batchNumber = extractBatchNumber(referenceDigits);
      if (!batchNumber) {
        warnings.push({
          line: lineNumber,
          message: `Could not extract batch number from reference ${referenceDigits}`,
        });
        return;
      }

      const invoiceId = `${referenceDigits}-${datePart1}-${datePart2}`;
      batchLines.push({
        invoiceId,
        batchNumber,
        amount: parseAmount(amountStr),
        invDate: parseInvoiceDate(invDateStr),
      });
    });

    if (batchLines.length === 0) {
      warnings.push({
        line: 0,
        message: 'No "Chevron Credit Cards" rows found in Jackson EFT invoice',
      });
    }

    if (amount === null && batchLines.length > 0) {
      amount =
        Math.round(batchLines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
    }

    if (!invoiceNumber) {
      warnings.push({
        line: 0,
        message: "No Reference No. found on Jackson EFT invoice",
      });
    }

    if (balance === null) {
      warnings.push({
        line: 0,
        message: "No Total Draft Amount found on Jackson EFT invoice",
      });
    }

    const summary = invoiceNumber
      ? {
          invoiceNumber,
          amount: amount == null ? 0 : amount,
          balance,
        }
      : null;

    return { batchLines, summary, warnings };
  }

  return {
    extractFromLines,
    parseAmount,
    parseInvoiceDate,
    extractBatchNumber,
  };
})();

module.exports = JacksonEftInvoiceTemplate;
