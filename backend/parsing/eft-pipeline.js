const { extractLinesFromPdf } = require("./ingestion");
const EftInvoiceTemplate = require("./templates/eft_invoice");
const JacksonEftInvoiceTemplate = require("./templates/jackson_eft_invoice");
const Normalize = require("./normalize");

function createParseEftPdf(template) {
  return async function parseEftPdf(buffer) {
    const { lines, pageCount } = await extractLinesFromPdf(buffer);
    const { batchLines, summary, warnings } = template.extractFromLines(lines);
    const serialized = Normalize.serializeInvoiceForIpc(summary, batchLines);

    return {
      summary: serialized.summary,
      batchLines: serialized.batchLines,
      warnings,
      pageCount,
    };
  };
}

const parseEftPdf = createParseEftPdf(EftInvoiceTemplate);
const parseJacksonEftPdf = createParseEftPdf(JacksonEftInvoiceTemplate);

module.exports = { parseEftPdf, parseJacksonEftPdf, createParseEftPdf };
