const ReconcileUI = (() => {
  let storeOpen = false;
  let onReconcileComplete = null;
  let scopeBatches = [];
  let scopeLines = [];
  let batchSearchQuery = "";
  let batchSearchToken = 0;
  let pendingConfirmCount = 0;
  let expandedRunId = null;

  function formatMatchStatus(status) {
    switch (status) {
      case "matched":
        return "Matched";
      case "missing_from_invoice":
        return "Missing from invoice";
      case "reversed":
        return "Reversed (net zero)";
      case "over_credited":
        return "Over-credited";
      case "mismatch":
        return "Amount mismatch";
      case "ambiguous":
        return "Ambiguous";
      case "unmatched":
      default:
        return "Unmatched";
    }
  }

  function isProblemBatchStatus(status) {
    return (
      status === "missing_from_invoice" ||
      status === "reversed" ||
      status === "over_credited" ||
      status === "mismatch" ||
      status === "unmatched"
    );
  }

  function isProblemLineStatus(status) {
    return (
      status === "unmatched" ||
      status === "ambiguous" ||
      status === "missing_from_invoice" ||
      status === "reversed" ||
      status === "over_credited" ||
      status === "mismatch"
    );
  }

  function batchSortRank(status) {
    if (isProblemBatchStatus(status)) return 0;
    if (status === "matched") return 1;
    return 2;
  }

  function lineSortRank(status) {
    if (isProblemLineStatus(status)) return 0;
    if (status === "matched") return 1;
    return 2;
  }

  function batchRowStatusClass(status) {
    switch (status) {
      case "matched":
        return "row-reconcile-matched";
      case "missing_from_invoice":
      case "reversed":
      case "over_credited":
      case "mismatch":
      case "unmatched":
        return "row-reconcile-missing";
      default:
        return "";
    }
  }

  function lineRowStatusClass(status) {
    switch (status) {
      case "matched":
        return "row-reconcile-matched";
      case "missing_from_invoice":
      case "reversed":
      case "over_credited":
      case "mismatch":
      case "unmatched":
      case "ambiguous":
        return "row-reconcile-missing";
      default:
        return "";
    }
  }

  function sumMissingFromInvoiceCredit(batches) {
    if (!batches || batches.length === 0) {
      return 0;
    }

    return batches
      .filter((batch) => batch.match_status === "missing_from_invoice")
      .reduce((sum, batch) => sum + Number(batch.net_amount), 0);
  }

  function missingCreditValue(summary, batches = scopeBatches) {
    if (batches && batches.length > 0) {
      return sumMissingFromInvoiceCredit(batches);
    }
    return Number(summary?.totalMissingCredit || 0);
  }

  function setStatus(message, type = "info") {
    const el = document.getElementById("reconcile-status");
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.className = `status-message ${type}`;
    el.textContent = message;
  }

  function updateConfirmButton() {
    const btn = document.getElementById("reconcile-confirm-btn");
    btn.disabled = !storeOpen || pendingConfirmCount <= 0;
  }

  function setControlsEnabled(enabled) {
    storeOpen = enabled;
    document.getElementById("reconcile-run-btn").disabled = !enabled;
    document.getElementById("batch-search-input").disabled = !enabled;
    document.getElementById("batch-search-clear-btn").disabled =
      !enabled || !batchSearchQuery;
    if (!enabled) {
      pendingConfirmCount = 0;
      clearBatchSearch({ render: false });
    }
    updateConfirmButton();
  }

  function normalizeBatchSearch(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    return StoreSelector.stripLeadingZeros(trimmed);
  }

  function matchesBatchSearch(batchNumber, query) {
    if (!query) return true;
    const normalized = normalizeBatchSearch(batchNumber);
    return normalized === query || normalized.startsWith(query);
  }

  function filterByBatchSearch(batches, lines) {
    const query = normalizeBatchSearch(batchSearchQuery);
    if (!query) {
      return { batches, lines, query: "" };
    }
    return {
      batches: batches.filter((batch) => matchesBatchSearch(batch.batch_number, query)),
      lines: lines.filter((line) => matchesBatchSearch(line.batch_number, query)),
      query,
    };
  }

  function updateBatchSearchHint(filtered, reconciledCount = 0) {
    const hint = document.getElementById("batch-search-hint");
    if (!filtered.query) {
      hint.hidden = true;
      hint.textContent = "";
      return;
    }

    const batchLabel =
      filtered.batches.length === 1 ? "1 open batch" : `${filtered.batches.length} open batches`;
    const lineLabel =
      filtered.lines.length === 1
        ? "1 open invoice line"
        : `${filtered.lines.length} open invoice lines`;
    const reconciledLabel =
      reconciledCount === 1
        ? "1 reconciled match"
        : `${reconciledCount} reconciled matches`;
    hint.hidden = false;
    hint.textContent = `Showing ${batchLabel}, ${lineLabel}, and ${reconciledLabel} for batch #${filtered.query}.`;
  }

  function setBatchSearchResultsVisible(visible) {
    const panel = document.getElementById("batch-search-results");
    if (panel) panel.hidden = !visible;
  }

  function statusPillHtml(status) {
    if (typeof DashboardUI !== "undefined") {
      const [pillClass, pillLabel] = DashboardUI.statusPill(status);
      return `<span class="pill ${pillClass}">${pillLabel}</span>`;
    }
    return formatMatchStatus(status);
  }

  function renderOpenBatchSearchResults(batches, query) {
    const countEl = document.getElementById("batch-search-open-batches-count");
    const tbody = document.querySelector("#batch-search-open-batches-table tbody");
    if (!countEl || !tbody) return;

    countEl.textContent = String(batches.length);
    if (!query) {
      tbody.innerHTML = "";
      return;
    }

    if (!batches.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No open batches matching #${query}</td></tr>`;
      return;
    }

    tbody.innerHTML = sortBatches(batches)
      .map(
        (batch) => `<tr class="${batchRowStatusClass(batch.match_status)}">
          <td class="mono">${StoreSelector.formatDate(batch.batch_date)}</td>
          <td class="mono">${StoreSelector.stripLeadingZeros(batch.batch_number)}</td>
          <td class="num">${StoreSelector.formatMoney(batch.net_amount)}</td>
          <td>${statusPillHtml(batch.match_status)}</td>
          <td class="mono" style="color:var(--ink-3);font-size:11.5px">${
            batch.source_pdf || "—"
          }</td>
        </tr>`
      )
      .join("");
  }

  function renderOpenLineSearchResults(lines, query) {
    const countEl = document.getElementById("batch-search-open-lines-count");
    const tbody = document.querySelector("#batch-search-open-lines-table tbody");
    if (!countEl || !tbody) return;

    countEl.textContent = String(lines.length);
    if (!query) {
      tbody.innerHTML = "";
      return;
    }

    if (!lines.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No open invoice lines matching #${query}</td></tr>`;
      return;
    }

    tbody.innerHTML = sortLines(lines)
      .map(
        (line) => `<tr class="${lineRowStatusClass(line.match_status)}">
          <td class="mono">${line.invoice_number || ""}</td>
          <td class="mono">${line.invoice_line_id}</td>
          <td class="mono">${StoreSelector.stripLeadingZeros(line.batch_number)}</td>
          <td class="mono">${StoreSelector.formatDate(line.inv_date)}</td>
          <td class="num">${StoreSelector.formatMoney(line.amount)}</td>
          <td>${statusPillHtml(line.match_status)}</td>
        </tr>`
      )
      .join("");
  }

  function renderReconciledSearchResults(rows, query) {
    const countEl = document.getElementById("batch-search-reconciled-count");
    const tbody = document.querySelector("#batch-search-reconciled-table tbody");
    if (!countEl || !tbody) return;

    countEl.textContent = String(rows.length);

    if (!query) {
      tbody.innerHTML = "";
      return;
    }

    if (!rows.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No reconciled matches for #${query}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map(
        (row) => `<tr class="row-reconcile-matched">
          <td class="mono">${StoreSelector.formatDate(row.batchDate)}</td>
          <td class="mono">${StoreSelector.stripLeadingZeros(row.batchNumber)}</td>
          <td class="num">${
            row.netAmount != null ? StoreSelector.formatMoney(row.netAmount) : "—"
          }</td>
          <td class="mono">${row.invoiceNumber || "—"}</td>
          <td class="mono">${row.invoiceLineId || "—"}</td>
          <td class="num">${
            row.invoiceAmount != null
              ? StoreSelector.formatMoney(row.invoiceAmount)
              : "—"
          }</td>
          <td>${row.runAt ? StoreSelector.formatDateTime(row.runAt) : "—"}</td>
        </tr>`
      )
      .join("");
  }

  function clearBatchSearchPanels() {
    setBatchSearchResultsVisible(false);
    renderOpenBatchSearchResults([], "");
    renderOpenLineSearchResults([], "");
    renderReconciledSearchResults([], "");
  }

  async function renderFilteredScope() {
    const filtered = filterByBatchSearch(scopeBatches, scopeLines);
    renderBatchesTable(filtered.batches, {
      emptyMessage: filtered.query
        ? `No open batches matching #${filtered.query}`
        : "No open batches to reconcile",
    });
    renderLinesTable(filtered.lines, {
      emptyMessage: filtered.query
        ? `No open invoice lines matching #${filtered.query}`
        : "No open invoice lines to reconcile",
    });
    document.getElementById("batch-search-clear-btn").disabled =
      !storeOpen || !batchSearchQuery;

    if (!filtered.query || !storeOpen) {
      batchSearchToken += 1;
      clearBatchSearchPanels();
      updateBatchSearchHint(filtered, 0);
      return;
    }

    // Show open matches immediately from the in-memory reconciliation scope.
    setBatchSearchResultsVisible(true);
    renderOpenBatchSearchResults(filtered.batches, filtered.query);
    renderOpenLineSearchResults(filtered.lines, filtered.query);
    renderReconciledSearchResults([], filtered.query);

    const token = ++batchSearchToken;
    updateBatchSearchHint(filtered, 0);

    try {
      const result = await window.api.searchByBatchNumber(filtered.query);
      if (token !== batchSearchToken) return;

      // Prefer API open results so search stays complete even if scope is stale.
      const openBatches = result.openBatches || filtered.batches;
      const openLines = result.openLines || filtered.lines;
      const reconciled = result.reconciled || [];

      renderOpenBatchSearchResults(openBatches, filtered.query);
      renderOpenLineSearchResults(openLines, filtered.query);
      renderReconciledSearchResults(reconciled, filtered.query);
      updateBatchSearchHint(
        {
          query: filtered.query,
          batches: openBatches,
          lines: openLines,
        },
        reconciled.length
      );
    } catch (err) {
      if (token !== batchSearchToken) return;
      renderReconciledSearchResults([], filtered.query);
      updateBatchSearchHint(filtered, 0);
      setStatus(err.message || "Batch search failed.", "error");
    }
  }

  function clearBatchSearch(options = {}) {
    const { render = true } = options;
    batchSearchQuery = "";
    batchSearchToken += 1;
    const input = document.getElementById("batch-search-input");
    if (input) input.value = "";
    document.getElementById("batch-search-clear-btn").disabled = true;
    document.getElementById("batch-search-hint").hidden = true;
    document.getElementById("batch-search-hint").textContent = "";
    clearBatchSearchPanels();
    if (render) {
      renderFilteredScope();
    }
  }

  function renderSummary(summary, batches = scopeBatches) {
    const missingEl = document.getElementById("reconcile-missing-credit");
    const missingValue = missingCreditValue(summary, batches);
    missingEl.textContent =
      summary != null ? StoreSelector.formatMoney(missingValue) : "—";
    missingEl.classList.toggle("highlight-warning", missingValue > 0);

    document.getElementById("reconcile-total-deposit").textContent =
      summary != null ? StoreSelector.formatMoney(summary.totalDeposit) : "—";
    document.getElementById("reconcile-total-fee").textContent =
      summary != null ? StoreSelector.formatMoney(summary.totalFee) : "—";
    document.getElementById("reconcile-total-credit").textContent =
      summary != null ? StoreSelector.formatMoney(summary.totalCredit) : "—";
    document.getElementById("reconcile-invoice-amount").textContent =
      summary != null ? StoreSelector.formatMoney(summary.invoiceTotal) : "—";
    document.getElementById("reconcile-credit-gap").textContent =
      summary != null ? StoreSelector.formatMoney(summary.creditDiscrepancy) : "—";

    if (typeof DashboardUI !== "undefined") {
      DashboardUI.updateHeroDiscStyle(
        summary != null ? summary.creditDiscrepancy : null
      );
    }
  }

  function renderCoverage(result) {
    const coverageEl = document.getElementById("reconcile-coverage");
    const warningEl = document.getElementById("reconcile-coverage-warning");

    if (!result) {
      coverageEl.textContent = StoreSelector.getActiveStore()
        ? "No reconciliation preview yet — click Reconcile store."
        : "Open a store to see reconciliation coverage.";
      warningEl.hidden = true;
      return;
    }

    const summary = result.summary;
    const invoiceLabel =
      result.invoiceCount === 1 ? "1 invoice" : `${result.invoiceCount} invoices`;
    const reversedCount = summary.reversedCount || 0;
    const overCreditedCount = summary.overCreditedCount || 0;
    const mismatchCount = summary.mismatchCount || 0;
    const pending = result.pendingConfirmCount || summary.matchedCount || 0;
    coverageEl.innerHTML = `Open items: <b>${summary.scopedBatchCount}</b> batches, <b>${summary.lineCount}</b> invoice lines across <b>${invoiceLabel}</b> · <b>${pending}</b> pending confirm · <b>${summary.missingFromInvoiceCount}</b> missing · <b>${summary.unmatchedLineCount}</b> unmatched lines`;

    const showWarning =
      summary.missingFromInvoiceCount > 0 ||
      summary.unmatchedLineCount > 0 ||
      reversedCount > 0 ||
      overCreditedCount > 0 ||
      mismatchCount > 0;
    warningEl.hidden = false;
    if (showWarning) {
      warningEl.className = "warn";
      warningEl.textContent =
        "Batch corpus may be incomplete — treat discrepancy as provisional";
    } else {
      warningEl.className = "ok";
      warningEl.textContent = "Coverage complete — discrepancy is final";
    }
  }

  function sortBatches(batches) {
    return [...batches].sort((a, b) => {
      const rankDiff = batchSortRank(a.match_status) - batchSortRank(b.match_status);
      if (rankDiff !== 0) return rankDiff;
      if (a.batch_date !== b.batch_date) return a.batch_date < b.batch_date ? -1 : 1;
      return String(a.batch_number).localeCompare(String(b.batch_number));
    });
  }

  function sortLines(lines) {
    return [...lines].sort((a, b) => {
      const rankDiff = lineSortRank(a.match_status) - lineSortRank(b.match_status);
      if (rankDiff !== 0) return rankDiff;
      if (a.inv_date !== b.inv_date) return a.inv_date < b.inv_date ? -1 : 1;
      return String(a.invoice_line_id).localeCompare(String(b.invoice_line_id));
    });
  }

  function renderBatchesTable(batches, options = {}) {
    const tbody = document.querySelector("#reconcile-batches-table tbody");
    document.getElementById("reconcile-batch-count").textContent = String(batches.length);
    const emptyMessage = options.emptyMessage || "No open batches to reconcile";

    if (!batches || batches.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="4">${emptyMessage}</td></tr>`;
      return;
    }

    tbody.innerHTML = sortBatches(batches)
      .map(
        (batch) => {
          const [pillClass, pillLabel] =
            typeof DashboardUI !== "undefined"
              ? DashboardUI.statusPill(batch.match_status)
              : ["pill-unmatched", formatMatchStatus(batch.match_status)];
          return `<tr class="${batchRowStatusClass(batch.match_status)}">
          <td class="mono">${StoreSelector.formatDate(batch.batch_date)}</td>
          <td class="mono">${StoreSelector.stripLeadingZeros(batch.batch_number)}</td>
          <td class="num">${StoreSelector.formatMoney(batch.net_amount)}</td>
          <td><span class="pill ${pillClass}">${pillLabel}</span></td>
        </tr>`;
        }
      )
      .join("");
  }

  function renderLinesTable(lines, options = {}) {
    const tbody = document.querySelector("#reconcile-lines-table tbody");
    document.getElementById("reconcile-line-count").textContent = String(lines.length);
    const emptyMessage = options.emptyMessage || "No open invoice lines to reconcile";

    if (!lines || lines.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${emptyMessage}</td></tr>`;
      return;
    }

    tbody.innerHTML = sortLines(lines)
      .map(
        (line) => {
          const [pillClass, pillLabel] =
            typeof DashboardUI !== "undefined"
              ? DashboardUI.statusPill(line.match_status)
              : ["pill-unmatched", formatMatchStatus(line.match_status)];
          return `<tr class="${lineRowStatusClass(line.match_status)}">
          <td class="mono">${line.invoice_number || ""}</td>
          <td class="mono">${line.invoice_line_id}</td>
          <td class="mono">${StoreSelector.stripLeadingZeros(line.batch_number)}</td>
          <td class="mono">${StoreSelector.formatDate(line.inv_date)}</td>
          <td class="num">${StoreSelector.formatMoney(line.amount)}</td>
          <td><span class="pill ${pillClass}">${pillLabel}</span></td>
        </tr>`;
        }
      )
      .join("");
  }

  function renderScope(scope) {
    if (!scope) {
      scopeBatches = [];
      scopeLines = [];
      pendingConfirmCount = 0;
      renderFilteredScope();
      updateConfirmButton();
      return;
    }

    scopeBatches = scope.batches;
    scopeLines = scope.lines;
    pendingConfirmCount = Number(scope.pendingConfirmCount || 0);
    renderFilteredScope();
    updateConfirmButton();
  }

  function render(result, batches = scopeBatches) {
    if (!result) {
      renderSummary(null);
      renderCoverage(null);
      if (typeof DashboardUI !== "undefined") {
        DashboardUI.updateHeroFromResult(null);
      }
      return;
    }

    if (result.pendingConfirmCount != null) {
      pendingConfirmCount = Number(result.pendingConfirmCount);
      updateConfirmButton();
    }

    renderSummary(result.summary, batches);
    renderCoverage(result);
    if (typeof DashboardUI !== "undefined") {
      DashboardUI.updateHeroFromResult(result);
    }
  }

  function renderMatchedPairsTable(matched) {
    if (!matched || matched.length === 0) {
      return '<p class="empty-hint">No matched pairs in this run</p>';
    }

    const rows = matched
      .map(
        (row) => `<tr class="row-reconcile-matched">
          <td>${StoreSelector.formatDate(row.batchDate)}</td>
          <td>${StoreSelector.stripLeadingZeros(row.batchNumber)}</td>
          <td class="num">${StoreSelector.formatMoney(row.netAmount)}</td>
          <td>${row.invoiceNumber || "—"}</td>
          <td>${row.invoiceLineId || "—"}</td>
          <td class="num">${
            row.invoiceAmount != null ? StoreSelector.formatMoney(row.invoiceAmount) : "—"
          }</td>
        </tr>`
      )
      .join("");

    return `<div class="table-wrap">
      <table class="reconciled-run-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Batch #</th>
            <th>Net Amount</th>
            <th>Invoice #</th>
            <th>Invoice Line ID</th>
            <th>Invoice Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  async function loadRunDetail(runId) {
    const detailEl = document.getElementById(`reconciled-run-detail-${runId}`);
    if (!detailEl) return;

    detailEl.innerHTML = '<p class="empty-hint">Loading…</p>';
    try {
      const run = await window.api.getReconciliationRun(runId);
      detailEl.innerHTML = renderMatchedPairsTable(run.matched);
    } catch (err) {
      detailEl.innerHTML = `<p class="empty-hint">${err.message || "Failed to load run."}</p>`;
    }
  }

  function renderReconciledRuns(runs) {
    const list = document.getElementById("reconciled-runs-list");
    const badge = document.getElementById("reconciled-run-count-badge");
    badge.textContent = String(runs.length);
    if (typeof DashboardUI !== "undefined") {
      const batchCount = Number(document.getElementById("batch-count-badge")?.textContent || 0);
      const invoiceCount = Number(document.getElementById("invoice-count-badge")?.textContent || 0);
      DashboardUI.updateCounts({
        batches: batchCount,
        invoices: invoiceCount,
        recons: runs.length,
      });
    }

    if (!runs || runs.length === 0) {
      expandedRunId = null;
      list.innerHTML = '<p class="empty-hint">No confirmed reconciliations yet</p>';
      return;
    }

    list.innerHTML = runs
      .map((run) => {
        const open = expandedRunId === run.id ? "open" : "";
        return `<details class="card reconciled-run lift" data-run-id="${run.id}" ${open}>
          <summary class="reconciled-run-summary">
            <div>
              <div class="reconciled-run-title">Confirmed run</div>
              <div class="section-hint">${StoreSelector.formatDateTime(run.run_at)}</div>
            </div>
            <span class="badge">${run.matched_count} matched</span>
            <span class="reconciled-run-credit">${StoreSelector.formatMoney(run.total_credit)}</span>
          </summary>
          <div class="reconciled-run-detail" id="reconciled-run-detail-${run.id}">
            <p class="empty-hint">Expand to load matched pairs</p>
          </div>
        </details>`;
      })
      .join("");

    list.querySelectorAll("details.reconciled-run").forEach((details) => {
      details.addEventListener("toggle", async () => {
        const runId = Number(details.dataset.runId);
        if (details.open) {
          expandedRunId = runId;
          await loadRunDetail(runId);
        } else if (expandedRunId === runId) {
          expandedRunId = null;
        }
      });
    });

    if (expandedRunId) {
      const openDetails = list.querySelector(`details[data-run-id="${expandedRunId}"]`);
      if (openDetails && openDetails.open) {
        loadRunDetail(expandedRunId);
      }
    }
  }

  async function loadReconciledRuns() {
    if (!storeOpen) {
      renderReconciledRuns([]);
      return [];
    }

    const runs = await window.api.listReconciliationRuns();
    renderReconciledRuns(runs);
    return runs;
  }

  function resetView() {
    setControlsEnabled(false);
    scopeBatches = [];
    scopeLines = [];
    pendingConfirmCount = 0;
    expandedRunId = null;
    renderSummary(null);
    renderCoverage(null);
    renderFilteredScope();
    renderReconciledRuns([]);
    setStatus("");
  }

  async function loadScope() {
    if (!storeOpen) {
      renderScope(null);
      renderSummary(null);
      renderCoverage(null);
      renderReconciledRuns([]);
      return null;
    }

    const scope = await window.api.getReconciliationScope();
    renderScope(scope);
    await loadReconciledRuns();

    const lastResult = await window.api.getLastReconciliation();
    if (lastResult) {
      render(lastResult, scope?.batches);
      const runAt = lastResult.runAt ? StoreSelector.formatDateTime(lastResult.runAt) : "";
      if (pendingConfirmCount > 0) {
        setStatus(
          `${pendingConfirmCount} matched pair${pendingConfirmCount === 1 ? "" : "s"} ready to confirm.${runAt ? ` Last preview ${runAt}.` : ""}`,
          "info"
        );
      } else {
        setStatus(
          runAt
            ? `Open problems remain. Last preview ${runAt}.`
            : "Open problems remain.",
          "info"
        );
      }
    } else if (scope && (scope.batches.length > 0 || scope.lines.length > 0)) {
      renderSummary(null);
      renderCoverage(null);
      setStatus(
        "This store has not been reconciled yet. Click Reconcile store to preview matches.",
        "info"
      );
    } else {
      renderSummary(null);
      renderCoverage(null);
      setStatus("");
    }

    return scope;
  }

  async function runReconciliation() {
    if (!storeOpen) {
      setStatus("Open a store to reconcile.", "error");
      return null;
    }

    const button = document.getElementById("reconcile-run-btn");
    button.disabled = true;
    setStatus("Reconciling store…", "info");

    try {
      const result = await window.api.reconcileStore();
      await loadScope();

      const summary = result.summary;
      const issueCount =
        summary.missingFromInvoiceCount +
        (summary.reversedCount || 0) +
        (summary.overCreditedCount || 0) +
        (summary.mismatchCount || 0) +
        summary.unmatchedLineCount;
      setStatus(
        `Preview: ${summary.matchedCount} matched, ${summary.missingFromInvoiceCount} missing from invoices, ${summary.reversedCount || 0} reversed, ${summary.overCreditedCount || 0} over-credited, ${summary.mismatchCount || 0} amount mismatches, ${summary.unmatchedLineCount} unmatched lines, ${StoreSelector.formatMoney(missingCreditValue(summary))} missing credit.${summary.matchedCount > 0 ? " Click Confirm matches to archive matched pairs." : ""}`,
        issueCount > 0 ? "info" : "success"
      );

      if (onReconcileComplete) {
        await onReconcileComplete(result);
      }
      return result;
    } catch (err) {
      setStatus(err.message || "Reconciliation failed.", "error");
      return null;
    } finally {
      button.disabled = !storeOpen;
      updateConfirmButton();
    }
  }

  async function confirmReconciliation() {
    if (!storeOpen) {
      setStatus("Open a store to confirm.", "error");
      return null;
    }

    const button = document.getElementById("reconcile-confirm-btn");
    button.disabled = true;
    setStatus("Confirming matched pairs…", "info");

    try {
      const run = await window.api.confirmReconciliation();
      await loadScope();
      setStatus(
        `Confirmed ${run.matchedCount} matched pair${run.matchedCount === 1 ? "" : "s"} into Reconciled (${StoreSelector.formatDateTime(run.runAt)}).`,
        "success"
      );

      if (onReconcileComplete) {
        await onReconcileComplete(run);
      }
      return run;
    } catch (err) {
      setStatus(err.message || "Confirm failed.", "error");
      updateConfirmButton();
      return null;
    }
  }

  async function onStoreOpen() {
    setControlsEnabled(true);
    await loadScope();
  }

  function init(handlers) {
    onReconcileComplete = handlers.onReconcileComplete;

    document.getElementById("reconcile-run-btn").addEventListener("click", async () => {
      await runReconciliation();
    });

    document.getElementById("reconcile-confirm-btn").addEventListener("click", async () => {
      await confirmReconciliation();
    });

    const searchInput = document.getElementById("batch-search-input");
    searchInput.addEventListener("input", () => {
      batchSearchQuery = searchInput.value;
      renderFilteredScope();
    });

    document.getElementById("batch-search-clear-btn").addEventListener("click", () => {
      clearBatchSearch();
      searchInput.focus();
    });

    resetView();
  }

  async function refresh() {
    if (storeOpen) {
      await loadScope();
    }
  }

  return {
    init,
    resetView,
    onStoreOpen,
    runReconciliation,
    confirmReconciliation,
    render,
    refresh,
  };
})();
