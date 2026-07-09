const { extractLinesFromPdf } = require("./ingestion");
const ChevronTemplate = require("./templates/chevron");
const Normalize = require("./normalize");

async function parseChevronPdf(buffer) {
  const { lines, pageCount } = await extractLinesFromPdf(buffer);
  const { records, warnings } = ChevronTemplate.extractFromLines(lines);
  const normalized = Normalize.normalizeAll(records);
  return {
    records: Normalize.serializeForIpc(normalized),
    warnings,
    pageCount,
  };
}

module.exports = { parseChevronPdf };
