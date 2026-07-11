const InvoiceIngestUI = (() => {
  let pendingItems = [];
  let storeOpen = false;

  const dropzone = () => document.getElementById("invoice-dropzone");
  const pdfInput = () => document.getElementById("invoice-pdf-input");

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
        hint.textContent = "Drop one or more EFT prenotification PDFs here, or click to browse";
      }
    } else {
      dz.classList.add("disabled");
      clearPreview();
      if (hint) {
        hint.textContent = "Select or create a store first, then drop EFT PDFs here";
      }
    }
  }

  function showStatus(message, type = "info") {
    const el = document.getElementById("invoice-ingest-status");
    el.hidden = false;
    el.className = `status-message ${type}`;
    el.textContent = message;
  }

  function hideStatus() {
    const el = document.getElementById("invoice-ingest-status");
    el.hidden = true;
    el.textContent = "";
  }

  function showWarnings(warnings) {
    const panel = document.getElementById("invoice-warnings-panel");
    const list = document.getElementById("invoice-warnings-list");
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

  function setConfirmEnabled(enabled) {
    document.getElementById("confirm-invoice-btn").disabled = !enabled;
  }

  function computePeriod(batchLines) {
    if (!batchLines.length) return { start: "", end: "" };
    const dates = batchLines.map((line) => line.invDate).sort();
    return {
      start: StoreSelector.formatDate(dates[0]),
      end: StoreSelector.formatDate(dates[dates.length - 1]),
    };
  }

  function clearPreview() {
    pendingItems = [];
    document.getElementById("invoice-preview-section").hidden = true;
    document.getElementById("invoice-preview-count").textContent = "0";
    document.getElementById("invoice-preview-file-count").textContent = "";
    document.getElementById("invoice-preview-files").hidden = true;
    document.getElementById("invoice-preview-files").innerHTML = "";
    document.getElementById("invoice-preview-single-summary").hidden = false;
    document.querySelector("#invoice-preview-table tbody").innerHTML = "";
    document.getElementById("invoice-summary-number").textContent = "—";
    document.getElementById("invoice-summary-total").textContent = "—";
    document.getElementById("invoice-summary-balance").textContent = "—";
    document.getElementById("invoice-summary-period").textContent = "—";
    showWarnings([]);
    hideStatus();
    setConfirmEnabled(true);
  }

  function validItems() {
    return pendingItems.filter((item) => item.valid);
  }

  function renderPreview() {
    const items = validItems();
    const multiple = items.length > 1;
    const filesEl = document.getElementById("invoice-preview-files");
    const singleSummary = document.getElementById("invoice-preview-single-summary");

    if (multiple) {
      singleSummary.hidden = true;
      filesEl.hidden = false;
      filesEl.innerHTML = items
        .map((item) => {
          const period = computePeriod(item.batchLines);
          const periodLabel =
            period.start && period.end ? `${period.start} – ${period.end}` : "—";
          return `<div class="invoice-summary-card">
            <p><strong>File:</strong> ${item.filename}</p>
            <p><strong>Invoice #:</strong> ${item.summary.invoiceNumber}</p>
            <p><strong>Total:</strong> ${StoreSelector.formatMoney(item.summary.amount)}</p>
            <p><strong>Balance:</strong> ${
              item.summary.balance == null
                ? "—"
                : StoreSelector.formatMoney(item.summary.balance)
            }</p>
            <p><strong>Period:</strong> ${periodLabel}</p>
            <p><strong>Lines:</strong> ${item.batchLines.length}</p>
          </div>`;
        })
        .join("");
    } else if (items.length === 1) {
      filesEl.hidden = true;
      singleSummary.hidden = false;
      const item = items[0];
      const period = computePeriod(item.batchLines);
      document.getElementById("invoice-summary-number").textContent =
        item.summary.invoiceNumber || "—";
      document.getElementById("invoice-summary-total").textContent = StoreSelector.formatMoney(
        item.summary.amount
      );
      document.getElementById("invoice-summary-balance").textContent =
        item.summary.balance == null ? "—" : StoreSelector.formatMoney(item.summary.balance);
      document.getElementById("invoice-summary-period").textContent =
        period.start && period.end ? `${period.start} – ${period.end}` : "—";
    }

    const thead = document.querySelector("#invoice-preview-table thead tr");
    thead.innerHTML = multiple
      ? `<th>Invoice #</th><th>Invoice Line ID</th><th>Batch #</th><th>Date</th><th>Amount</th>`
      : `<th>Invoice Line ID</th><th>Batch #</th><th>Date</th><th>Amount</th>`;

    const rows = [];
    for (const item of items) {
      for (const line of item.batchLines) {
        const invoiceCell = multiple ? `<td>${item.summary.invoiceNumber}</td>` : "";
        rows.push(`<tr>
          ${invoiceCell}
          <td>${line.invoiceId}</td>
          <td>${StoreSelector.stripLeadingZeros(line.batchNumber)}</td>
          <td>${StoreSelector.formatDate(line.invDate)}</td>
          <td class="num">${StoreSelector.formatMoney(line.amount)}</td>
        </tr>`);
      }
    }

    document.querySelector("#invoice-preview-table tbody").innerHTML = rows.join("");

    const totalLines = items.reduce((sum, item) => sum + item.batchLines.length, 0);
    document.getElementById("invoice-preview-count").textContent = String(totalLines);
    document.getElementById("invoice-preview-file-count").textContent =
      items.length > 1 ? ` from ${items.length} files` : "";
    document.getElementById("invoice-preview-section").hidden = pendingItems.length === 0;
  }

  async function parsePdfFile(file) {
    const buffer = await file.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) {
      return {
        filename: file.name,
        summary: null,
        batchLines: [],
        warnings: [],
        valid: false,
        error: "The selected file is empty.",
      };
    }

    const result = await window.api.parseEftPdf(buffer);
    const summary = result.summary;
    const batchLines = result.batchLines || [];
    const warnings = (result.warnings || []).map((warning) => ({
      ...warning,
      file: file.name,
    }));

    if (!summary || !summary.invoiceNumber) {
      return {
        filename: file.name,
        summary: null,
        batchLines,
        warnings,
        valid: false,
        error: "No invoice summary found in this PDF.",
      };
    }

    if (batchLines.length === 0) {
      return {
        filename: file.name,
        summary,
        batchLines,
        warnings,
        valid: false,
        error: "No batch lines found in this invoice.",
      };
    }

    return {
      filename: file.name,
      summary,
      batchLines,
      warnings,
      valid: true,
      error: null,
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
      pdfFiles.length === 1 ? "Parsing EFT invoice…" : `Parsing ${pdfFiles.length} EFT invoices…`,
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
          summary: null,
          batchLines: [],
          warnings: [],
          valid: false,
          error: err.message || "Failed to parse PDF.",
        });
      }
    }

    pendingItems = parsed;
    showWarnings(parsed.flatMap((item) => item.warnings));
    renderPreview();

    const ready = validItems();
    if (ready.length === 0) {
      setConfirmEnabled(false);
      showStatus(errors.join(" "), "error");
      return;
    }

    const totalLines = ready.reduce((sum, item) => sum + item.batchLines.length, 0);
    setConfirmEnabled(true);

    const invoiceLabels = ready.map((item) => item.summary.invoiceNumber).join(", ");
    const statusParts = [
      `Parsed ${ready.length} invoice${ready.length === 1 ? "" : "s"} (${invoiceLabels}) with ${totalLines} line${totalLines === 1 ? "" : "s"}. Review and confirm.`,
    ];
    if (errors.length > 0) {
      statusParts.push(`${errors.length} file${errors.length === 1 ? "" : "s"} skipped: ${errors.join(" ")}`);
    }
    showStatus(statusParts.join(" "), "info");
  }

  function pdfFilesFromDrop(event) {
    return pdfFilesFromList(event.dataTransfer?.files);
  }

  const DUPLICATE_INVOICE_RE = /Invoice (.+) was already uploaded on (.+?)\.?(\s|$)/;

  function parseDuplicateInvoiceError(err) {
    const message = String(err?.message || err || "");
    const match = message.match(DUPLICATE_INVOICE_RE);
    if (!match) return null;
    return {
      invoiceNumber: match[1],
      uploadedAt: match[2].trim(),
    };
  }

  function removeHandledItems(handledFilenames) {
    pendingItems = pendingItems.filter((item) => !handledFilenames.has(item.filename));
    renderPreview();
    setConfirmEnabled(validItems().length > 0);
  }

  function formatDuplicateLabel(entry) {
    return `Invoice ${entry.invoiceNumber} from "${entry.filename}" (uploaded ${entry.uploadedAt})`;
  }

  async function confirmIngest(onComplete) {
    const items = validItems();
    if (!items.length) return;

    let lastResult = null;
    let savedCount = 0;
    let totalLines = 0;
    const duplicates = [];
    const handledFilenames = new Set();

    for (const item of items) {
      try {
        lastResult = await window.api.insertInvoice(
          item.summary,
          item.batchLines,
          item.filename
        );

        if (lastResult?.skipped && lastResult?.duplicate) {
          duplicates.push({
            filename: item.filename,
            invoiceNumber: lastResult.invoiceNumber || item.summary.invoiceNumber,
            uploadedAt: lastResult.uploadedAtLabel || lastResult.uploadedAt || "a previous date",
          });
          handledFilenames.add(item.filename);
          continue;
        }

        savedCount += 1;
        totalLines += lastResult.lineCount;
        handledFilenames.add(item.filename);
      } catch (err) {
        const duplicate = parseDuplicateInvoiceError(err);
        if (duplicate) {
          duplicates.push({
            filename: item.filename,
            invoiceNumber: duplicate.invoiceNumber,
            uploadedAt: duplicate.uploadedAt,
          });
          handledFilenames.add(item.filename);
          continue;
        }

        removeHandledItems(handledFilenames);
        showStatus(err.message || "Failed to save invoice.", "error");
        return;
      }
    }

    removeHandledItems(handledFilenames);

    const statusParts = [];
    let statusType = "info";

    if (savedCount > 0) {
      statusParts.push(
        `Saved ${savedCount} invoice${savedCount === 1 ? "" : "s"} (${totalLines} line${totalLines === 1 ? "" : "s"}).`
      );
      const reconciliation = lastResult?.reconciliation;
      const summary = reconciliation?.summary;
      if (summary) {
        statusParts.push(
          `${summary.matchedCount} matched, ${summary.missingFromInvoiceCount} missing from invoice, ${StoreSelector.formatMoney(summary.totalMissingCredit)} missing credit.`
        );
      }
      statusType = "success";
    }

    if (duplicates.length > 0) {
      const duplicateLabels = duplicates.map(formatDuplicateLabel).join("; ");
      const skipPrefix =
        duplicates.length === 1
          ? "Skipped 1 invoice already uploaded"
          : `Skipped ${duplicates.length} invoices already uploaded`;
      statusParts.push(`${skipPrefix}: ${duplicateLabels}.`);
      if (savedCount === 0) {
        statusType = "info";
      }
    }

    showStatus(statusParts.join(" "), statusType);

    if (savedCount > 0 && onComplete) {
      await onComplete(lastResult);
    }
  }

  function init(handlers) {
    const dz = dropzone();
    const input = pdfInput();

    dz.addEventListener("click", () => {
      if (!storeOpen) {
        showStatus("Select or create a store in the left panel first.", "error");
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
        showStatus("Select or create a store in the left panel first.", "error");
        return;
      }
      const files = pdfFilesFromDrop(e);
      if (files.length) handlePdfFiles(files);
    });

    document.getElementById("confirm-invoice-btn").addEventListener("click", () => {
      confirmIngest(handlers.onIngestComplete);
    });

    document.getElementById("cancel-invoice-preview-btn").addEventListener("click", clearPreview);

    setStoreOpen(false);
  }

  return { init, setStoreOpen, clearPreview };
})();
