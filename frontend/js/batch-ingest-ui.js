const BatchIngestUI = (() => {
  let pendingRecords = [];
  let pendingFilename = "";
  let storeOpen = false;

  const dropzone = () => document.getElementById("dropzone");
  const pdfInput = () => document.getElementById("pdf-input");

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
        hint.textContent = "Drop a Chevron settlement PDF here, or click to browse";
      }
    } else {
      dz.classList.add("disabled");
      clearPreview();
      if (hint) {
        hint.textContent = "Select or create a store first, then drop a PDF here";
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
      .map((w) => `<li>Line ${w.line}: ${w.message}</li>`)
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

  function clearPreview() {
    pendingRecords = [];
    pendingFilename = "";
    document.getElementById("preview-section").hidden = true;
    document.getElementById("preview-count").textContent = "0";
    document.querySelector("#preview-table tbody").innerHTML = "";
    showWarnings([]);
    hideStatus();
    setConfirmEnabled(true);
  }

  function renderPreview(records) {
    const tbody = document.querySelector("#preview-table tbody");
    tbody.innerHTML = records
      .map(
        (r) => `<tr>
          <td>${StoreSelector.formatDate(r.batch_date)}</td>
          <td>${StoreSelector.stripLeadingZeros(r.batch_number)}</td>
          <td class="num">${StoreSelector.formatMoney(r.gross_amount)}</td>
          <td class="num">${StoreSelector.formatMoney(r.total_fee)}</td>
          <td class="num">${StoreSelector.formatMoney(r.net_amount)}</td>
          <td>${r.site_id}</td>
        </tr>`
      )
      .join("");
    document.getElementById("preview-count").textContent = String(records.length);
    document.getElementById("preview-section").hidden = records.length === 0;
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

    showStatus("Parsing PDF…", "info");
    clearPreview();

    try {
      const buffer = await file.arrayBuffer();
      if (!buffer || buffer.byteLength === 0) {
        showStatus("The selected file is empty.", "error");
        return;
      }
      const result = await window.api.parseChevronPdf(buffer);
      pendingRecords = result.records || [];
      pendingFilename = file.name;

      if (pendingRecords.length === 0) {
        showStatus("No batch records found in this PDF.", "error");
        showWarnings(result.warnings);
        return;
      }

      const validation = validateRecordsForStore(pendingRecords);
      renderPreview(pendingRecords);
      showWarnings(result.warnings);

      if (!validation.ok) {
        setConfirmEnabled(false);
        showStatus(validation.message, "error");
        return;
      }

      setConfirmEnabled(true);
      showStatus(
        `Parsed ${pendingRecords.length} batch${pendingRecords.length === 1 ? "" : "es"} from ${file.name}. Site ${StoreSelector.getActiveSiteId()} matches — review and confirm.`,
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
    if (!pendingRecords.length) return;

    try {
      const result = await window.api.insertBatches(pendingRecords, pendingFilename);
      showStatus(
        `Added ${result.added} batch${result.added === 1 ? "" : "es"}, ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped.`,
        "success"
      );
      clearPreview();
      if (onComplete) await onComplete();
    } catch (err) {
      showStatus(err.message || "Failed to save batches.", "error");
    }
  }

  function init(handlers) {
    const dz = dropzone();
    const input = pdfInput();

    // Required in Electron — without this, Finder drops are ignored
    document.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    document.addEventListener("drop", (e) => {
      e.preventDefault();
    });

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

    document.getElementById("confirm-ingest-btn").addEventListener("click", () => {
      confirmIngest(handlers.onIngestComplete);
    });

    document.getElementById("cancel-preview-btn").addEventListener("click", clearPreview);

    setStoreOpen(false);
  }

  return { init, setStoreOpen, clearPreview };
})();
