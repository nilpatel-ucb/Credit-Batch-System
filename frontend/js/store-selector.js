const StoreSelector = (() => {
  const SIDEBAR_COLLAPSED_KEY = "credit-batch.store-sidebar-collapsed";

  let activeStore = null;
  let activeSiteId = null;
  let onStoreChange = null;
  let sidebarCollapsed = false;

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

  function formatStoreLabel(store) {
    if (typeof store === "string") {
      return store;
    }
    if (store.site_id) {
      return `${store.name} (${store.site_id})`;
    }
    return store.name;
  }

  function setEditStoreStatus(message, type = "info") {
    const el = document.getElementById("edit-store-status");
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.className = "edit-store-status";
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.className = `edit-store-status ${type}`;
  }

  function populateEditStoreForm(name, siteId) {
    const section = document.getElementById("edit-store-section");
    const nameInput = document.getElementById("edit-store-name");
    const siteInput = document.getElementById("edit-store-site-id");

    if (!name) {
      section.hidden = true;
      nameInput.value = "";
      siteInput.value = "";
      setEditStoreStatus("");
      return;
    }

    section.hidden = false;
    nameInput.value = name;
    siteInput.value = siteId || "";
    setEditStoreStatus("");
  }

  function setActiveStoreInfo(name, siteId, batchCount) {
    activeStore = name;
    activeSiteId = siteId || null;
    const siteLabel = siteId ? ` · site ${siteId}` : "";
    document.getElementById("active-store").textContent =
      `Active: ${name}${siteLabel} (${batchCount} batches)`;
    document.getElementById("batch-count-badge").textContent = String(batchCount);
    populateEditStoreForm(name, siteId);
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
      populateEditStoreForm(null);
      return stores;
    }

    for (const store of stores) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "store-item" + (store.name === activeStore ? " active" : "");
      btn.textContent = formatStoreLabel(store);
      btn.addEventListener("click", () => openStore(store.name));
      listEl.appendChild(btn);
    }
    return stores;
  }

  async function openStore(name) {
    const result = await window.api.openStore(name);
    setActiveStoreInfo(result.name, result.site_id, result.batchCount);
    await refreshStoreList();
    if (onStoreChange) {
      await onStoreChange(result);
    }
  }

  async function createStore(name, siteId) {
    await window.api.createStore(name, siteId);
    await refreshStoreList();
    await openStore(name);
  }

  async function updateStore(name, siteId) {
    const result = await window.api.updateStore(name, siteId);
    setActiveStoreInfo(result.name, result.site_id, result.batchCount);
    await refreshStoreList();
    if (onStoreChange) {
      await onStoreChange(result);
    }
    return result;
  }

  function getActiveStore() {
    return activeStore;
  }

  function getActiveSiteId() {
    return activeSiteId;
  }

  function applySidebarCollapsed(collapsed) {
    sidebarCollapsed = collapsed;
    const layout = document.getElementById("app-layout");
    const openBtn = document.getElementById("store-sidebar-open-btn");
    const closeBtn = document.getElementById("store-sidebar-close-btn");

    layout.classList.toggle("store-sidebar-collapsed", collapsed);
    openBtn.hidden = !collapsed;
    closeBtn.setAttribute("aria-expanded", String(!collapsed));
    openBtn.setAttribute("aria-expanded", String(!collapsed));

    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Ignore storage failures (private mode, etc.)
    }
  }

  function toggleSidebar() {
    applySidebarCollapsed(!sidebarCollapsed);
  }

  function initSidebarToggle() {
    const closeBtn = document.getElementById("store-sidebar-close-btn");
    const openBtn = document.getElementById("store-sidebar-open-btn");

    closeBtn.addEventListener("click", () => applySidebarCollapsed(true));
    openBtn.addEventListener("click", () => applySidebarCollapsed(false));

    let initialCollapsed = false;
    try {
      initialCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      initialCollapsed = false;
    }
    applySidebarCollapsed(initialCollapsed);
  }

  function init(handlers) {
    onStoreChange = handlers.onStoreChange;
    initSidebarToggle();

    document.getElementById("create-store-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById("new-store-name");
      const siteInput = document.getElementById("new-store-site-id");
      const name = nameInput.value.trim();
      const siteId = siteInput.value.trim();
      if (!name || !siteId) return;
      try {
        await createStore(name, siteId);
        nameInput.value = "";
        siteInput.value = "";
      } catch (err) {
        alert(err.message || "Failed to create store.");
      }
    });

    document.getElementById("edit-store-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!activeStore) {
        setEditStoreStatus("Select a store first.", "error");
        return;
      }

      const name = document.getElementById("edit-store-name").value.trim();
      const siteId = document.getElementById("edit-store-site-id").value.trim();
      if (!name || !siteId) return;

      try {
        await updateStore(name, siteId);
        setEditStoreStatus("Store updated.", "success");
      } catch (err) {
        setEditStoreStatus(err.message || "Failed to update store.", "error");
      }
    });

    refreshStoreList().then(async (stores) => {
      if (stores.length > 0 && !activeStore) {
        await openStore(stores[0].name);
      }
    });
  }

  return {
    init,
    openStore,
    refreshStoreList,
    updateStore,
    setActiveStoreInfo,
    getActiveStore,
    getActiveSiteId,
    toggleSidebar,
    applySidebarCollapsed,
    formatMoney,
    formatDate,
    formatDateTime,
    stripLeadingZeros,
  };
})();
