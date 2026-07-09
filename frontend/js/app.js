const App = (() => {
  async function renderBatches() {
    const tbody = document.querySelector("#batches-table tbody");
    const activeStore = StoreSelector.getActiveStore();

    if (!activeStore) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="8">Open a store to view batches</td></tr>';
      document.getElementById("batch-count-badge").textContent = "0";
      return;
    }

    const batches = await window.api.getBatches();
    document.getElementById("batch-count-badge").textContent = String(batches.length);

    if (batches.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="8">No batches yet — upload a Chevron PDF</td></tr>';
      return;
    }

    tbody.innerHTML = batches
      .map(
        (b) => `<tr>
          <td>${StoreSelector.formatDate(b.batch_date)}</td>
          <td>${StoreSelector.stripLeadingZeros(b.batch_number)}</td>
          <td class="num">${StoreSelector.formatMoney(b.gross_amount)}</td>
          <td class="num">${StoreSelector.formatMoney(b.total_fee)}</td>
          <td class="num">${StoreSelector.formatMoney(b.net_amount)}</td>
          <td>${b.site_id}</td>
          <td>${b.source_pdf || ""}</td>
          <td>${StoreSelector.formatDateTime(b.ingested_at)}</td>
        </tr>`
      )
      .join("");
  }

  async function onStoreChange() {
    const active = !!StoreSelector.getActiveStore();
    BatchIngestUI.setStoreOpen(active);
    await renderBatches();
  }

  async function onIngestComplete() {
    await renderBatches();
    const activeStore = StoreSelector.getActiveStore();
    if (activeStore) {
      const result = await window.api.openStore(activeStore);
      StoreSelector.setActiveStoreInfo(result.name, result.site_id, result.batchCount);
    }
  }

  function init() {
    StoreSelector.init({ onStoreChange });
    BatchIngestUI.init({ onIngestComplete });
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
