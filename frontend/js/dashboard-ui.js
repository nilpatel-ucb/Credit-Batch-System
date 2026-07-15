const DashboardUI = (() => {
  const CIRC = 2 * Math.PI * 84;

  function $(id) {
    return document.getElementById(id);
  }

  function usd(value) {
    return Number(value || 0).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
  }

  function fmtDateShort(isoDate) {
    if (!isoDate) return "";
    const [year, month, day] = isoDate.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function statusPill(status) {
    switch (status) {
      case "matched":
        return ["pill-matched", "Matched"];
      case "missing_from_invoice":
        return ["pill-missing", "Missing from invoice"];
      case "expected_on_next_invoice":
        return ["pill-expected", "Expected on next invoice"];
      case "mismatch":
        return ["pill-mismatch", "Amount mismatch"];
      case "reversed":
        return ["pill-mismatch", "Reversed"];
      case "over_credited":
        return ["pill-mismatch", "Over-credited"];
      case "ambiguous":
        return ["pill-mismatch", "Ambiguous"];
      case "unmatched":
      default:
        return ["pill-unmatched", "Unreconciled"];
    }
  }

  function openModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.hidden = true;
    if (
      document.getElementById("store-form-modal")?.hidden !== false &&
      document.getElementById("storage-location-modal")?.hidden !== false &&
      document.getElementById("add-pdf-modal")?.hidden !== false &&
      document.getElementById("manual-batch-modal")?.hidden !== false
    ) {
      document.body.style.overflow = "";
    }
  }

  function closeAddPdfModal() {
    closeModal("add-pdf-modal");
    if (typeof BatchIngestUI !== "undefined") BatchIngestUI.clearPreview();
    if (typeof InvoiceIngestUI !== "undefined") InvoiceIngestUI.clearPreview();
  }

  function setIngestPanel(name) {
    const chevron = $("ingest-panel-chevron");
    const eft = $("ingest-panel-eft");
    if (chevron) chevron.hidden = name !== "chevron";
    if (eft) eft.hidden = name !== "eft";
    document.querySelectorAll("#add-pdf-modal .modal-tabs .tab").forEach((tab) => {
      const active = tab.dataset.ingestPanel === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
  }

  function showPanel(name) {
    document.querySelectorAll(".tabs[aria-label='Sections'] .tab").forEach((tab) => {
      const active = tab.dataset.panel === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".panel[id^='panel-']").forEach((panel) => {
      const show = panel.id === `panel-${name}`;
      panel.classList.toggle("show", show);
      panel.hidden = !show;
    });
  }

  function drawGauge(received, missing, expected) {
    const total = received + missing + expected || 1;
    const gap = 6;
    const segs = [
      { el: $("arc-green"), v: received },
      { el: $("arc-red"), v: missing },
      { el: $("arc-slate"), v: expected },
    ].filter((s) => s.v > 0);

    ["arc-green", "arc-red", "arc-slate"].forEach((id) => {
      const el = $(id);
      if (el) el.setAttribute("stroke-dasharray", `0 ${CIRC}`);
    });

    let offset = 0;
    segs.forEach((s) => {
      const len = Math.max((s.v / total) * CIRC - (segs.length > 1 ? gap : 0), 2);
      s.el.style.transition =
        "stroke-dasharray .9s cubic-bezier(.22,1,.3,1), stroke-dashoffset .9s cubic-bezier(.22,1,.3,1)";
      s.el.setAttribute("stroke-dashoffset", String(-offset));
      requestAnimationFrame(() => s.el.setAttribute("stroke-dasharray", `${len} ${CIRC}`));
      offset += (s.v / total) * CIRC;
    });

    const pct = Math.round((received / total) * 100);
    $("gauge-pct").textContent = `${pct}%`;
    $("gauge-amt").textContent = usd(received);
  }

  function shortenHomePath(filePath) {
    if (!filePath) return "";
    const home = filePath.match(/^\/Users\/[^/]+/)?.[0];
    if (home) return `~${filePath.slice(home.length)}`;
    return filePath;
  }

  let activeDbPath = null;
  let storageInfo = null;
  let pendingStorageRoot = null;
  let onStorageLocationChanged = null;

  function setStorageLocationStatus(message, type = "info") {
    const el = $("storage-location-status");
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.className = "storage-location-status";
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.className = `storage-location-status ${type}`;
  }

  function resetStorageLocationModal() {
    pendingStorageRoot = null;
    $("storage-new-block")?.setAttribute("hidden", "");
    $("storage-move-wrap")?.setAttribute("hidden", "");
    $("storage-save-btn")?.setAttribute("disabled", "");
    setStorageLocationStatus("");
  }

  function updateStorageLocationModal() {
    if (!storageInfo) return;
    $("storage-current-path").textContent = storageInfo.dataRoot;
    const saveBtn = $("storage-save-btn");
    const moveWrap = $("storage-move-wrap");
    const moveLabel = $("storage-move-label");

    if (!pendingStorageRoot || pendingStorageRoot === storageInfo.dataRoot) {
      $("storage-new-block")?.setAttribute("hidden", "");
      moveWrap?.setAttribute("hidden", "");
      saveBtn?.setAttribute("disabled", "");
      return;
    }

    $("storage-new-path").textContent = pendingStorageRoot;
    $("storage-new-block")?.removeAttribute("hidden");
    saveBtn?.removeAttribute("disabled");

    if (storageInfo.storeCount > 0) {
      moveWrap?.removeAttribute("hidden");
      moveLabel.textContent =
        `Move ${storageInfo.storeCount} existing store file${storageInfo.storeCount === 1 ? "" : "s"} to the new location`;
    } else {
      moveWrap?.setAttribute("hidden", "");
    }
  }

  async function openStorageLocationModal() {
    try {
      storageInfo = await window.api.getStorageInfo();
      pendingStorageRoot = null;
      resetStorageLocationModal();
      $("storage-current-path").textContent = storageInfo.dataRoot;
      openModal("storage-location-modal");
    } catch (err) {
      alert(err.message || "Could not load storage location.");
    }
  }

  async function chooseStorageFolder() {
    try {
      const chosen = await window.api.chooseStorageFolder();
      if (!chosen) return;
      pendingStorageRoot = chosen;
      updateStorageLocationModal();
      setStorageLocationStatus("");
    } catch (err) {
      setStorageLocationStatus(err.message || "Could not choose folder.", "error");
    }
  }

  async function saveStorageLocation() {
    if (!pendingStorageRoot || !storageInfo) return;
    if (pendingStorageRoot === storageInfo.dataRoot) {
      closeModal("storage-location-modal");
      return;
    }

    const moveExisting = storageInfo.storeCount > 0 && $("storage-move-checkbox")?.checked;
    if (storageInfo.storeCount > 0 && !moveExisting) {
      setStorageLocationStatus(
        "Move existing store files or choose a location that already contains your Stores folder.",
        "error"
      );
      return;
    }

    const saveBtn = $("storage-save-btn");
    saveBtn.disabled = true;
    setStorageLocationStatus("Updating storage location…");

    try {
      const result = await window.api.setStorageLocation(pendingStorageRoot, moveExisting);
      storageInfo = result;
      closeModal("storage-location-modal");
      resetStorageLocationModal();

      if (onStorageLocationChanged) {
        await onStorageLocationChanged(result);
      }
    } catch (err) {
      setStorageLocationStatus(err.message || "Failed to update storage location.", "error");
      saveBtn.disabled = false;
    }
  }

  function updateBrand(storeName, siteId, dbPath) {
    const sub = $("brand-sub");
    if (!sub) return;
    activeDbPath = dbPath || null;

    if (!storeName || !dbPath) {
      sub.textContent = "Select a store";
      sub.disabled = true;
      sub.title = "Select a store to reveal its database file";
      return;
    }

    const site = siteId ? ` · SITE ${siteId}` : "";
    sub.textContent = `${shortenHomePath(dbPath)}${site}`;
    sub.disabled = false;
    sub.title = `Show in Finder: ${dbPath}`;
  }

  async function revealActiveDbPath() {
    if (!activeDbPath) return;
    try {
      await window.api.showItemInFolder(activeDbPath);
    } catch (err) {
      alert(err.message || "Could not open the database location.");
    }
  }

  function updateCounts({ batches = 0, invoices = 0, recons = 0 } = {}) {
    const b = $("ct-batches");
    const i = $("ct-invoices");
    const r = $("ct-recons");
    if (b) b.textContent = String(batches);
    if (i) i.textContent = String(invoices);
    if (r) r.textContent = String(recons);
  }

  function updateGaugeFromBatches(batches, summary) {
    let received = 0;
    let missing = 0;
    let expected = 0;
    let matchedLike = 0;
    let mismatchNet = 0;
    let missingFromInvoiceNet = 0;

    (batches || []).forEach((batch) => {
      const net = Number(batch.net_amount) || 0;
      const status = batch.match_status || "unmatched";
      if (status === "matched" || status === "over_credited") {
        received += net;
        matchedLike += 1;
      } else if (status === "mismatch") {
        mismatchNet += net;
        matchedLike += 1;
      } else if (status === "expected_on_next_invoice") {
        expected += net;
      } else if (status === "missing_from_invoice") {
        missingFromInvoiceNet += net;
        missing += net;
      } else {
        // unmatched, reversed, and other unsettled statuses count as missing
        missing += net;
      }
    });

    // Prefer reconciliation shortfall math: only uncredited mismatch amount is missing.
    let mismatchShortfall = 0;
    if (summary && summary.totalMissingCredit != null) {
      mismatchShortfall = Math.max(
        0,
        Math.round((Number(summary.totalMissingCredit) - missingFromInvoiceNet) * 100) / 100
      );
    }
    received += Math.max(0, Math.round((mismatchNet - mismatchShortfall) * 100) / 100);
    missing += mismatchShortfall;

    drawGauge(received, missing, expected);
    $("leg-received").textContent = usd(received);
    $("leg-missing").textContent = usd(missing);
    $("leg-pending").textContent = usd(expected);

    const dates = (batches || []).map((b) => b.batch_date).filter(Boolean).sort();
    if (dates.length) {
      $("gauge-period").textContent =
        `${fmtDateShort(dates[0])} – ${fmtDateShort(dates[dates.length - 1])}`.toUpperCase();
    } else {
      $("gauge-period").textContent = "—";
    }

    const depositSub = $("st-deposit-sub");
    if (depositSub) {
      depositSub.textContent = `${matchedLike} matched batches, gross`;
    }
  }

  function updateHeroDiscStyle(creditDiscrepancy) {
    const el = $("reconcile-credit-gap");
    if (!el) return;
    if (creditDiscrepancy == null || Number.isNaN(Number(creditDiscrepancy))) {
      el.classList.remove("pos", "neg");
      return;
    }
    const disc = Number(creditDiscrepancy);
    el.classList.toggle("pos", Math.abs(disc) < 1);
    el.classList.toggle("neg", Math.abs(disc) >= 1);
  }

  function updateHeroFromResult(result) {
    if (!result || !result.summary) {
      updateHeroDiscStyle(null);
      const discSub = $("st-disc-sub");
      if (discSub) discSub.textContent = "no reconciliation runs yet";
      return;
    }
    updateHeroDiscStyle(result.summary.creditDiscrepancy);
    const discSub = $("st-disc-sub");
    if (discSub) {
      const runAt = result.runAt ? StoreSelector.formatDateTime(result.runAt) : "";
      discSub.textContent = runAt
        ? `last preview ${runAt}`
        : "net on batches missing from invoice";
    }
  }

  function init(options = {}) {
    onStorageLocationChanged = options.onStorageLocationChanged || null;

    document.querySelectorAll(".tabs[aria-label='Sections'] .tab").forEach((tab) => {
      tab.addEventListener("click", () => showPanel(tab.dataset.panel));
    });

    $("brand-sub")?.addEventListener("click", () => {
      revealActiveDbPath();
    });

    $("change-storage-btn")?.addEventListener("click", () => {
      openStorageLocationModal();
    });

    $("storage-choose-btn")?.addEventListener("click", () => {
      chooseStorageFolder();
    });

    $("storage-save-btn")?.addEventListener("click", () => {
      saveStorageLocation();
    });

    $("add-pdf-btn")?.addEventListener("click", () => {
      setIngestPanel("chevron");
      openModal("add-pdf-modal");
    });

    document.querySelectorAll("[data-close-modal]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.closeModal;
        if (id === "add-pdf-modal") closeAddPdfModal();
        else closeModal(id);
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("add-pdf-modal")?.hidden) closeAddPdfModal();
      else if (!$("manual-batch-modal")?.hidden) closeModal("manual-batch-modal");
      else if (!$("store-form-modal")?.hidden) closeModal("store-form-modal");
      else if (!$("storage-location-modal")?.hidden) closeModal("storage-location-modal");
      else if (typeof StoreSelector !== "undefined") StoreSelector.setSidebarOpen(false);
    });

    document.querySelectorAll("#add-pdf-modal .modal-tabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => setIngestPanel(tab.dataset.ingestPanel));
    });

    drawGauge(0, 0, 0);
  }

  return {
    init,
    showPanel,
    openModal,
    closeModal,
    closeAddPdfModal,
    updateBrand,
    updateCounts,
    updateGaugeFromBatches,
    updateHeroFromResult,
    updateHeroDiscStyle,
    statusPill,
    usd,
  };
})();
