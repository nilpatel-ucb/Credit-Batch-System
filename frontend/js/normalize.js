/**
 * Normalization layer — maps raw template records into the fixed internal schema.
 * This contract does not change when new PDF templates are added.
 */
const Normalize = (() => {
  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatDisplayDate(date) {
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  }

  function stripLeadingZeros(batchNumber) {
    const stripped = String(batchNumber).replace(/^0+/, "");
    return stripped || "0";
  }

  function normalizeRecord(raw) {
    return {
      site_id: raw.site_id || "",
      batch_date: raw.batch_date instanceof Date ? raw.batch_date : new Date(raw.batch_date),
      batch_number: String(raw.batch_number),
      gross_amount: Number(raw.gross_amount),
      total_fee: Number(raw.total_fee),
      net_amount: Number(raw.net_amount),
    };
  }

  function compareRecords(a, b) {
    const dateA = a.batch_date.getTime();
    const dateB = b.batch_date.getTime();
    if (dateA !== dateB) return dateA - dateB;

    const numA = parseInt(a.batch_number, 10);
    const numB = parseInt(b.batch_number, 10);
    if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) {
      return numA - numB;
    }
    return String(a.batch_number).localeCompare(String(b.batch_number));
  }

  function normalizeAll(rawRecords) {
    const records = rawRecords.map(normalizeRecord);
    records.sort(compareRecords);
    return records;
  }

  function toExportRows(records) {
    let lastDateKey = null;

    return records.map((record) => {
      const dateKey = toISODate(record.batch_date);
      const showDate = dateKey !== lastDateKey;
      lastDateKey = dateKey;

      return {
        date: showDate ? formatDisplayDate(record.batch_date) : "",
        batchNumber: stripLeadingZeros(record.batch_number),
        credit: record.gross_amount,
        debit: 0,
        totalCard: record.gross_amount,
        total: record.gross_amount,
        fee: record.total_fee,
        creditNet: record.net_amount,
        tDeposit: "",
        tFee: "",
      };
    });
  }

  return {
    normalizeAll,
    toExportRows,
    toISODate,
    formatDisplayDate,
    stripLeadingZeros,
  };
})();

if (typeof module !== "undefined") {
  module.exports = Normalize;
}
