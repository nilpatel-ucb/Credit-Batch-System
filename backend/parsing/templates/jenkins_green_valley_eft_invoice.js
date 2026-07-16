/**
 * Jenkins Green Valley EFT prenotification invoice PDF template.
 * Letter-prefixed invoice rows only; batch number from Inv Date (MMDD).
 */

const JenkinsGreenValleyEftInvoiceTemplate = (() => {
  const INVOICE_LINE_RE =
    /^([A-Z0-9]+)\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2})\s+(-?[\d,]+\.\d{2})/i;
  const AMOUNT_TOKEN_RE = /-?[\d,]+\.\d{2}/g;

  function normalizeLine(line) {
    return String(line || "")
      .replace(/\u2212/g, "-")
      .replace(/\u2013/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isDashOnlyLine(line) {
    const trimmed = normalizeLine(line);
    return /^[\s-]+$/.test(trimmed) && /-{2,}/.test(trimmed);
  }

  function isInvoiceDataLine(line) {
    const trimmed = normalizeLine(line);
    if (/\d{2}\/\d{2}\/\d{2}/.test(trimmed)) return true;
    if (/^[A-Z]{2}[A-Z0-9]*\d*\s+\d{2}\//i.test(trimmed)) return true;
    if (/^\d{5,}\s+\d{2}\/\d{2}\//.test(trimmed)) return true;
    return false;
  }

  function isNoiseLine(line) {
    const trimmed = normalizeLine(line);
    if (!trimmed) return true;
    if (isDashOnlyLine(trimmed)) return true;
    if (AMOUNT_TOKEN_RE.test(trimmed)) return false;
    if (/^Invoice\s*#\s*Inv\s+Date/i.test(trimmed)) return true;
    if (/^\*{3}\s*End\s+Of\s+EFT/i.test(trimmed)) return true;
    if (/^Electronic\s+Funds\s+Transfer/i.test(trimmed)) return true;
    if (/^about:blank/i.test(trimmed)) return true;
    if (/^\d+\/\d+$/i.test(trimmed)) return true;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/i.test(trimmed)) return true;
    return false;
  }

  function parseAmount(value) {
    return parseFloat(String(value).replace(/,/g, ""));
  }

  function extractAmountTokens(line) {
    const normalized = normalizeLine(line).replace(/\(([\d,]+\.\d{2})\)/g, "-$1");
    const matches = normalized.match(AMOUNT_TOKEN_RE);
    return matches ? matches.map(parseAmount) : [];
  }

  function parseFooterBalanceFromLine(line) {
    if (isDashOnlyLine(line) || isInvoiceDataLine(line)) {
      return null;
    }

    const amounts = extractAmountTokens(line);
    if (amounts.length >= 2) {
      return amounts[amounts.length - 1];
    }
    return null;
  }

  function findFooterBalance(lines) {
    let balance = null;

    for (const rawLine of lines) {
      const line = normalizeLine(rawLine);
      if (isNoiseLine(line)) continue;

      const parsed = parseFooterBalanceFromLine(line);
      if (parsed !== null) {
        balance = parsed;
      }
    }

    if (balance !== null) {
      return balance;
    }

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = normalizeLine(lines[i]);
      if (isNoiseLine(line) || isInvoiceDataLine(line)) continue;

      const amounts = extractAmountTokens(line);
      if (amounts.length === 1) {
        if (Math.abs(amounts[0]) < 0.005) continue;
        return amounts[0];
      }
      if (amounts.length >= 2) {
        return amounts[amounts.length - 1];
      }
    }

    return null;
  }

  function parseInvoiceDate(dateStr) {
    const [month, day, yearPart] = dateStr.split("/").map(Number);
    const year = yearPart < 100 ? 2000 + yearPart : yearPart;
    return new Date(year, month - 1, day);
  }

  function extractBatchNumber(invDateStr) {
    const match = String(invDateStr || "").match(/^(\d{2})\/(\d{2})\/\d{2}$/);
    if (!match) return null;
    return `${match[1]}${match[2]}`;
  }

  function extractFromLines(lines) {
    const batchLines = [];
    const warnings = [];
    let summary = null;

    lines.forEach((rawLine, index) => {
      const line = normalizeLine(rawLine);
      const lineNumber = index + 1;

      if (isNoiseLine(line)) return;

      const match = line.match(INVOICE_LINE_RE);
      if (!match) return;

      const [, invoiceId, invDateStr, , amountStr] = match;

      if (/^[A-Za-z]/.test(invoiceId)) {
        const batchNumber = extractBatchNumber(invDateStr);
        if (!batchNumber) {
          warnings.push({
            line: lineNumber,
            message: `Could not extract batch number from Inv Date ${invDateStr}`,
          });
          return;
        }

        batchLines.push({
          invoiceId,
          batchNumber,
          amount: parseAmount(amountStr),
          invDate: parseInvoiceDate(invDateStr),
        });
        return;
      }

      summary = {
        invoiceNumber: invoiceId,
        amount: parseAmount(amountStr),
      };
    });

    const balance = findFooterBalance(lines);

    if (batchLines.length === 0) {
      warnings.push({
        line: 0,
        message: "No letter-prefixed batch lines found in invoice",
      });
    }

    if (summary && balance === null) {
      warnings.push({
        line: 0,
        message: "No footer balance subtotal found on invoice",
      });
    }

    if (summary) {
      summary.balance = balance;
    }

    return { batchLines, summary, warnings };
  }

  return {
    extractFromLines,
    extractBatchNumber,
    parseAmount,
    parseInvoiceDate,
  };
})();

module.exports = JenkinsGreenValleyEftInvoiceTemplate;
