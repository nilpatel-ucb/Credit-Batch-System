/**
 * Chevron credit batch PDF template.
 * PDF lines → raw batch records. Only this file changes for new processor formats.
 */
const ChevronTemplate = (() => {
  const DETAIL_ROW_RE =
    /^(\d{5})\s+(\d{2}-\d{2}-\d{4})\s+(\d+)\s+(CHV|CC|DC)\b/i;
  const BATCH_TOTAL_RE =
    /^Batch\s+(?:Total\s+)?(\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2}|-)\s+([\d,]+\.\d{2}|-)\s+([\d,]+\.\d{2}|-)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?:\s+Total)?$/i;

  function preprocessLines(lines) {
    const merged = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) continue;

      if (/^about:blank/i.test(line) || /^\d+\/\d+$/i.test(line)) continue;
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/i.test(line)) continue;

      if (/^\d{4}$/.test(line) && merged.length > 0) {
        const year = line;
        merged[merged.length - 1] = merged[merged.length - 1].replace(
          /(\d{2}-\d{2}-)\s+/,
          `$1${year} `
        );
        continue;
      }

      if (/^Total$/i.test(line) && merged.length > 0 && /^Batch\b/i.test(merged[merged.length - 1])) {
        merged[merged.length - 1] = `${merged[merged.length - 1]} Total`;
        continue;
      }

      merged.push(line);
    }

    return merged.filter((line) => !isHeaderNoise(line));
  }

  function parseAmount(value) {
    return parseFloat(String(value).replace(/,/g, ""));
  }

  function parseDate(dateStr) {
    const [month, day, year] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function isHeaderNoise(line) {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^Site\s+Date\s+Batch/i.test(trimmed)) return true;
    if (/^Batch\s+Amount\s+Fuel/i.test(trimmed)) return true;
    if (/^Non\s+Other\s+Total\s+Net/i.test(trimmed)) return true;
    if (/^\(USD\)/i.test(trimmed)) return true;
    if (/^(Site|Batch|Date|Type|Count|Amount|Fuel|Non|Other|Fee|Net)$/i.test(trimmed)) {
      return true;
    }
    return false;
  }

  function recordFromBatchMatch(match, state, lineNumber) {
    if (!state.currentDate || !state.currentBatch) {
      state.warnings.push({
        line: lineNumber,
        message: "Batch Total found without preceding detail row context",
      });
      return null;
    }

    const [, , amount, , , , totalFee, netAmount] = match;
    return {
      site_id: state.currentSite || "",
      batch_date: state.currentDate,
      batch_number: state.currentBatch,
      gross_amount: parseAmount(amount),
      total_fee: parseAmount(totalFee),
      net_amount: parseAmount(netAmount),
    };
  }

  function parseLines(lines) {
    const state = {
      currentSite: null,
      currentDate: null,
      currentBatch: null,
      stopProcessing: false,
      records: [],
      warnings: [],
    };

    lines.forEach((rawLine, index) => {
      if (state.stopProcessing) return;

      const line = rawLine.trim();
      const lineNumber = index + 1;

      if (!line) return;

      if (/^Site\s+Total\b/i.test(line)) {
        state.stopProcessing = true;
        return;
      }

      const batchMatch = line.match(BATCH_TOTAL_RE);
      if (batchMatch) {
        const record = recordFromBatchMatch(batchMatch, state, lineNumber);
        if (record) state.records.push(record);
        return;
      }

      const detailMatch = line.match(DETAIL_ROW_RE);
      if (detailMatch) {
        const [, site, dateStr, batchNum] = detailMatch;
        state.currentSite = site;
        state.currentDate = parseDate(dateStr);
        state.currentBatch = batchNum;
      }
    });

    return {
      records: state.records,
      warnings: state.warnings,
    };
  }

  function extractFromLines(lines) {
    const processed = preprocessLines(lines);
    return parseLines(processed);
  }

  function extract(pdfTextOrLines) {
    const lines = Array.isArray(pdfTextOrLines)
      ? pdfTextOrLines
      : pdfTextOrLines.split("\n");
    return extractFromLines(lines);
  }

  return {
    extract,
    extractFromLines,
    preprocessLines,
    parseLines,
  };
})();

if (typeof module !== "undefined") {
  module.exports = ChevronTemplate;
}
