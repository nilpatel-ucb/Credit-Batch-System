/**
 * Output layer — normalized export rows → .xlsx file.
 * Do not modify when adding new PDF templates.
 */
const Export = (() => {
  const BATCH_HEADERS = [
    "Date",
    "Batch#",
    "Credit",
    "Debit",
    "Total",
    "Fee",
    "Credit",
    "T. Deposit",
    "T. Fee",
  ];

  const SUMMARY_HEADERS = [
    "Total Deposit",
    "Total Fee",
    "Total Credit",
    "Invoice Number",
    "Invoice Amount",
    "Credit",
  ];

  const HEADERS = [...BATCH_HEADERS, ...SUMMARY_HEADERS];

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  function rowsToSheetData(exportRows) {
    const data = [HEADERS];
    const emptySummaryCells = SUMMARY_HEADERS.map(() => "");

    exportRows.forEach((row) => {
      data.push([
        row.date,
        row.batchNumber,
        round2(row.credit),
        round2(row.debit),
        round2(row.total),
        round2(row.fee),
        round2(row.creditNet),
        row.tDeposit,
        row.tFee,
        ...emptySummaryCells,
      ]);
    });

    if (exportRows.length > 0) {
      const firstDataRowNum = 2;
      const lastDataRowNum = exportRows.length + 1;
      const summaryRowNum = exportRows.length + 3;

      data.push([]);
      data.push([
        ...BATCH_HEADERS.map(() => ""),
        { t: "n", f: `SUM(E${firstDataRowNum}:E${lastDataRowNum})` },
        { t: "n", f: `SUM(F${firstDataRowNum}:F${lastDataRowNum})` },
        { t: "n", f: `J${summaryRowNum}-K${summaryRowNum}` },
        "",
        "",
        { t: "n", f: `N${summaryRowNum}-L${summaryRowNum}` },
      ]);
    }

    return data;
  }

  function downloadWorkbook(exportRows, filename, invoiceAmount, invoiceNumber) {
    if (typeof XLSX === "undefined") {
      throw new Error("SheetJS (XLSX) is not loaded.");
    }

    const sheetData = rowsToSheetData(exportRows);
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

    if (exportRows.length > 0) {
      const summaryRowNumber = exportRows.length + 3;

      if (invoiceNumber !== undefined && invoiceNumber !== null && invoiceNumber !== "") {
        worksheet[`M${summaryRowNumber}`] = { t: "s", v: String(invoiceNumber) };
      }

      if (invoiceAmount !== undefined && invoiceAmount !== null && invoiceAmount !== "") {
        worksheet[`N${summaryRowNumber}`] = {
          t: "n",
          v: round2(Number(invoiceAmount) || 0),
        };
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

    const outputName =
      filename || `batch_report_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, outputName);
  }

  return {
    HEADERS,
    BATCH_HEADERS,
    SUMMARY_HEADERS,
    rowsToSheetData,
    downloadWorkbook,
  };
})();

if (typeof module !== "undefined") {
  module.exports = Export;
}
