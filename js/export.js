/**
 * Output layer — normalized export rows → .xlsx file.
 * Do not modify when adding new PDF templates.
 */
const Export = (() => {
  const HEADERS = [
    "Date",
    "Batch#",
    "Credit",
    "Debit",
    "Total Card",
    "Total",
    "Fee",
    "Credit",
    "T. Deposit",
    "T. Fee",
  ];

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  function rowsToSheetData(exportRows) {
    const data = [HEADERS];

    exportRows.forEach((row) => {
      data.push([
        row.date,
        row.batchNumber,
        round2(row.credit),
        round2(row.debit),
        round2(row.totalCard),
        round2(row.total),
        round2(row.fee),
        round2(row.creditNet),
        row.tDeposit,
        row.tFee,
      ]);
    });

    return data;
  }

  function downloadWorkbook(exportRows, filename) {
    if (typeof XLSX === "undefined") {
      throw new Error("SheetJS (XLSX) is not loaded.");
    }

    const sheetData = rowsToSheetData(exportRows);
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

    const outputName =
      filename || `batch_report_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, outputName);
  }

  return {
    HEADERS,
    rowsToSheetData,
    downloadWorkbook,
  };
})();

if (typeof module !== "undefined") {
  module.exports = Export;
}
