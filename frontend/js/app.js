const App = (() => {
  let selectedInvoiceId = null;
  let selectedBatchGroupIndex = null;
  let cachedBatchGroups = [];
  let cachedBatches = [];
  let cachedInvoices = [];

  function formatPeriod(start, end) {
    if (!start || !end) return "";
    return `${StoreSelector.formatDate(start)} – ${StoreSelector.formatDate(end)}`;
  }

  function batchGroupKey(batch) {
    return `${batch.source_pdf || ""}\x1e${batch.ingested_at}`;
  }

  function groupBatches(batches) {
    const groups = new Map();

    for (const batch of batches) {
      const key = batchGroupKey(batch);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          source_pdf: batch.source_pdf || "",
          ingested_at: batch.ingested_at,
          batches: [],
        });
      }
      groups.get(key).batches.push(batch);
    }

    return [...groups.values()].sort((a, b) => b.ingested_at.localeCompare(a.ingested_at));
  }

  function findGroupIndexForBatch(batch) {
    return cachedBatchGroups.findIndex(
      (group) =>
        group.source_pdf === (batch.source_pdf || "") &&
        group.ingested_at === batch.ingested_at
    );
  }

  function renderBatchLineRows(batches) {
    return batches
      .map(
        (b) => `<tr data-batch-id="${b.id}">
          <td class="mono">${StoreSelector.formatDate(b.batch_date)}</td>
          <td class="mono">${StoreSelector.stripLeadingZeros(b.batch_number)}</td>
          <td class="num">${StoreSelector.formatMoney(b.gross_amount)}</td>
          <td class="num">${StoreSelector.formatMoney(b.total_fee)}</td>
          <td class="num">${StoreSelector.formatMoney(b.net_amount)}</td>
          <td class="mono">${b.site_id}</td>
          <td><button type="button" class="danger batch-delete-btn" data-batch-id="${b.id}" data-batch-number="${b.batch_number}" data-batch-date="${b.batch_date}">Delete</button></td>
        </tr>`
      )
      .join("");
  }

  function clearInvoiceLinesPanel() {
    selectedInvoiceId = null;
    document.getElementById("invoice-lines-panel").hidden = true;
    document.getElementById("invoice-lines-delete-btn").hidden = true;
    document.querySelectorAll("#inv-grid .inv-card.open").forEach((card) => {
      card.classList.remove("open");
    });
    document.querySelectorAll("#invoices-table tbody tr.selected").forEach((row) => {
      row.classList.remove("selected");
    });
  }

  function clearBatchLinesPanel() {
    selectedBatchGroupIndex = null;
    document.getElementById("batch-lines-panel").hidden = true;
    document.getElementById("delete-batch-source-btn").hidden = true;
    document.querySelectorAll("#batches-table tbody tr.selected").forEach((row) => {
      row.classList.remove("selected");
    });
  }

  async function showInvoiceLines(invoiceId, invoiceNumber) {
    selectedInvoiceId = invoiceId;
    const lines = await window.api.getInvoiceLines(invoiceId);
    document.getElementById("invoice-lines-title").textContent = invoiceNumber;
    document.getElementById("invoice-lines-delete-btn").hidden = false;

    const tbody = document.querySelector("#invoice-lines-table tbody");
    const cardBody = document.querySelector(
      `#inv-grid .inv-card[data-invoice-id="${invoiceId}"] .inv-body-table`
    );

    const rowsHtml =
      lines.length === 0
        ? '<tr class="empty-row"><td colspan="5">No lines found for this invoice</td></tr>'
        : lines
            .map((line) => {
              const [cls, label] = DashboardUI.statusPill(line.match_status);
              return `<tr>
                <td class="mono">${line.invoice_line_id}</td>
                <td class="mono">${StoreSelector.stripLeadingZeros(line.batch_number)}</td>
                <td class="mono">${StoreSelector.formatDate(line.inv_date)}</td>
                <td class="num">${StoreSelector.formatMoney(line.amount)}</td>
                <td><span class="pill ${cls}">${label}</span></td>
              </tr>`;
            })
            .join("");

    tbody.innerHTML = rowsHtml;
    if (cardBody) {
      cardBody.innerHTML = rowsHtml;
    }

    document.getElementById("invoice-lines-panel").hidden = true;

    document.querySelectorAll("#inv-grid .inv-card").forEach((card) => {
      const open = Number(card.dataset.invoiceId) === invoiceId;
      card.classList.toggle("open", open);
    });

    const compatRow = document.querySelector(
      `#invoices-table tbody tr[data-invoice-id="${invoiceId}"]`
    );
    document.querySelectorAll("#invoices-table tbody tr").forEach((row) => {
      row.classList.toggle("selected", row === compatRow);
    });
  }

  function showBatchLines(groupIndex) {
    selectedBatchGroupIndex = groupIndex;
    const group = cachedBatchGroups[groupIndex];
    const title = group ? group.source_pdf || "(unknown source)" : "—";
    document.getElementById("batch-lines-title").textContent = title;
    document.getElementById("delete-batch-source-btn").hidden = !group;

    const tbody = document.querySelector("#batch-lines-table tbody");

    if (!group || group.batches.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="7">No batches found for this upload</td></tr>';
    } else {
      const sorted = [...group.batches].sort((a, b) => {
        const dateCmp = String(a.batch_date).localeCompare(String(b.batch_date));
        if (dateCmp !== 0) return dateCmp;
        return String(a.batch_number).localeCompare(String(b.batch_number));
      });
      tbody.innerHTML = renderBatchLineRows(sorted);
    }

    document.getElementById("batch-lines-panel").hidden = false;

    document.querySelectorAll("#batches-table tbody tr.batch-row").forEach((row) => {
      const idx = Number(row.dataset.batchGroupIndex);
      row.classList.toggle("selected", idx === groupIndex);
    });
  }

  function syncTabCounts(batchCount, invoiceCount, reconCount) {
    DashboardUI.updateCounts({
      batches: batchCount,
      invoices: invoiceCount,
      recons: reconCount ?? Number(document.getElementById("ct-recons")?.textContent || 0),
    });
  }

  async function renderBatches() {
    const tbody = document.querySelector("#batches-table tbody");
    const activeStore = StoreSelector.getActiveStore();
    const meta = document.getElementById("batch-meta");

    if (!activeStore) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="10">Open a store to view batches</td></tr>';
      document.getElementById("batch-count-badge").textContent = "0";
      cachedBatchGroups = [];
      cachedBatches = [];
      clearBatchLinesPanel();
      DashboardUI.updateGaugeFromBatches([]);
      if (meta) meta.textContent = "";
      syncTabCounts(0, cachedInvoices.length);
      return;
    }

    const batches = await window.api.getBatches();
    cachedBatches = batches;
    document.getElementById("batch-count-badge").textContent = String(batches.length);
    cachedBatchGroups = groupBatches(batches);
    DashboardUI.updateGaugeFromBatches(batches);
    if (meta) {
      meta.textContent = `${batches.length} rows · ${activeStore}.db`;
    }
    syncTabCounts(batches.length, cachedInvoices.length);

    if (batches.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="10">No batches yet — upload a Chevron PDF</td></tr>';
      clearBatchLinesPanel();
      return;
    }

    const stillSelected =
      selectedBatchGroupIndex != null &&
      selectedBatchGroupIndex >= 0 &&
      selectedBatchGroupIndex < cachedBatchGroups.length;
    if (!stillSelected) {
      clearBatchLinesPanel();
    }

    let lastDate = null;
    tbody.innerHTML = batches
      .map((b) => {
        const showDate = b.batch_date !== lastDate ? StoreSelector.formatDate(b.batch_date) : "";
        lastDate = b.batch_date;
        const [cls, label] = DashboardUI.statusPill(b.match_status);
        const groupIndex = findGroupIndexForBatch(b);
        return `<tr class="batch-row" data-batch-id="${b.id}" data-batch-group-index="${groupIndex}">
          <td class="mono">${showDate}</td>
          <td class="mono">${StoreSelector.stripLeadingZeros(b.batch_number)}</td>
          <td class="num">${StoreSelector.formatMoney(b.gross_amount)}</td>
          <td class="num">${StoreSelector.formatMoney(b.total_fee)}</td>
          <td class="num">${StoreSelector.formatMoney(b.net_amount)}</td>
          <td><span class="pill ${cls}">${label}</span></td>
          <td class="mono">${b.invoice_line_id || "—"}</td>
          <td class="num">${
            b.invoice_amount != null ? StoreSelector.formatMoney(b.invoice_amount) : "—"
          }</td>
          <td class="mono" style="color:var(--ink-3);font-size:11.5px">${b.source_pdf || "—"}</td>
          <td>
            <button type="button" class="danger batch-delete-btn" data-batch-id="${b.id}" data-batch-number="${b.batch_number}" data-batch-date="${b.batch_date}">Delete</button>
          </td>
        </tr>`;
      })
      .join("");

    if (selectedBatchGroupIndex != null && cachedBatchGroups[selectedBatchGroupIndex]) {
      showBatchLines(selectedBatchGroupIndex);
    }
  }

  async function renderInvoices() {
    const grid = document.getElementById("inv-grid");
    const compatBody = document.querySelector("#invoices-table tbody");
    const activeStore = StoreSelector.getActiveStore();

    if (!activeStore) {
      grid.innerHTML = '<p class="empty-hint">Open a store to view invoices</p>';
      compatBody.innerHTML = "";
      document.getElementById("invoice-count-badge").textContent = "0";
      cachedInvoices = [];
      ReconcileUI.resetView();
      clearInvoiceLinesPanel();
      syncTabCounts(cachedBatches.length, 0);
      return;
    }

    const invoices = await window.api.getInvoices();
    cachedInvoices = invoices;
    document.getElementById("invoice-count-badge").textContent = String(invoices.length);
    syncTabCounts(cachedBatches.length, invoices.length);

    if (invoices.length === 0) {
      grid.innerHTML = '<p class="empty-hint">No invoices yet — upload an EFT PDF</p>';
      compatBody.innerHTML = "";
      clearInvoiceLinesPanel();
      return;
    }

    const stillSelected = invoices.some((invoice) => invoice.id === selectedInvoiceId);
    if (!stillSelected) {
      clearInvoiceLinesPanel();
    }

    compatBody.innerHTML = invoices
      .map(
        (invoice) => `<tr class="invoice-row" data-invoice-id="${invoice.id}" data-invoice-number="${invoice.invoice_number}">
          <td>${invoice.invoice_number}</td>
          <td>
            <button type="button" class="danger invoice-delete-btn" data-invoice-id="${invoice.id}" data-invoice-number="${invoice.invoice_number}" data-pdf-filename="${invoice.pdf_filename || ""}">Delete</button>
          </td>
        </tr>`
      )
      .join("");

    grid.innerHTML = invoices
      .map((invoice) => {
        const open = selectedInvoiceId === invoice.id ? "open" : "";
        return `<div class="card inv-card lift ${open}" data-invoice-id="${invoice.id}" data-invoice-number="${invoice.invoice_number}">
          <div class="inv-head" data-invoice-toggle="${invoice.id}">
            <div class="ic" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M7 3h8l4 4v14H7V3zM15 3v4h4M10 12h6M10 16h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div>
              <h3>Invoice ${invoice.invoice_number}</h3>
              <p>${invoice.pdf_filename || "—"} · ${formatPeriod(invoice.period_start, invoice.period_end) || "—"} · ${invoice.line_count} lines</p>
            </div>
            <div class="inv-total">
              <div class="k">Invoice total</div>
              <div class="v">${StoreSelector.formatMoney(invoice.invoice_total)}</div>
            </div>
            <button type="button" class="danger invoice-delete-btn" data-invoice-id="${invoice.id}" data-invoice-number="${invoice.invoice_number}" data-pdf-filename="${invoice.pdf_filename || ""}">Delete</button>
            <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="inv-body">
            <table>
              <thead>
                <tr>
                  <th>Line ID</th>
                  <th>Batch #</th>
                  <th>Date</th>
                  <th class="num">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody class="inv-body-table">
                <tr class="empty-row"><td colspan="5">Expand to load lines</td></tr>
              </tbody>
            </table>
          </div>
        </div>`;
      })
      .join("");

    if (selectedInvoiceId != null) {
      const selected = invoices.find((invoice) => invoice.id === selectedInvoiceId);
      if (selected) {
        await showInvoiceLines(selected.id, selected.invoice_number);
      }
    }
  }

  async function onStoreChange() {
    clearInvoiceLinesPanel();
    clearBatchLinesPanel();
    ReconcileUI.resetView();
    const active = !!StoreSelector.getActiveStore();
    BatchIngestUI.setStoreOpen(active);
    InvoiceIngestUI.setStoreOpen(active);
    await Promise.all([renderBatches(), renderInvoices()]);
    if (active) {
      await ReconcileUI.onStoreOpen();
    } else {
      DashboardUI.updateBrand(null);
      DashboardUI.updateGaugeFromBatches([]);
    }
  }

  async function refreshAfterBatchChange() {
    await renderBatches();
    await renderInvoices();
    const activeStore = StoreSelector.getActiveStore();
    if (activeStore) {
      const result = await window.api.openStore(activeStore);
      StoreSelector.setActiveStoreInfo(result.name, result.site_id, result.batchCount);
    }
    await ReconcileUI.refresh();
    if (selectedInvoiceId != null) {
      const invoice = cachedInvoices.find((inv) => inv.id === selectedInvoiceId);
      const invoiceNumber = invoice ? invoice.invoice_number : "—";
      await showInvoiceLines(selectedInvoiceId, invoiceNumber);
    }
  }

  async function onBatchIngestComplete() {
    DashboardUI.closeAddPdfModal();
    await refreshAfterBatchChange();
  }

  async function onManualBatchAdded(result) {
    await refreshAfterBatchChange();
    if (result?.reconciliation) {
      ReconcileUI.render(result.reconciliation);
    }
  }

  async function onInvoiceIngestComplete(result) {
    if (result && result.invoiceId) {
      DashboardUI.closeAddPdfModal();
    }
    await renderInvoices();
    await renderBatches();

    if (result && result.invoiceId) {
      const invoiceNumber =
        result.reconciliation?.invoiceNumber ||
        cachedInvoices.find((inv) => inv.id === result.invoiceId)?.invoice_number;
      if (invoiceNumber) {
        await showInvoiceLines(result.invoiceId, invoiceNumber);
      }
      if (result.reconciliation) {
        ReconcileUI.render(result.reconciliation);
        DashboardUI.showPanel("recons");
      }
      await ReconcileUI.refresh();
    }
  }

  async function onReconcileComplete() {
    await Promise.all([renderBatches(), renderInvoices()]);
    await ReconcileUI.refresh();
    if (selectedInvoiceId != null) {
      const invoice = cachedInvoices.find((inv) => inv.id === selectedInvoiceId);
      const invoiceNumber = invoice ? invoice.invoice_number : "—";
      await showInvoiceLines(selectedInvoiceId, invoiceNumber);
    }
  }

  async function deleteInvoice(invoiceId, invoiceNumber, pdfFilename) {
    const label = pdfFilename || `invoice ${invoiceNumber}`;
    const confirmed = window.confirm(`Delete "${label}" and all of its invoice lines? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await window.api.deleteInvoice(invoiceId);
      clearInvoiceLinesPanel();
      await Promise.all([renderInvoices(), renderBatches()]);
      await ReconcileUI.refresh();
    } catch (err) {
      window.alert(err.message || "Failed to delete invoice.");
    }
  }

  function initInvoiceLineSelection() {
    document.getElementById("collapse-invoice-lines-btn").addEventListener("click", () => {
      clearInvoiceLinesPanel();
    });

    document.getElementById("invoice-lines-delete-btn").addEventListener("click", async () => {
      if (selectedInvoiceId == null) return;
      const invoice = cachedInvoices.find((inv) => inv.id === selectedInvoiceId);
      await deleteInvoice(
        selectedInvoiceId,
        invoice?.invoice_number || "—",
        invoice?.pdf_filename || ""
      );
    });

    document.getElementById("inv-grid").addEventListener("click", async (event) => {
      const deleteBtn = event.target.closest(".invoice-delete-btn");
      if (deleteBtn) {
        event.stopPropagation();
        await deleteInvoice(
          Number(deleteBtn.dataset.invoiceId),
          deleteBtn.dataset.invoiceNumber,
          deleteBtn.dataset.pdfFilename
        );
        return;
      }

      const head = event.target.closest("[data-invoice-toggle]");
      if (!head) return;

      const invoiceId = Number(head.dataset.invoiceToggle);
      const card = head.closest(".inv-card");
      const invoiceNumber = card?.dataset.invoiceNumber || "—";

      if (selectedInvoiceId === invoiceId) {
        clearInvoiceLinesPanel();
        return;
      }

      await showInvoiceLines(invoiceId, invoiceNumber);
    });
  }

  async function refreshAfterBatchDeletion(batchCount, options = {}) {
    const activeStore = StoreSelector.getActiveStore();
    if (activeStore) {
      StoreSelector.setActiveStoreInfo(activeStore, StoreSelector.getActiveSiteId(), batchCount);
    }

    const preserveGroup = options.preserveGroup || null;
    if (!preserveGroup) {
      clearBatchLinesPanel();
    }

    await renderBatches();

    if (preserveGroup) {
      const groupIndex = cachedBatchGroups.findIndex(
        (group) =>
          group.source_pdf === preserveGroup.source_pdf &&
          group.ingested_at === preserveGroup.ingested_at
      );
      if (groupIndex >= 0) {
        showBatchLines(groupIndex);
      } else {
        clearBatchLinesPanel();
      }
    }

    if (selectedInvoiceId != null) {
      const invoice = cachedInvoices.find((inv) => inv.id === selectedInvoiceId);
      const invoiceNumber = invoice ? invoice.invoice_number : "—";
      await showInvoiceLines(selectedInvoiceId, invoiceNumber);
    }
  }

  async function deleteBatch(batchId, batchNumber, batchDate) {
    const label = `batch ${StoreSelector.stripLeadingZeros(batchNumber)} on ${StoreSelector.formatDate(batchDate)}`;
    const confirmed = window.confirm(`Delete ${label}? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const group =
        selectedBatchGroupIndex != null ? cachedBatchGroups[selectedBatchGroupIndex] : null;
      const preserveGroup = group
        ? { source_pdf: group.source_pdf, ingested_at: group.ingested_at }
        : null;
      const result = await window.api.deleteBatch(batchId);
      await refreshAfterBatchDeletion(result.batchCount, { preserveGroup });
      await ReconcileUI.refresh();
    } catch (err) {
      window.alert(err.message || "Failed to delete batch.");
    }
  }

  async function deleteBatchSource(groupIndex) {
    const group = cachedBatchGroups[groupIndex];
    if (!group) return;

    const label = group.source_pdf || "(unknown source)";
    const confirmed = window.confirm(
      `Delete all ${group.batches.length} batches from "${label}"? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const result = await window.api.deleteBatchSource(group.source_pdf, group.ingested_at);
      await refreshAfterBatchDeletion(result.batchCount);
      await ReconcileUI.refresh();
    } catch (err) {
      window.alert(err.message || "Failed to delete upload.");
    }
  }

  function initBatchLineSelection() {
    document.getElementById("collapse-batch-lines-btn").addEventListener("click", () => {
      clearBatchLinesPanel();
    });

    document.getElementById("delete-batch-source-btn").addEventListener("click", async () => {
      if (selectedBatchGroupIndex == null) return;
      await deleteBatchSource(selectedBatchGroupIndex);
    });

    document.querySelector("#batches-table tbody").addEventListener("click", async (event) => {
      const deleteBtn = event.target.closest(".batch-delete-btn");
      if (deleteBtn) {
        event.stopPropagation();
        await deleteBatch(
          Number(deleteBtn.dataset.batchId),
          deleteBtn.dataset.batchNumber,
          deleteBtn.dataset.batchDate
        );
        return;
      }

      const row = event.target.closest("tr.batch-row");
      if (!row) return;

      const groupIndex = Number(row.dataset.batchGroupIndex);
      if (Number.isNaN(groupIndex) || groupIndex < 0) return;

      if (selectedBatchGroupIndex === groupIndex) {
        clearBatchLinesPanel();
        return;
      }

      showBatchLines(groupIndex);
    });

    document.querySelector("#batch-lines-table tbody").addEventListener("click", async (event) => {
      const deleteBtn = event.target.closest(".batch-delete-btn");
      if (!deleteBtn) return;

      event.stopPropagation();
      await deleteBatch(
        Number(deleteBtn.dataset.batchId),
        deleteBtn.dataset.batchNumber,
        deleteBtn.dataset.batchDate
      );
    });
  }

  function init() {
    DashboardUI.init();
    initBatchLineSelection();
    initInvoiceLineSelection();
    StoreSelector.init({ onStoreChange });
    BatchIngestUI.init({ onIngestComplete: onBatchIngestComplete });
    InvoiceIngestUI.init({ onIngestComplete: onInvoiceIngestComplete });
    ReconcileUI.init({ onReconcileComplete, onManualBatchAdded });
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
