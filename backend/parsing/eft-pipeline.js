const { extractLinesFromPdf } = require("./ingestion");
const EftInvoiceTemplate = require("./templates/eft_invoice");
const Normalize = require("./normalize");

async function parseEftPdf(buffer) {
  const { lines, pageCount } = await extractLinesFromPdf(buffer);
  const { batchLines, summary, warnings } = EftInvoiceTemplate.extractFromLines(lines);
  const serialized = Normalize.serializeInvoiceForIpc(summary, batchLines);

  return {
    summary: serialized.summary,
    batchLines: serialized.batchLines,
    warnings,
    pageCount,
  };
}

module.exports = { parseEftPdf };
