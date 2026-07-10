const App = (() => {
  let selectedInvoiceId = null;
  let selectedBatchGroupIndex = null;
  let cachedBatchGroups = [];

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

  function summarizeBatchGroup(group) {
    const dates = group.batches.map((b) => b.batch_date).sort();
    const periodStart = dates[0];
    const periodEnd = dates[dates.length - 1];

    return {
      count: group.batches.length,
      period: formatPeriod(periodStart, periodEnd),
      gross: group.batches.reduce((sum, b) => sum + b.gross_amount, 0),
      fee: group.batches.reduce((sum, b) => sum + b.total_fee, 0),
      net: group.batches.reduce((sum, b) => sum + b.net_amount, 0),
    };
  }

  function renderBatchLineRows(batches) {
    return batches
      .map(
        (b) => `<tr data-batch-id="${b.id}">
          <td>${StoreSelector.formatDate(b.batch_date)}</td>
          <td>${StoreSelector.stripLeadingZeros(b.batch_number)}</td>
          <td class="num">${StoreSelector.formatMoney(b.gross_amount)}</td>
          <td class="num">${StoreSelector.formatMoney(b.total_fee)}</td>
          <td class="num">${StoreSelector.formatMoney(b.net_amount)}</td>
          <td>${b.site_id}</td>
          <td><button type="button" class="danger batch-delete-btn" data-batch-id="${b.id}" data-batch-number="${b.batch_number}" data-batch-date="${b.batch_date}">Delete</button></td>
        </tr>`
      )
      .join("");
  }

  function clearInvoiceLinesPanel() {
    selectedInvoiceId = null;
    document.getElementById("invoice-lines-panel").hidden = true;
    document.getElementById("invoice-lines-delete-btn").hidden = true;
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
    if (lines.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="4">No lines found for this invoice</td></tr>';
    } else {
      tbody.innerHTML = lines
        .map(
          (line) => `<tr>
          <td>${line.invoice_line_id}</td>
          <td>${StoreSelector.stripLeadingZeros(line.batch_number)}</td>
          <td>${StoreSelector.formatDate(line.inv_date)}</td>
          <td class="num">${StoreSelector.formatMoney(line.amount)}</td>
        </tr>`
        )
        .join("");
    }

    document.getElementById("invoice-lines-panel").hidden = false;
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
  }

  function highlightSelectedRows(tableSelector, selectedKey, keyAttribute) {
    document.querySelectorAll(`${tableSelector} tbody tr`).forEach((row) => {
      const isSelected = selectedKey != null && row.dataset[keyAttribute] === selectedKey;
      row.classList.toggle("selected", isSelected);
      const icon = row.querySelector(".expand-icon");
      if (icon) {
        icon.textContent = isSelected ? "▼" : "▶";
      }
    });
  }

  function highlightSelectedInvoiceRow() {
    highlightSelectedRows("#invoices-table", String(selectedInvoiceId ?? ""), "invoiceId");
  }

  function highlightSelectedBatchGroupRow() {
    highlightSelectedRows(
      "#batches-table",
      selectedBatchGroupIndex == null ? "" : String(selectedBatchGroupIndex),
      "batchGroupIndex"
    );
  }

  async function renderBatches() {
    const tbody = document.querySelector("#batches-table tbody");
    const activeStore = StoreSelector.getActiveStore();

    if (!activeStore) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="8">Open a store to view batches</td></tr>';
      document.getElementById("batch-count-badge").textContent = "0";
      cachedBatchGroups = [];
      clearBatchLinesPanel();
      return;
    }

    const batches = await window.api.getBatches();
    document.getElementById("batch-count-badge").textContent = String(batches.length);
    cachedBatchGroups = groupBatches(batches);

    if (cachedBatchGroups.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="8">No batches yet — upload a Chevron PDF</td></tr>';
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

    tbody.innerHTML = cachedBatchGroups
      .map((group, index) => {
        const summary = summarizeBatchGroup(group);
        const label = group.source_pdf || "(unknown source)";
        return `<tr class="expandable-row batch-group-row" data-batch-group-index="${index}">
          <td><span class="expand-icon" aria-hidden="true"></span> ${label}</td>
          <td>${summary.count}</td>
          <td>${summary.period}</td>
          <td class="num">${StoreSelector.formatMoney(summary.gross)}</td>
          <td class="num">${StoreSelector.formatMoney(summary.fee)}</td>
          <td class="num">${StoreSelector.formatMoney(summary.net)}</td>
          <td>${StoreSelector.formatDateTime(group.ingested_at)}</td>
          <td><button type="button" class="danger batch-source-delete-btn" data-batch-group-index="${index}">Delete upload</button></td>
        </tr>`;
      })
      .join("");

    highlightSelectedBatchGroupRow();

    if (selectedBatchGroupIndex != null && cachedBatchGroups[selectedBatchGroupIndex]) {
      showBatchLines(selectedBatchGroupIndex);
    }
  }

  async function renderInvoices() {
    const tbody = document.querySelector("#invoices-table tbody");
    const activeStore = StoreSelector.getActiveStore();

    if (!activeStore) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="8">Open a store to view invoices</td></tr>';
      document.getElementById("invoice-count-badge").textContent = "0";
      ReconcileUI.resetView();
      clearInvoiceLinesPanel();
      return;
    }

    const invoices = await window.api.getInvoices();
    document.getElementById("invoice-count-badge").textContent = String(invoices.length);

    if (invoices.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="8">No invoices yet — upload an EFT PDF</td></tr>';
      clearInvoiceLinesPanel();
      return;
    }

    const stillSelected = invoices.some((invoice) => invoice.id === selectedInvoiceId);
    if (!stillSelected) {
      clearInvoiceLinesPanel();
    }

    tbody.innerHTML = invoices
      .map(
        (invoice) => `<tr class="expandable-row invoice-row" data-invoice-id="${invoice.id}" data-invoice-number="${invoice.invoice_number}">
          <td><span class="expand-icon" aria-hidden="true"></span> ${invoice.invoice_number}</td>
          <td class="num">${StoreSelector.formatMoney(invoice.invoice_total)}</td>
          <td class="num">${invoice.invoice_balance == null ? "" : StoreSelector.formatMoney(invoice.invoice_balance)}</td>
          <td>${formatPeriod(invoice.period_start, invoice.period_end)}</td>
          <td>${invoice.line_count}</td>
          <td>${invoice.pdf_filename || ""}</td>
          <td>${StoreSelector.formatDateTime(invoice.processed_at)}</td>
          <td class="invoice-actions-cell">
            <button type="button" class="danger invoice-delete-btn" data-invoice-id="${invoice.id}" data-invoice-number="${invoice.invoice_number}" data-pdf-filename="${invoice.pdf_filename || ""}">Delete</button>
          </td>
        </tr>`
      )
      .join("");

    highlightSelectedInvoiceRow();

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
    }
  }

  async function onBatchIngestComplete() {
    await renderBatches();
    const activeStore = StoreSelector.getActiveStore();
    if (activeStore) {
      const result = await window.api.openStore(activeStore);
      StoreSelector.setActiveStoreInfo(result.name, result.site_id, result.batchCount);
    }
  }

  async function onInvoiceIngestComplete(result) {
    await renderInvoices();
    await renderBatches();

    if (result && result.invoiceId) {
      const invoiceNumber =
        result.reconciliation?.invoiceNumber ||
        document.querySelector(`#invoices-table tr[data-invoice-id="${result.invoiceId}"]`)?.dataset
          .invoiceNumber;
      if (invoiceNumber) {
        await showInvoiceLines(result.invoiceId, invoiceNumber);
        highlightSelectedInvoiceRow();
      }
      if (result.reconciliation) {
        ReconcileUI.render(result.reconciliation);
        document.getElementById("reconciliation-section").scrollIntoView({ behavior: "smooth" });
      }
      await ReconcileUI.refresh();
    }
  }

  async function onReconcileComplete() {
    await Promise.all([renderBatches(), renderInvoices()]);
    await ReconcileUI.refresh();
    if (selectedInvoiceId != null) {
      const row = document.querySelector(
        `#invoices-table tr[data-invoice-id="${selectedInvoiceId}"]`
      );
      const invoiceNumber = row ? row.dataset.invoiceNumber : "—";
      await showInvoiceLines(selectedInvoiceId, invoiceNumber);
      highlightSelectedInvoiceRow();
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
    } catch (err) {
      window.alert(err.message || "Failed to delete invoice.");
    }
  }

  function initInvoiceLineSelection() {
    document.getElementById("collapse-invoice-lines-btn").addEventListener("click", () => {
      clearInvoiceLinesPanel();
      highlightSelectedInvoiceRow();
    });

    document.getElementById("invoice-lines-delete-btn").addEventListener("click", async () => {
      if (selectedInvoiceId == null) return;
      const row = document.querySelector(
        `#invoices-table tr[data-invoice-id="${selectedInvoiceId}"]`
      );
      const invoiceNumber = row ? row.dataset.invoiceNumber : "—";
      const pdfFilename = row
        ? row.querySelector(".invoice-delete-btn")?.dataset.pdfFilename || ""
        : "";
      await deleteInvoice(selectedInvoiceId, invoiceNumber, pdfFilename);
    });

    document.querySelector("#invoices-table tbody").addEventListener("click", async (event) => {
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

      const row = event.target.closest("tr.invoice-row");
      if (!row) return;

      const invoiceId = Number(row.dataset.invoiceId);
      const invoiceNumber = row.dataset.invoiceNumber;
      if (selectedInvoiceId === invoiceId) {
        clearInvoiceLinesPanel();
        highlightSelectedInvoiceRow();
        return;
      }

      await showInvoiceLines(invoiceId, invoiceNumber);
      highlightSelectedInvoiceRow();
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
        highlightSelectedBatchGroupRow();
      } else {
        clearBatchLinesPanel();
      }
    }

    if (selectedInvoiceId != null) {
      const row = document.querySelector(
        `#invoices-table tr[data-invoice-id="${selectedInvoiceId}"]`
      );
      const invoiceNumber = row ? row.dataset.invoiceNumber : "—";
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
      highlightSelectedBatchGroupRow();
    });

    document.getElementById("delete-batch-source-btn").addEventListener("click", async () => {
      if (selectedBatchGroupIndex == null) return;
      await deleteBatchSource(selectedBatchGroupIndex);
    });

    document.querySelector("#batches-table tbody").addEventListener("click", async (event) => {
      const deleteBtn = event.target.closest(".batch-source-delete-btn");
      if (deleteBtn) {
        event.stopPropagation();
        await deleteBatchSource(Number(deleteBtn.dataset.batchGroupIndex));
        return;
      }

      const row = event.target.closest("tr.batch-group-row");
      if (!row) return;

      const groupIndex = Number(row.dataset.batchGroupIndex);
      if (selectedBatchGroupIndex === groupIndex) {
        clearBatchLinesPanel();
        highlightSelectedBatchGroupRow();
        return;
      }

      showBatchLines(groupIndex);
      highlightSelectedBatchGroupRow();
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
    initBatchLineSelection();
    initInvoiceLineSelection();
    StoreSelector.init({ onStoreChange });
    BatchIngestUI.init({ onIngestComplete: onBatchIngestComplete });
    InvoiceIngestUI.init({ onIngestComplete: onInvoiceIngestComplete });
    ReconcileUI.init({ onReconcileComplete });
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
