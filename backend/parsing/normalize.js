/**
 * Normalization layer — maps raw template records into the fixed internal schema.
 */
const Normalize = (() => {
  function parseToLocalDate(value) {
    if (value instanceof Date) {
      return value;
    }
    const str = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const [year, month, day] = str.split("-").map(Number);
      return new Date(year, month - 1, day);
    }
    return new Date(value);
  }

  function toISODate(date) {
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
    const d = date instanceof Date ? date : parseToLocalDate(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatDisplayDate(date) {
    const d = date instanceof Date ? date : parseToLocalDate(date);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }

  function stripLeadingZeros(batchNumber) {
    const stripped = String(batchNumber).replace(/^0+/, "");
    return stripped || "0";
  }
  //raw is the raw record from the template
  function normalizeRecord(raw) {
    return {
      site_id: raw.site_id || "",
      batch_date: parseToLocalDate(raw.batch_date),
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

  function serializeInvoiceSummary(summary) {
    if (!summary) {
      return null;
    }
    return {
      invoiceNumber: String(summary.invoiceNumber),
      amount: Number(summary.amount),
      balance: summary.balance == null ? null : Number(summary.balance),
    };
  }

  function serializeInvoiceBatchLines(batchLines) {
    return (batchLines || []).map((line) => ({
      invoiceId: String(line.invoiceId),
      batchNumber: String(line.batchNumber),
      amount: Number(line.amount),
      invDate:
        line.invDate instanceof Date ? toISODate(line.invDate) : toISODate(line.invDate),
    }));
  }

  function serializeInvoiceForIpc(summary, batchLines) {
    return {
      summary: serializeInvoiceSummary(summary),
      batchLines: serializeInvoiceBatchLines(batchLines),
    };
  }

  function toInvoiceDbLine(line) {
    return {
      invoice_line_id: String(line.invoiceId),
      batch_number: String(line.batchNumber),
      amount: Number(line.amount),
      inv_date: line.invDate instanceof Date ? toISODate(line.invDate) : String(line.invDate),
    };
  }

  return {
    normalizeAll,
    toDbRecord,
    toISODate,
    formatDisplayDate,
    stripLeadingZeros,
    serializeForIpc,
    serializeInvoiceForIpc,
    serializeInvoiceSummary,
    serializeInvoiceBatchLines,
    toInvoiceDbLine,
  };
})();

module.exports = Normalize;
