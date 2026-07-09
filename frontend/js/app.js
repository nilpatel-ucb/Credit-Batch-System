const App = (() => {
  function formatPeriod(start, end) {
    if (!start || !end) return "";
    return `${StoreSelector.formatDate(start)} – ${StoreSelector.formatDate(end)}`;
  }

  async function renderBatches() {
    const tbody = document.querySelector("#batches-table tbody");
    const activeStore = StoreSelector.getActiveStore();

    if (!activeStore) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="8">Open a store to view batches</td></tr>';
      document.getElementById("batch-count-badge").textContent = "0";
      return;
    }

    const batches = await window.api.getBatches();
    document.getElementById("batch-count-badge").textContent = String(batches.length);

    if (batches.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="8">No batches yet — upload a Chevron PDF</td></tr>';
      return;
    }

    tbody.innerHTML = batches
      .map(
        (b) => `<tr>
          <td>${StoreSelector.formatDate(b.batch_date)}</td>
          <td>${StoreSelector.stripLeadingZeros(b.batch_number)}</td>
          <td class="num">${StoreSelector.formatMoney(b.gross_amount)}</td>
          <td class="num">${StoreSelector.formatMoney(b.total_fee)}</td>
          <td class="num">${StoreSelector.formatMoney(b.net_amount)}</td>
          <td>${b.site_id}</td>
          <td>${b.source_pdf || ""}</td>
          <td>${StoreSelector.formatDateTime(b.ingested_at)}</td>
        </tr>`
      )
      .join("");
  }

  async function renderInvoices() {
    const tbody = document.querySelector("#invoices-table tbody");
    const activeStore = StoreSelector.getActiveStore();

    if (!activeStore) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="7">Open a store to view invoices</td></tr>';
      document.getElementById("invoice-count-badge").textContent = "0";
      return;
    }

    const invoices = await window.api.getInvoices();
    document.getElementById("invoice-count-badge").textContent = String(invoices.length);

    if (invoices.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="7">No invoices yet — upload an EFT PDF</td></tr>';
      return;
    }

    tbody.innerHTML = invoices
      .map(
        (invoice) => `<tr>
          <td>${invoice.invoice_number}</td>
          <td class="num">${StoreSelector.formatMoney(invoice.invoice_total)}</td>
          <td class="num">${invoice.invoice_balance == null ? "" : StoreSelector.formatMoney(invoice.invoice_balance)}</td>
          <td>${formatPeriod(invoice.period_start, invoice.period_end)}</td>
          <td>${invoice.line_count}</td>
          <td>${invoice.pdf_filename || ""}</td>
          <td>${StoreSelector.formatDateTime(invoice.processed_at)}</td>
        </tr>`
      )
      .join("");
  }

  async function onStoreChange() {
    const active = !!StoreSelector.getActiveStore();
    BatchIngestUI.setStoreOpen(active);
    InvoiceIngestUI.setStoreOpen(active);
    await Promise.all([renderBatches(), renderInvoices()]);
  }

  async function onBatchIngestComplete() {
    await renderBatches();
    const activeStore = StoreSelector.getActiveStore();
    if (activeStore) {
      const result = await window.api.openStore(activeStore);
      StoreSelector.setActiveStoreInfo(result.name, result.site_id, result.batchCount);
    }
  }

  async function onInvoiceIngestComplete() {
    await renderInvoices();
  }

  function init() {
    StoreSelector.init({ onStoreChange });
    BatchIngestUI.init({ onIngestComplete: onBatchIngestComplete });
    InvoiceIngestUI.init({ onIngestComplete: onInvoiceIngestComplete });
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
