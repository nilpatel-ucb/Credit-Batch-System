const StoreSelector = (() => {
  let activeStore = null;
  let onStoreChange = null;

  function formatMoney(value) {
    return Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatDate(isoDate) {
    if (!isoDate) return "";
    const [year, month, day] = isoDate.split("-").map(Number);
    return `${month}/${day}/${year}`;
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString();
  }

  function stripLeadingZeros(batchNumber) {
    const stripped = String(batchNumber).replace(/^0+/, "");
    return stripped || "0";
  }

  async function refreshStoreList() {
    const stores = await window.api.listStores();
    const listEl = document.getElementById("store-list");
    listEl.innerHTML = "";

    if (stores.length === 0) {
      const empty = document.createElement("p");
      empty.className = "active-store";
      empty.textContent = "No stores yet";
      listEl.appendChild(empty);
      return stores;
    }

    for (const name of stores) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "store-item" + (name === activeStore ? " active" : "");
      btn.textContent = name;
      btn.addEventListener("click", () => openStore(name));
      listEl.appendChild(btn);
    }
    return stores;
  }

  async function openStore(name) {
    const result = await window.api.openStore(name);
    activeStore = result.name;
    document.getElementById("active-store").textContent = `Active: ${result.name} (${result.batchCount} batches)`;
    document.getElementById("batch-count-badge").textContent = String(result.batchCount);
    await refreshStoreList();
    if (onStoreChange) {
      await onStoreChange(result);
    }
  }

  async function createStore(name) {
    await window.api.createStore(name);
    await refreshStoreList();
    await openStore(name);
  }

  function getActiveStore() {
    return activeStore;
  }

  function init(handlers) {
    onStoreChange = handlers.onStoreChange;

    document.getElementById("create-store-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("new-store-name");
      const name = input.value.trim();
      if (!name) return;
      try {
        await createStore(name);
        input.value = "";
      } catch (err) {
        alert(err.message || "Failed to create store.");
      }
    });

    refreshStoreList().then(async (stores) => {
      if (stores.length > 0 && !activeStore) {
        await openStore(stores[0]);
      }
    });
  }

  return {
    init,
    openStore,
    refreshStoreList,
    getActiveStore,
    formatMoney,
    formatDate,
    formatDateTime,
    stripLeadingZeros,
  };
})();
