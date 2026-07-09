const ReconcileUI = (() => {
  let activeInvoiceId = null;
  let currentResult = null;
  let onReconcileComplete = null;

  function section() {
    return document.getElementById("reconcile-section");
  }

  function formatPeriod(start, end) {
    if (!start || !end) return "—";
    return `${StoreSelector.formatDate(start)} – ${StoreSelector.formatDate(end)}`;
  }

  function formatExceptionType(type) {
    switch (type) {
      case "missing_from_invoice":
        return "Missing from invoice";
      case "unmatched_line":
        return "Unmatched line";
      case "ambiguous":
        return "Ambiguous";
      case "mismatch":
        return "Amount mismatch";
      default:
        return type;
    }
  }

  function exceptionTypeClass(type) {
    switch (type) {
      case "missing_from_invoice":
        return "flag-missing";
      case "unmatched_line":
        return "flag-unmatched";
      case "mismatch":
        return "flag-mismatch";
      case "ambiguous":
        return "flag-ambiguous";
      default:
        return "flag-default";
    }
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

  function renderSummary(summary, invoiceNumber) {
    const missingEl = document.getElementById("reconcile-missing-credit");
    const missingValue = Number(summary.totalMissingCredit || 0);
    missingEl.textContent = StoreSelector.formatMoney(missingValue);
    missingEl.classList.toggle("highlight-warning", missingValue > 0);

    document.getElementById("reconcile-invoice-number").textContent = invoiceNumber || "—";
    document.getElementById("reconcile-total-deposit").textContent = StoreSelector.formatMoney(
      summary.totalDeposit
    );
    document.getElementById("reconcile-total-fee").textContent = StoreSelector.formatMoney(
      summary.totalFee
    );
    document.getElementById("reconcile-total-credit").textContent = StoreSelector.formatMoney(
      summary.totalCredit
    );
    document.getElementById("reconcile-invoice-amount").textContent = StoreSelector.formatMoney(
      summary.invoiceTotal
    );
    document.getElementById("reconcile-credit-gap").textContent = StoreSelector.formatMoney(
      summary.creditDiscrepancy
    );
  }

  function renderCoverage(result) {
    const summary = result.summary;
    const text = `Invoice period ${formatPeriod(result.periodStart, result.periodEnd)}: ${summary.scopedBatchCount} batches in database, ${summary.lineCount} lines on invoice, ${summary.missingFromInvoiceCount} missing from invoice, ${summary.unmatchedLineCount} unmatched lines.`;
    document.getElementById("reconcile-coverage").textContent = text;

    const warningEl = document.getElementById("reconcile-coverage-warning");
    const showWarning =
      summary.scopedBatchCount < summary.lineCount ||
      summary.missingFromInvoiceCount > 0 ||
      summary.unmatchedLineCount > 0;
    warningEl.hidden = !showWarning;
  }

  function renderExceptions(exceptions) {
    const tbody = document.querySelector("#reconcile-exceptions-table tbody");
    if (!exceptions || exceptions.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="6">No exceptions — all scoped batches and invoice lines reconciled cleanly.</td></tr>';
      return;
    }

    tbody.innerHTML = exceptions
      .map((item) => {
        const amount =
          item.netAmount != null
            ? StoreSelector.formatMoney(item.netAmount)
            : item.invoiceAmount != null
              ? StoreSelector.formatMoney(item.invoiceAmount)
              : "";
        return `<tr>
          <td><span class="flag-badge ${exceptionTypeClass(item.type)}">${formatExceptionType(item.type)}</span></td>
          <td>${item.batchNumber ? StoreSelector.stripLeadingZeros(item.batchNumber) : ""}</td>
          <td>${item.batchDate ? StoreSelector.formatDate(item.batchDate) : ""}</td>
          <td class="num">${amount}</td>
          <td>${item.invoiceLineId || ""}</td>
          <td>${item.message || ""}</td>
        </tr>`;
      })
      .join("");
  }

  function renderMatched(matched) {
    const tbody = document.querySelector("#reconcile-matched-table tbody");
    if (!matched || matched.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="6">No matched batches for this reconciliation run.</td></tr>';
      return;
    }

    tbody.innerHTML = matched
      .map(
        (row) => `<tr>
          <td>${StoreSelector.formatDate(row.batchDate)}</td>
          <td>${StoreSelector.stripLeadingZeros(row.batchNumber)}</td>
          <td class="num">${StoreSelector.formatMoney(row.netAmount)}</td>
          <td>${row.invoiceLineId}</td>
          <td>${StoreSelector.formatDate(row.invDate)}</td>
          <td class="num">${StoreSelector.formatMoney(row.invoiceAmount)}</td>
        </tr>`
      )
      .join("");
  }

  function render(result) {
    if (!result) {
      hide();
      return;
    }

    currentResult = result;
    section().hidden = false;
    renderSummary(result.summary, result.invoiceNumber);
    renderCoverage(result);
    renderExceptions(result.exceptions);
    renderMatched(result.matched);

    const runAt = result.runAt ? StoreSelector.formatDateTime(result.runAt) : "";
    setStatus(runAt ? `Last reconciled ${runAt}.` : "", "info");
  }

  function hide() {
    activeInvoiceId = null;
    currentResult = null;
    section().hidden = true;
    setStatus("");
  }

  async function loadForInvoice(invoiceId, invoiceNumber) {
    if (!invoiceId) {
      hide();
      return null;
    }

    activeInvoiceId = invoiceId;
    document.getElementById("reconcile-invoice-number").textContent = invoiceNumber || "—";
    const result = await window.api.getLastReconciliation(invoiceId);
    if (result) {
      render(result);
    } else {
      section().hidden = false;
      setStatus(
        "This invoice has not been reconciled yet. Click Reconcile to match batches and find missing credit.",
        "info"
      );
      document.getElementById("reconcile-total-deposit").textContent = "—";
      document.getElementById("reconcile-total-fee").textContent = "—";
      document.getElementById("reconcile-total-credit").textContent = "—";
      document.getElementById("reconcile-invoice-amount").textContent = "—";
      document.getElementById("reconcile-credit-gap").textContent = "—";
      document.getElementById("reconcile-missing-credit").textContent = "—";
      document.getElementById("reconcile-coverage").textContent = "";
      document.getElementById("reconcile-coverage-warning").hidden = true;
      document.querySelector("#reconcile-exceptions-table tbody").innerHTML =
        '<tr class="empty-row"><td colspan="6">Run reconciliation to see missing batches and exceptions.</td></tr>';
      document.querySelector("#reconcile-matched-table tbody").innerHTML =
        '<tr class="empty-row"><td colspan="6">No reconciliation results yet.</td></tr>';
    }
    return result;
  }

  async function runReconciliation(invoiceId) {
    if (!invoiceId) {
      setStatus("Select an invoice to reconcile.", "error");
      return null;
    }

    const button = document.getElementById("reconcile-run-btn");
    button.disabled = true;
    setStatus("Reconciling…", "info");

    try {
      const result = await window.api.reconcileInvoice(invoiceId);
      activeInvoiceId = invoiceId;
      render(result);

      const summary = result.summary;
      setStatus(
        `Reconciled invoice ${result.invoiceNumber}: ${summary.matchedCount} matched, ${summary.missingFromInvoiceCount} missing from invoice, ${StoreSelector.formatMoney(summary.totalMissingCredit)} missing credit.`,
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
      button.disabled = false;
    }
  }

  function init(handlers) {
    onReconcileComplete = handlers.onReconcileComplete;

    document.getElementById("reconcile-run-btn").addEventListener("click", async () => {
      if (activeInvoiceId != null) {
        await runReconciliation(activeInvoiceId);
      }
    });

    document.getElementById("collapse-reconcile-btn").addEventListener("click", () => {
      hide();
    });

    hide();
  }

  return {
    init,
    hide,
    render,
    loadForInvoice,
    runReconciliation,
  };
})();
