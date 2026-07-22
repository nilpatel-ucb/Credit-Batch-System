const BatchIngestUI = (() => {
  let pendingItems = [];
  let storeOpen = false;

  const dropzone = () => document.getElementById("dropzone");
  const pdfInput = () => document.getElementById("pdf-input");

  function isPdfFile(file) {
    if (!file) return false;
    if (file.type === "application/pdf") return true;
    return /\.pdf$/i.test(file.name || "");
  }

  function pdfFilesFromList(fileList) {
    if (!fileList || !fileList.length) return [];
    return [...fileList].filter(isPdfFile);
  }

  function setStoreOpen(open) {
    storeOpen = open;
    const dz = dropzone();
    const hint = dz.querySelector("p");
    if (open) {
      dz.classList.remove("disabled");
      if (hint) {
        hint.textContent = "Drop one or more Chevron settlement PDFs here, or click to browse";
      }
    } else {
      dz.classList.add("disabled");
      clearPreview();
      if (hint) {
        hint.textContent = "Select or create a store first, then drop PDFs here";
      }
    }
  }

  function showStatus(message, type = "info") {
    const el = document.getElementById("ingest-status");
    el.hidden = false;
    el.className = `status-message ${type}`;
    el.textContent = message;
  }

  function hideStatus() {
    const el = document.getElementById("ingest-status");
    el.hidden = true;
    el.textContent = "";
  }

  function showWarnings(warnings) {
    const panel = document.getElementById("warnings-panel");
    const list = document.getElementById("warnings-list");
    if (!warnings || warnings.length === 0) {
      panel.hidden = true;
      list.innerHTML = "";
      return;
    }
    panel.hidden = false;
    list.innerHTML = warnings
      .map((w) => `<li>${w.file ? `${w.file}: ` : ""}Line ${w.line}: ${w.message}</li>`)
      .join("");
  }

  function getPdfSiteIds(records) {
    return [...new Set(records.map((r) => String(r.site_id || "").trim()).filter(Boolean))];
  }

  function validateRecordsForStore(records) {
    const expectedSiteId = StoreSelector.getActiveSiteId();
    if (!expectedSiteId) {
      return {
        ok: false,
        message:
          "This store has no linked site ID. Create a new store with a Chevron site ID before uploading.",
      };
    }

    const pdfSiteIds = getPdfSiteIds(records);
    if (pdfSiteIds.length === 0) {
      return { ok: false, message: "No site ID found in the parsed PDF." };
    }
    if (pdfSiteIds.length > 1) {
      return {
        ok: false,
        message: `PDF contains multiple site IDs (${pdfSiteIds.join(", ")}). Upload one site per PDF.`,
      };
    }
    if (pdfSiteIds[0] !== expectedSiteId) {
      return {
        ok: false,
        message: `Wrong store: PDF is for site ${pdfSiteIds[0]}, but "${StoreSelector.getActiveStore()}" is linked to site ${expectedSiteId}.`,
      };
    }

    return { ok: true };
  }

  function setConfirmEnabled(enabled) {
    document.getElementById("confirm-ingest-btn").disabled = !enabled;
  }

  const COPY_ICON_SVG =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function formatExcelMoney(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : "";
  }

  function escapeTsvCell(value) {
    const text = String(value ?? "");
    if (/[\t\n\r"]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function getPreviewColumns() {
    const columns = [];
    if (pendingItems.length > 1) {
      columns.push({ key: "source", label: "Source PDF" });
    }
    columns.push(
      { key: "date", label: "Date" },
      { key: "batch", label: "Batch #" },
      { key: "credit", label: "Credit", className: "num" },
      { key: "fee", label: "Fee", className: "num" },
      { key: "net", label: "After Fee Credit", className: "num" },
      { key: "site", label: "Site ID" }
    );
    return columns;
  }

  function getPreviewRows() {
    const rows = [];
    for (const item of validItems()) {
      for (const record of item.records) {
        rows.push({
          source: item.filename,
          date: StoreSelector.formatDate(record.batch_date),
          batch: StoreSelector.stripLeadingZeros(record.batch_number),
          credit: formatExcelMoney(record.gross_amount),
          fee: formatExcelMoney(record.total_fee),
          net: formatExcelMoney(record.net_amount),
          site: record.site_id,
        });
      }
    }
    return rows;
  }

  function buildPreviewTsv() {
    const columns = getPreviewColumns();
    const rows = getPreviewRows();
    const lines = [columns.map((col) => escapeTsvCell(col.label)).join("\t")];
    for (const row of rows) {
      lines.push(columns.map((col) => escapeTsvCell(row[col.key])).join("\t"));
    }
    return lines.join("\n");
  }

  function renderColumnHeader(col) {
    const classAttr = col.className ? ` class="${col.className}"` : "";
    return `<th${classAttr}><span class="th-label">${col.label}<button type="button" class="col-copy-btn" data-copy-col="${col.key}" title="Copy ${col.label} column" aria-label="Copy ${col.label} column">${COPY_ICON_SVG}</button></span></th>`;
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  async function flashCopyButton(btn) {
    if (!btn) return;
    btn.classList.add("copied");
    setTimeout(() => btn.classList.remove("copied"), 1200);
  }

  async function copyPreviewForExcel() {
    const items = validItems();
    const btn = document.getElementById("copy-preview-btn");
    if (!items.length) {
      showStatus("Nothing to copy yet — parse a PDF first.", "error");
      return;
    }

    try {
      await copyText(buildPreviewTsv());
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
      showStatus("Preview rows copied. Paste into Excel with Ctrl/Cmd+V.", "success");
    } catch (err) {
      showStatus(err.message || "Failed to copy preview rows.", "error");
    }
  }

  async function copyPreviewColumn(columnKey, btn) {
    const columns = getPreviewColumns();
    const column = columns.find((col) => col.key === columnKey);
    const rows = getPreviewRows();
    if (!column || !rows.length) {
      showStatus("Nothing to copy yet — parse a PDF first.", "error");
      return;
    }

    try {
      const text = rows.map((row) => String(row[column.key] ?? "")).join("\n");
      await copyText(text);
      await flashCopyButton(btn);
      showStatus(`Copied ${column.label} column (${rows.length} value${rows.length === 1 ? "" : "s"}).`, "success");
    } catch (err) {
      showStatus(err.message || "Failed to copy column.", "error");
    }
  }

  function clearPreview() {
    pendingItems = [];
    document.getElementById("preview-section").hidden = true;
    document.getElementById("preview-count").textContent = "0";
    document.getElementById("preview-file-count").textContent = "";
    document.querySelector("#preview-table tbody").innerHTML = "";
    showWarnings([]);
    hideStatus();
    setConfirmEnabled(true);
  }

  function validItems() {
    return pendingItems.filter((item) => item.valid);
  }

  function renderPreview() {
    const items = validItems();
    const columns = getPreviewColumns();
    const thead = document.querySelector("#preview-table thead tr");
    thead.innerHTML = columns.map(renderColumnHeader).join("");

    const rows = [];
    for (const item of items) {
      for (const record of item.records) {
        const cells = [];
        if (pendingItems.length > 1) cells.push(`<td>${item.filename}</td>`);
        cells.push(
          `<td>${StoreSelector.formatDate(record.batch_date)}</td>`,
          `<td>${StoreSelector.stripLeadingZeros(record.batch_number)}</td>`,
          `<td class="num">${StoreSelector.formatMoney(record.gross_amount)}</td>`,
          `<td class="num">${StoreSelector.formatMoney(record.total_fee)}</td>`,
          `<td class="num">${StoreSelector.formatMoney(record.net_amount)}</td>`,
          `<td>${record.site_id}</td>`
        );
        rows.push(`<tr>${cells.join("")}</tr>`);
      }
    }

    const tbody = document.querySelector("#preview-table tbody");
    tbody.innerHTML = rows.join("");

    const totalBatches = items.reduce((sum, item) => sum + item.records.length, 0);
    document.getElementById("preview-count").textContent = String(totalBatches);
    document.getElementById("preview-file-count").textContent =
      items.length > 1 ? ` from ${items.length} files` : "";
    document.getElementById("preview-section").hidden = pendingItems.length === 0;
  }

  async function parsePdfFile(file) {
    const buffer = await file.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) {
      return {
        filename: file.name,
        records: [],
        warnings: [],
        valid: false,
        error: "The selected file is empty.",
      };
    }

    const result = await window.api.parseBatchPdf(
      buffer,
      StoreSelector.getActiveBatchTemplate(),
      StoreSelector.getActiveSiteId()
    );
    const records = result.records || [];
    const warnings = (result.warnings || []).map((warning) => ({
      ...warning,
      file: file.name,
    }));

    if (records.length === 0) {
      return {
        filename: file.name,
        records: [],
        warnings,
        valid: false,
        error: "No batch records found in this PDF.",
      };
    }

    const validation = validateRecordsForStore(records);
    return {
      filename: file.name,
      records,
      warnings,
      valid: validation.ok,
      error: validation.ok ? null : validation.message,
    };
  }

  async function handlePdfFiles(files) {
    if (!storeOpen) {
      showStatus("Open a store before uploading PDFs.", "error");
      return;
    }

    const pdfFiles = pdfFilesFromList(files);
    if (pdfFiles.length === 0) {
      showStatus("Please select one or more PDF files.", "error");
      return;
    }

    showStatus(
      pdfFiles.length === 1 ? "Parsing PDF…" : `Parsing ${pdfFiles.length} PDFs…`,
      "info"
    );
    clearPreview();

    const parsed = [];
    const errors = [];

    for (const file of pdfFiles) {
      try {
        const item = await parsePdfFile(file);
        parsed.push(item);
        if (!item.valid && item.error) {
          errors.push(`${file.name}: ${item.error}`);
        }
      } catch (err) {
        errors.push(`${file.name}: ${err.message || "Failed to parse PDF."}`);
        parsed.push({
          filename: file.name,
          records: [],
          warnings: [],
          valid: false,
          error: err.message || "Failed to parse PDF.",
        });
      }
    }

    pendingItems = parsed;
    const allWarnings = parsed.flatMap((item) => item.warnings);
    showWarnings(allWarnings);
    renderPreview();

    const ready = validItems();
    if (ready.length === 0) {
      setConfirmEnabled(false);
      showStatus(errors.join(" "), "error");
      return;
    }

    const totalBatches = ready.reduce((sum, item) => sum + item.records.length, 0);
    setConfirmEnabled(true);

    const statusParts = [
      `Parsed ${totalBatches} batch${totalBatches === 1 ? "" : "es"} from ${ready.length} file${ready.length === 1 ? "" : "s"}. Site ${StoreSelector.getActiveSiteId()} matches — review and confirm.`,
    ];
    if (errors.length > 0) {
      statusParts.push(`${errors.length} file${errors.length === 1 ? "" : "s"} skipped: ${errors.join(" ")}`);
    }
    showStatus(statusParts.join(" "), errors.length > 0 ? "info" : "info");
  }

  function pdfFilesFromDrop(event) {
    return pdfFilesFromList(event.dataTransfer?.files);
  }

  async function confirmIngest(onComplete) {
    const items = validItems();
    if (!items.length) return;

    let totalAdded = 0;
    let totalSkipped = 0;
    let lastReconciliation = null;
    const errors = [];

    try {
      for (const item of items) {
        const result = await window.api.insertBatches(item.records, item.filename);
        totalAdded += result.added;
        totalSkipped += result.skipped;
        lastReconciliation = result.reconciliation || lastReconciliation;
      }

      const statusParts = [
        `Added ${totalAdded} batch${totalAdded === 1 ? "" : "es"} from ${items.length} file${items.length === 1 ? "" : "s"}, ${totalSkipped} duplicate${totalSkipped === 1 ? "" : "s"} skipped.`,
      ];
      const summary = lastReconciliation?.summary;
      if (summary) {
        statusParts.push(
          `Reconciled: ${summary.matchedCount} matched, ${summary.missingFromInvoiceCount} missing from invoices, ${summary.unmatchedLineCount} unmatched lines.`
        );
      }
      showStatus(statusParts.join(" "), "success");
      clearPreview();
      if (onComplete) await onComplete();
    } catch (err) {
      showStatus(err.message || "Failed to save batches.", "error");
    }
  }

  function init(handlers) {
    const dz = dropzone();
    const input = pdfInput();

    document.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    document.addEventListener("drop", (e) => {
      e.preventDefault();
    });

    dz.addEventListener("click", () => {
      if (!storeOpen) {
        showStatus("Select or create a store first (Manage).", "error");
        return;
      }
      input.click();
    });

    input.addEventListener("change", () => {
      const files = pdfFilesFromList(input.files);
      if (files.length) handlePdfFiles(files);
      input.value = "";
    });

    dz.addEventListener("dragenter", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (storeOpen) dz.classList.add("dragover");
    });

    dz.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (storeOpen) dz.classList.add("dragover");
    });

    dz.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!dz.contains(e.relatedTarget)) {
        dz.classList.remove("dragover");
      }
    });

    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove("dragover");
      if (!storeOpen) {
        showStatus("Select or create a store first (Manage).", "error");
        return;
      }
      const files = pdfFilesFromDrop(e);
      if (files.length) handlePdfFiles(files);
    });

    document.getElementById("copy-preview-btn").addEventListener("click", () => {
      copyPreviewForExcel();
    });

    document.querySelector("#preview-table thead").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-copy-col]");
      if (!btn) return;
      copyPreviewColumn(btn.getAttribute("data-copy-col"), btn);
    });

    document.getElementById("confirm-ingest-btn").addEventListener("click", () => {
      confirmIngest(handlers.onIngestComplete);
    });

    document.getElementById("cancel-preview-btn").addEventListener("click", clearPreview);

    setStoreOpen(false);
  }

  return { init, setStoreOpen, clearPreview };
})();
