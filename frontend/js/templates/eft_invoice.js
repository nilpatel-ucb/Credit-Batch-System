/**
 * EFT Prenotification invoice PDF template.
 * PDF lines → invoice batch lines + file-level summary.
 */
const EftInvoiceTemplate = (() => {
  const INVOICE_LINE_RE =
    /^([A-Z0-9]+)\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2})\s+(-?[\d,]+\.\d{2})/i;
  const AA_BATCH_ID_RE = /^[A-Za-z]+(\d+)$/;

  function parseAmount(value) {
    return parseFloat(String(value).replace(/,/g, ""));
  }

  function parseInvDate(dateStr) {
    const [month, day, year] = dateStr.split("/").map(Number);
    const fullYear = year < 100 ? 2000 + year : year;
    return new Date(fullYear, month - 1, day);
  }

  function isNoiseLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^invoice\s*#/i.test(trimmed)) return true;
    if (/^-{3,}/.test(trimmed)) return true;
    if (/^\*{3}\s*end of eft/i.test(trimmed)) return true;
    if (/^electronic funds transfer/i.test(trimmed)) return true;
    if (/^prenotification only/i.test(trimmed)) return true;
    if (/^remit to:/i.test(trimmed)) return true;
    if (/^this is a confirmation/i.test(trimmed)) return true;
    if (/^the total payment amount/i.test(trimmed)) return true;
    if (/^page\s+\d+/i.test(trimmed)) return true;
    if (/^--\s*\d+\s+of\s+\d+/i.test(trimmed)) return true;
    return false;
  }

  function extractBatchNumber(invoiceId) {
    const match = String(invoiceId).match(AA_BATCH_ID_RE);
    return match ? match[1] : null;
  }

  function extractFromLines(lines) {
    const batchLines = [];
    let summary = null;
    const warnings = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (isNoiseLine(line)) continue;

      const match = line.match(INVOICE_LINE_RE);
      if (!match) continue;

      const [, invoiceId, invDateStr, , amountStr] = match;
      const amount = parseAmount(amountStr);

      if (/^AA/i.test(invoiceId)) {
        const batchNumber = extractBatchNumber(invoiceId);
        if (!batchNumber) {
          warnings.push({
            line: i + 1,
            message: `Could not extract batch number from invoice id "${invoiceId}"`,
          });
          continue;
        }

        batchLines.push({
          invoiceId,
          batchNumber,
          amount,
          invDate: parseInvDate(invDateStr),
        });
        continue;
      }

      summary = {
        invoiceNumber: invoiceId,
        amount,
      };
    }

    if (!batchLines.length) {
      warnings.push({
        line: 0,
        message: "No AA-prefixed invoice batch lines found in this PDF",
      });
    }

    return { batchLines, summary, warnings };
  }

  return {
    extractFromLines,
    parseAmount,
    extractBatchNumber,
  };
})();

if (typeof module !== "undefined") {
  module.exports = EftInvoiceTemplate;
}
