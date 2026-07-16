const { extractLinesFromPdf } = require("./ingestion");
const CStoreGreenValleyTemplate = require("./templates/cstore_green_valley");
const Normalize = require("./normalize");

async function parseCStoreGreenValleyPdf(buffer, options = {}) {
  const { lines, pageCount } = await extractLinesFromPdf(buffer);
  const { records, warnings } = CStoreGreenValleyTemplate.extractFromLines(lines, options);
  const normalized = Normalize.normalizeAll(records);

  return {
    records: Normalize.serializeForIpc(normalized),
    warnings,
    pageCount,
  };
}

module.exports = { parseCStoreGreenValleyPdf };
