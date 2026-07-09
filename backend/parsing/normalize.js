/**
 * Normalization layer — maps raw template records into the fixed internal schema.
 */
const Normalize = (() => {
  function toISODate(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatDisplayDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }

  function stripLeadingZeros(batchNumber) {
    const stripped = String(batchNumber).replace(/^0+/, "");
    return stripped || "0";
  }

  function normalizeRecord(raw) {
    return {
      site_id: raw.site_id || "",
      batch_date:
        raw.batch_date instanceof Date ? raw.batch_date : new Date(raw.batch_date),
      batch_number: String(raw.batch_number),
      gross_amount: Number(raw.gross_amount),
      total_fee: Number(raw.total_fee),
      net_amount: Number(raw.net_amount),
    };
  }

  function toDbRecord(raw) {
    const record = normalizeRecord(raw);
    return {
      site_id: record.site_id,
      batch_date: toISODate(record.batch_date),
      batch_number: record.batch_number,
      gross_amount: record.gross_amount,
      total_fee: record.total_fee,
      net_amount: record.net_amount,
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

  function serializeForIpc(records) {
    return records.map((record) => ({
      site_id: record.site_id,
      batch_date: toISODate(record.batch_date),
      batch_number: record.batch_number,
      gross_amount: record.gross_amount,
      total_fee: record.total_fee,
      net_amount: record.net_amount,
    }));
  }

  return {
    normalizeAll,
    toDbRecord,
    toISODate,
    formatDisplayDate,
    stripLeadingZeros,
    serializeForIpc,
  };
})();

module.exports = Normalize;
