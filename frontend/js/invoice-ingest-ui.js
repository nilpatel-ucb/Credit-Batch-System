const InvoiceIngestUI = (() => {
  let pendingSummary = null;
  let pendingBatchLines = [];
  let pendingFilename = "";
  let storeOpen = false;

  const dropzone = () => document.getElementById("invoice-dropzone");
  const pdfInput = () => document.getElementById("invoice-pdf-input");

  function isPdfFile(file) {
    if (!file) return false;
    if (file.type === "application/pdf") return true;
    return /\.pdf$/i.test(file.name || "");
  }

  function setStoreOpen(open) {
    storeOpen = open;
    const dz = dropzone();
    const hint = dz.querySelector("p");
    if (open) {
      dz.classList.remove("disabled");
      if (hint) {
        hint.textContent = "Drop an EFT prenotification PDF here, or click to browse";
      }
    } else {
      dz.classList.add("disabled");
      clearPreview();
      if (hint) {
        hint.textContent = "Select or create a store first, then drop an EFT PDF here";
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
      .map((w) => `<li>Line ${w.line}: ${w.message}</li>`)
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
    pendingSummary = null;
    pendingBatchLines = [];
    pendingFilename = "";
    document.getElementById("invoice-preview-section").hidden = true;
    document.getElementById("invoice-preview-count").textContent = "0";
    document.querySelector("#invoice-preview-table tbody").innerHTML = "";
    document.getElementById("invoice-summary-number").textContent = "—";
    document.getElementById("invoice-summary-total").textContent = "—";
    document.getElementById("invoice-summary-balance").textContent = "—";
    document.getElementById("invoice-summary-period").textContent = "—";
    showWarnings([]);
    hideStatus();
    setConfirmEnabled(true);
  }

  function renderPreview(summary, batchLines) {
    const period = computePeriod(batchLines);

    document.getElementById("invoice-summary-number").textContent =
      summary.invoiceNumber || "—";
    document.getElementById("invoice-summary-total").textContent = StoreSelector.formatMoney(
      summary.amount
    );
    document.getElementById("invoice-summary-balance").textContent =
      summary.balance == null ? "—" : StoreSelector.formatMoney(summary.balance);
    document.getElementById("invoice-summary-period").textContent =
      period.start && period.end ? `${period.start} – ${period.end}` : "—";

    const tbody = document.querySelector("#invoice-preview-table tbody");
    tbody.innerHTML = batchLines
      .map(
        (line) => `<tr>
          <td>${line.invoiceId}</td>
          <td>${StoreSelector.stripLeadingZeros(line.batchNumber)}</td>
          <td>${StoreSelector.formatDate(line.invDate)}</td>
          <td class="num">${StoreSelector.formatMoney(line.amount)}</td>
        </tr>`
      )
      .join("");

    document.getElementById("invoice-preview-count").textContent = String(batchLines.length);
    document.getElementById("invoice-preview-section").hidden = false;
  }

  async function handlePdfFile(file) {
    if (!storeOpen) {
      showStatus("Open a store before uploading a PDF.", "error");
      return;
    }
    if (!isPdfFile(file)) {
      showStatus("Please select a PDF file.", "error");
      return;
    }

    showStatus("Parsing EFT invoice…", "info");
    clearPreview();

    try {
      const buffer = await file.arrayBuffer();
      if (!buffer || buffer.byteLength === 0) {
        showStatus("The selected file is empty.", "error");
        return;
      }

      const result = await window.api.parseEftPdf(buffer);
      pendingSummary = result.summary;
      pendingBatchLines = result.batchLines || [];
      pendingFilename = file.name;

      if (!pendingSummary || !pendingSummary.invoiceNumber) {
        showStatus("No invoice summary found in this PDF.", "error");
        showWarnings(result.warnings);
        return;
      }

      if (pendingBatchLines.length === 0) {
        showStatus("No AA batch lines found in this invoice.", "error");
        showWarnings(result.warnings);
        return;
      }

      renderPreview(pendingSummary, pendingBatchLines);
      showWarnings(result.warnings);
      setConfirmEnabled(true);
      showStatus(
        `Parsed invoice ${pendingSummary.invoiceNumber} with ${pendingBatchLines.length} line${pendingBatchLines.length === 1 ? "" : "s"}. Review and confirm.`,
        "info"
      );
    } catch (err) {
      showStatus(err.message || "Failed to parse PDF.", "error");
    }
  }

  function fileFromDrop(event) {
    const dt = event.dataTransfer;
    if (!dt || !dt.files || !dt.files.length) return null;

    for (const file of dt.files) {
      if (isPdfFile(file)) return file;
    }
    return dt.files[0];
  }

  async function confirmIngest(onComplete) {
    if (!pendingSummary || !pendingBatchLines.length) return;

    try {
      const result = await window.api.insertInvoice(
        pendingSummary,
        pendingBatchLines,
        pendingFilename
      );
      showStatus(
        `Saved invoice ${pendingSummary.invoiceNumber} (${result.lineCount} line${result.lineCount === 1 ? "" : "s"}).`,
        "success"
      );
      clearPreview();
      if (onComplete) await onComplete();
    } catch (err) {
      showStatus(err.message || "Failed to save invoice.", "error");
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
      const file = input.files && input.files[0];
      if (file) handlePdfFile(file);
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
      const file = fileFromDrop(e);
      if (file) handlePdfFile(file);
    });

    document.getElementById("confirm-invoice-btn").addEventListener("click", () => {
      confirmIngest(handlers.onIngestComplete);
    });

    document.getElementById("cancel-invoice-preview-btn").addEventListener("click", clearPreview);

    setStoreOpen(false);
  }

  return { init, setStoreOpen, clearPreview };
})();
