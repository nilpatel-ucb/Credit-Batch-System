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
      document.getElementById("manage-stores-modal")?.hidden !== false &&
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

  function drawGauge(received, missing, pending) {
    const total = received + missing + pending || 1;
    const gap = 6;
    const segs = [
      { el: $("arc-green"), v: received },
      { el: $("arc-red"), v: missing },
      { el: $("arc-slate"), v: pending },
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

  function updateBrand(storeName, siteId) {
    const sub = $("brand-sub");
    if (!sub) return;
    if (!storeName) {
      sub.textContent = "Select a store";
      return;
    }
    const site = siteId ? `SITE ${siteId}` : "LOCAL LEDGER";
    sub.textContent = `${String(storeName).toUpperCase()}.DB · ${site}`;
  }

  function updateCounts({ batches = 0, invoices = 0, recons = 0 } = {}) {
    const b = $("ct-batches");
    const i = $("ct-invoices");
    const r = $("ct-recons");
    if (b) b.textContent = String(batches);
    if (i) i.textContent = String(invoices);
    if (r) r.textContent = String(recons);
  }

  function updateGaugeFromBatches(batches) {
    let received = 0;
    let missing = 0;
    let pending = 0;
    let matchedLike = 0;

    (batches || []).forEach((batch) => {
      const net = Number(batch.net_amount) || 0;
      const status = batch.match_status || "unmatched";
      if (status === "matched" || status === "mismatch" || status === "over_credited") {
        received += net;
        matchedLike += 1;
      } else if (status === "missing_from_invoice" || status === "reversed") {
        missing += net;
      } else {
        pending += net;
      }
    });

    drawGauge(received, missing, pending);
    $("leg-received").textContent = usd(received);
    $("leg-missing").textContent = usd(missing);
    $("leg-pending").textContent = usd(pending);

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

  function init() {
    document.querySelectorAll(".tabs[aria-label='Sections'] .tab").forEach((tab) => {
      tab.addEventListener("click", () => showPanel(tab.dataset.panel));
    });

    $("manage-stores-btn")?.addEventListener("click", () => openModal("manage-stores-modal"));
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
      else if (!$("manage-stores-modal")?.hidden) closeModal("manage-stores-modal");
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
