const ReconcileUI = (() => {
  let storeOpen = false;
  let onReconcileComplete = null;
  let scopeBatches = [];
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
    if (!enabled) {
      pendingConfirmCount = 0;
    }
    updateConfirmButton();
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
  }

  function renderCoverage(result) {
    if (!result) {
      document.getElementById("reconcile-coverage").textContent = "";
      document.getElementById("reconcile-coverage-warning").hidden = true;
      return;
    }

    const summary = result.summary;
    const invoiceLabel =
      result.invoiceCount === 1 ? "1 invoice" : `${result.invoiceCount} invoices`;
    const reversedCount = summary.reversedCount || 0;
    const overCreditedCount = summary.overCreditedCount || 0;
    const mismatchCount = summary.mismatchCount || 0;
    const pending = result.pendingConfirmCount || summary.matchedCount || 0;
    const text = `Open items: ${summary.scopedBatchCount} batches, ${summary.lineCount} invoice lines across ${invoiceLabel}, ${pending} pending confirm, ${summary.missingFromInvoiceCount} missing from invoices, ${reversedCount} reversed, ${overCreditedCount} over-credited, ${mismatchCount} amount mismatches, ${summary.unmatchedLineCount} unmatched lines.`;
    document.getElementById("reconcile-coverage").textContent = text;

    const warningEl = document.getElementById("reconcile-coverage-warning");
    const showWarning =
      summary.missingFromInvoiceCount > 0 ||
      summary.unmatchedLineCount > 0 ||
      reversedCount > 0 ||
      overCreditedCount > 0 ||
      mismatchCount > 0;
    warningEl.hidden = !showWarning;
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

  function renderBatchesTable(batches) {
    const tbody = document.querySelector("#reconcile-batches-table tbody");
    document.getElementById("reconcile-batch-count").textContent = String(batches.length);

    if (!batches || batches.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="4">No open batches to reconcile</td></tr>';
      return;
    }

    tbody.innerHTML = sortBatches(batches)
      .map(
        (batch) => `<tr class="${batchRowStatusClass(batch.match_status)}">
          <td>${StoreSelector.formatDate(batch.batch_date)}</td>
          <td>${StoreSelector.stripLeadingZeros(batch.batch_number)}</td>
          <td class="num">${StoreSelector.formatMoney(batch.net_amount)}</td>
          <td>${formatMatchStatus(batch.match_status)}</td>
        </tr>`
      )
      .join("");
  }

  function renderLinesTable(lines) {
    const tbody = document.querySelector("#reconcile-lines-table tbody");
    document.getElementById("reconcile-line-count").textContent = String(lines.length);

    if (!lines || lines.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="6">No open invoice lines to reconcile</td></tr>';
      return;
    }

    tbody.innerHTML = sortLines(lines)
      .map(
        (line) => `<tr class="${lineRowStatusClass(line.match_status)}">
          <td>${line.invoice_number || ""}</td>
          <td>${line.invoice_line_id}</td>
          <td>${StoreSelector.stripLeadingZeros(line.batch_number)}</td>
          <td>${StoreSelector.formatDate(line.inv_date)}</td>
          <td class="num">${StoreSelector.formatMoney(line.amount)}</td>
          <td>${formatMatchStatus(line.match_status)}</td>
        </tr>`
      )
      .join("");
  }

  function renderScope(scope) {
    if (!scope) {
      scopeBatches = [];
      pendingConfirmCount = 0;
      renderBatchesTable([]);
      renderLinesTable([]);
      updateConfirmButton();
      return;
    }

    scopeBatches = scope.batches;
    pendingConfirmCount = Number(scope.pendingConfirmCount || 0);
    renderBatchesTable(scope.batches);
    renderLinesTable(scope.lines);
    updateConfirmButton();
  }

  function render(result, batches = scopeBatches) {
    if (!result) {
      renderSummary(null);
      renderCoverage(null);
      return;
    }

    if (result.pendingConfirmCount != null) {
      pendingConfirmCount = Number(result.pendingConfirmCount);
      updateConfirmButton();
    }

    renderSummary(result.summary, batches);
    renderCoverage(result);
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

    if (!runs || runs.length === 0) {
      expandedRunId = null;
      list.innerHTML = '<p class="empty-hint">No confirmed reconciliations yet</p>';
      return;
    }

    list.innerHTML = runs
      .map((run) => {
        const open = expandedRunId === run.id ? "open" : "";
        return `<details class="reconciled-run" data-run-id="${run.id}" ${open}>
          <summary class="reconciled-run-summary">
            <span class="reconciled-run-title">${StoreSelector.formatDateTime(run.run_at)}</span>
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
    pendingConfirmCount = 0;
    expandedRunId = null;
    renderSummary(null);
    renderCoverage(null);
    renderBatchesTable([]);
    renderLinesTable([]);
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
