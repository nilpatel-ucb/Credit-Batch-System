const fs = require("fs");
const path = require("path");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

const Ingestion = require("../js/ingestion.js");
const ChevronTemplate = require("../js/templates/chevron.js");
const Normalize = require("../js/normalize.js");

const PDF_PATH = "/Users/nilpatel/Downloads/credit batch_Redacted.pdf";

async function main() {
  const buffer = fs.readFileSync(PDF_PATH);
  const { lines, pageCount } = await Ingestion.extractLinesFromPdf(
    Uint8Array.from(buffer)
  );

  const { records: rawRecords, warnings } = ChevronTemplate.extractFromLines(lines);
  const normalized = Normalize.normalizeAll(rawRecords);
  const exportRows = Normalize.toExportRows(normalized);

  console.log("Pages:", pageCount);
  console.log("Raw records:", rawRecords.length);
  console.log("Warnings:", warnings.length);
  if (warnings.length) {
    warnings.slice(0, 5).forEach((w) => console.log("  -", w.message));
  }

  const spotChecks = [
    { batch: "857", credit: 3050.73, fee: 73.61, net: 2977.12 },
    { batch: "858", credit: 2493.67, fee: 57.58, net: 2436.09 },
    { batch: "863", credit: 3127.13, fee: 76.57, net: 3050.56 },
    { batch: "882", credit: 3046.27, fee: 67.64, net: 2978.63 },
  ];

  let passed = 0;
  for (const check of spotChecks) {
    const row = exportRows.find((r) => r.batchNumber === check.batch);
    if (!row) {
      console.error(`FAIL: batch ${check.batch} not found`);
      continue;
    }
    const ok =
      row.credit === check.credit &&
      row.fee === check.fee &&
      row.creditNet === check.net;
    console.log(
      `${ok ? "PASS" : "FAIL"}: batch ${check.batch} credit=${row.credit} fee=${row.fee} net=${row.creditNet}`
    );
    if (ok) passed++;
  }

  const batch9182 = exportRows.filter((r) => r.batchNumber === "9182");
  console.log(`batch 9182 rows: ${batch9182.length} (expect 2)`);

  const datedRows = exportRows.filter((r) => r.date);
  const firstDate = datedRows[0]?.date;
  const lastDate = datedRows[datedRows.length - 1]?.date;
  console.log(`Date range: ${firstDate} → ${lastDate} (expect 7/1/2026 → 7/6/2026)`);

  const dateBlankCount = exportRows.filter((r) => !r.date).length;
  console.log(`Rows with blank date (grouped): ${dateBlankCount}`);

  const emptyTDeposit = exportRows.every((r) => r.tDeposit === "" && r.tFee === "");
  console.log(`T. Deposit/T. Fee empty: ${emptyTDeposit ? "PASS" : "FAIL"}`);

  console.log(`\nExpected ~41 batches from pdf.js pages 2-11`);
  exportRows.slice(0, 3).forEach((r) =>
    console.log(`  ${r.date || "(blank)"} | ${r.batchNumber} | ${r.credit} | ${r.fee} | ${r.creditNet}`)
  );

  const allPass =
    passed === spotChecks.length &&
    batch9182.length === 2 &&
    firstDate === "7/1/2026" &&
    lastDate === "7/6/2026" &&
    emptyTDeposit &&
    rawRecords.length >= 40;

  console.log(`\nOverall: ${allPass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
