/**
 * CStore Green Valley cash reconciliation template.
 *
 * Each daily row becomes one credit batch. The batch number is the row's
 * month/day advanced by one calendar day, and the Credit Card column is the
 * net amount. Gross and fee values are intentionally left at zero.
 */
const CStoreGreenValleyTemplate = (() => {
  const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{2,4})$/;
  const DAILY_TOTALS_RE =
    /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?:\s|$)/i;

  function parseDate(value) {
    const match = String(value).trim().match(DATE_RE);
    if (!match) return null;

    const [, month, day, rawYear] = match;
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    const date = new Date(year, Number(month) - 1, Number(day));
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== Number(month) - 1 ||
      date.getDate() !== Number(day)
    ) {
      return null;
    }
    return date;
  }

  function parseAmount(value) {
    return Number(String(value).replace(/,/g, ""));
  }

  function nextDayBatchNumber(date) {
    const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const month = String(nextDay.getMonth() + 1).padStart(2, "0");
    const day = String(nextDay.getDate()).padStart(2, "0");
    return `${month}${day}`;
  }

  function extractFromLines(lines, options = {}) {
    const records = [];
    const warnings = [];
    const siteId = String(options.siteId || "").trim();

    for (let index = 0; index < lines.length; index += 1) {
      const date = parseDate(lines[index]);
      if (!date) continue;

      let totalsIndex = index + 1;
      while (totalsIndex < lines.length && !String(lines[totalsIndex]).trim()) {
        totalsIndex += 1;
      }

      const totalsLine = String(lines[totalsIndex] || "").trim();
      const totalsMatch = totalsLine.match(DAILY_TOTALS_RE);
      if (!totalsMatch) {
        warnings.push({
          line: index + 1,
          message: "Daily date found without a following cash reconciliation totals row",
        });
        continue;
      }

      records.push({
        site_id: siteId,
        batch_date: date,
        batch_number: nextDayBatchNumber(date),
        gross_amount: 0,
        total_fee: 0,
        net_amount: parseAmount(totalsMatch[2]),
      });
      index = totalsIndex;
    }

    if (records.length === 0) {
      warnings.push({
        line: 0,
        message: "No CStore Green Valley daily reconciliation rows found",
      });
    }

    return { records, warnings };
  }

  function extract(pdfTextOrLines, options = {}) {
    const lines = Array.isArray(pdfTextOrLines)
      ? pdfTextOrLines
      : String(pdfTextOrLines).split("\n");
    return extractFromLines(lines, options);
  }

  return {
    extract,
    extractFromLines,
    nextDayBatchNumber,
  };
})();

module.exports = CStoreGreenValleyTemplate;
