const StoreSelector = (() => {
  let activeStore = null;
  let activeSiteId = null;
  let onStoreChange = null;
  let sidebarOpen = false;

  function formatMoney(value) {
    return Number(value).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
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

  function updateStoreToggleLabel(name) {
    const label = document.getElementById("store-toggle-label");
    if (!label) return;
    label.textContent = name || "Stores";
  }

  function updateStoreCount(count) {
    const el = document.getElementById("store-sidebar-count");
    if (!el) return;
    el.textContent = count === 1 ? "1 store" : `${count} stores`;
  }

  function setSidebarOpen(open) {
    sidebarOpen = Boolean(open);
    const sidebar = document.getElementById("store-sidebar");
    const backdrop = document.getElementById("store-sidebar-backdrop");
    const toggle = document.getElementById("store-sidebar-toggle");
    if (!sidebar) return;

    if (sidebarOpen) {
      sidebar.hidden = false;
      if (backdrop) backdrop.hidden = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          sidebar.classList.add("open");
          backdrop?.classList.add("open");
        });
      });
      toggle?.setAttribute("aria-expanded", "true");
      const search = document.getElementById("store-search-input");
      if (search) {
        search.value = "";
        filterStoreList("");
        search.focus();
      }
    } else {
      sidebar.classList.remove("open");
      backdrop?.classList.remove("open");
      toggle?.setAttribute("aria-expanded", "false");
      const finish = () => {
        if (!sidebarOpen) {
          sidebar.hidden = true;
          if (backdrop) backdrop.hidden = true;
        }
      };
      sidebar.addEventListener("transitionend", finish, { once: true });
      setTimeout(finish, 280);
    }
  }

  function filterStoreList(query) {
    const q = String(query || "").trim().toLowerCase();
    const nav = document.getElementById("store-switch");
    if (!nav) return;
    let visible = 0;
    nav.querySelectorAll(".store-pill[data-store-name]").forEach((btn) => {
      const name = (btn.dataset.storeName || "").toLowerCase();
      const site = (btn.dataset.storeSite || "").toLowerCase();
      const match = !q || name.includes(q) || site.includes(q);
      btn.hidden = !match;
      if (match) visible += 1;
    });
    let empty = nav.querySelector(".store-sidebar-empty.filter-empty");
    if (q && visible === 0) {
      if (!empty) {
        empty = document.createElement("p");
        empty.className = "store-sidebar-empty filter-empty";
        nav.appendChild(empty);
      }
      empty.textContent = "No stores match that filter.";
      empty.hidden = false;
    } else if (empty) {
      empty.hidden = true;
    }
  }

  function setActiveStoreInfo(name, siteId, batchCount) {
    activeStore = name;
    activeSiteId = siteId || null;
    const siteLabel = siteId ? ` · site ${siteId}` : "";
    document.getElementById("active-store").textContent =
      `Active: ${name}${siteLabel} (${batchCount} batches)`;
    document.getElementById("batch-count-badge").textContent = String(batchCount);
    updateStoreToggleLabel(name);
    populateEditStoreForm(name, siteId);
    if (typeof DashboardUI !== "undefined") {
      DashboardUI.updateBrand(name, siteId);
    }
  }

  function renderStorePills(stores) {
    const switchEl = document.getElementById("store-switch");
    if (!switchEl) return;
    switchEl.innerHTML = "";
    updateStoreCount(stores.length);

    if (!stores.length) {
      const empty = document.createElement("p");
      empty.className = "store-sidebar-empty";
      empty.textContent = "No stores yet — use Manage to add one.";
      switchEl.appendChild(empty);
      return;
    }

    for (const store of stores) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "option");
      btn.className = "store-pill" + (store.name === activeStore ? " active" : "");
      btn.dataset.storeName = store.name;
      btn.dataset.storeSite = store.site_id || "";
      btn.setAttribute("aria-selected", String(store.name === activeStore));
      const meta = store.site_id
        ? `<span class="store-pill-meta">SITE ${store.site_id}</span>`
        : "";
      btn.innerHTML =
        `<span class="dot"></span>` +
        `<span class="store-pill-text">` +
        `<span class="store-pill-name"></span>${meta}` +
        `</span>`;
      btn.querySelector(".store-pill-name").textContent = store.name;
      btn.addEventListener("click", async () => {
        await openStore(store.name);
        setSidebarOpen(false);
      });
      switchEl.appendChild(btn);
    }

    const search = document.getElementById("store-search-input");
    if (search?.value) filterStoreList(search.value);
  }

  async function refreshStoreList() {
    const stores = await window.api.listStores();
    const listEl = document.getElementById("store-list");
    listEl.innerHTML = "";

    renderStorePills(stores);

    if (stores.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.style.padding = "8px 0";
      empty.textContent = "No stores yet — create one below.";
      listEl.appendChild(empty);
      populateEditStoreForm(null);
      updateStoreToggleLabel(null);
      return stores;
    }

    for (const store of stores) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "store-item" + (store.name === activeStore ? " active" : "");
      btn.textContent = formatStoreLabel(store);
      btn.addEventListener("click", async () => {
        await openStore(store.name);
      });
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

  function init(handlers) {
    onStoreChange = handlers.onStoreChange;

    document.getElementById("store-sidebar-toggle")?.addEventListener("click", () => {
      setSidebarOpen(!sidebarOpen);
    });
    document.getElementById("store-sidebar-close")?.addEventListener("click", () => {
      setSidebarOpen(false);
    });
    document.getElementById("store-sidebar-backdrop")?.addEventListener("click", () => {
      setSidebarOpen(false);
    });
    document.getElementById("store-search-input")?.addEventListener("input", (e) => {
      filterStoreList(e.target.value);
    });

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
      } else if (!stores.length && typeof DashboardUI !== "undefined") {
        DashboardUI.updateBrand(null);
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
    setSidebarOpen,
    formatMoney,
    formatDate,
    formatDateTime,
    stripLeadingZeros,
  };
})();
