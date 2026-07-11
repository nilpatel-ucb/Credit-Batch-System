const ReconcileUI = (() => {
  let storeOpen = false;
  let onReconcileComplete = null;
  let scopeBatches = [];

  function formatMatchStatus(status) {
    switch (status) {
      case "matched":
        return "Matched";
      case "missing_from_invoice":
        return "Missing from invoice";
      case "mismatch":
        return "Amount mismatch";
      case "ambiguous":
        return "Ambiguous";
      case "unmatched":
      default:
        return "Unmatched";
    }
  }

  function batchRowStatusClass(status) {
    switch (status) {
      case "matched":
        return "row-reconcile-matched";
      case "missing_from_invoice":
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

  function setControlsEnabled(enabled) {
    storeOpen = enabled;
    document.getElementById("reconcile-run-btn").disabled = !enabled;
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
    const text = `Store ledger: ${summary.scopedBatchCount} batches, ${summary.lineCount} invoice lines across ${invoiceLabel}, ${summary.missingFromInvoiceCount} batches missing from invoices, ${summary.unmatchedLineCount} unmatched lines.`;
    document.getElementById("reconcile-coverage").textContent = text;

    const warningEl = document.getElementById("reconcile-coverage-warning");
    const showWarning =
      summary.missingFromInvoiceCount > 0 || summary.unmatchedLineCount > 0;
    warningEl.hidden = !showWarning;
  }

  function renderBatchesTable(batches) {
    const tbody = document.querySelector("#reconcile-batches-table tbody");
    document.getElementById("reconcile-batch-count").textContent = String(batches.length);

    if (!batches || batches.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="4">No batches in this store yet</td></tr>';
      return;
    }

    tbody.innerHTML = batches
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
        '<tr class="empty-row"><td colspan="6">No invoice lines in this store yet</td></tr>';
      return;
    }

    tbody.innerHTML = lines
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
      renderBatchesTable([]);
      renderLinesTable([]);
      return;
    }

    scopeBatches = scope.batches;
    renderBatchesTable(scope.batches);
    renderLinesTable(scope.lines);
  }

  function render(result, batches = scopeBatches) {
    if (!result) {
      renderSummary(null);
      renderCoverage(null);
      return;
    }

    renderSummary(result.summary, batches);
    renderCoverage(result);
  }

  function resetView() {
    setControlsEnabled(false);
    scopeBatches = [];
    renderSummary(null);
    renderCoverage(null);
    renderBatchesTable([]);
    renderLinesTable([]);
    setStatus("");
  }

  async function loadScope() {
    if (!storeOpen) {
      renderScope(null);
      renderSummary(null);
      renderCoverage(null);
      return null;
    }

    const scope = await window.api.getReconciliationScope();
    renderScope(scope);

    const lastResult = await window.api.getLastReconciliation();
    if (lastResult) {
      render(lastResult, scope?.batches);
      const runAt = lastResult.runAt ? StoreSelector.formatDateTime(lastResult.runAt) : "";
      setStatus(runAt ? `Last reconciled ${runAt}.` : "", "info");
    } else if (scope && (scope.batches.length > 0 || scope.lines.length > 0)) {
      renderSummary(null);
      renderCoverage(null);
      setStatus(
        "This store has not been reconciled yet. Click Reconcile store to match all batches and invoice lines.",
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
      setStatus(
        `Reconciled store: ${summary.matchedCount} matched, ${summary.missingFromInvoiceCount} batches missing from invoices, ${summary.unmatchedLineCount} unmatched lines, ${StoreSelector.formatMoney(missingCreditValue(summary))} missing credit.`,
        summary.missingFromInvoiceCount > 0 || summary.unmatchedLineCount > 0 ? "info" : "success"
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
    render,
    refresh,
  };
})();
