const StoreSelector = (() => {
  let activeStore = null;
  let activeSiteId = null;
  let onStoreChange = null;
  let sidebarOpen = false;
  let storeFormMode = "add"; // "add" | "edit"
  let editingStoreName = null;
  let contextStore = null; // { name, site_id }

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

  function setStoreFormStatus(message, type = "info") {
    const el = document.getElementById("store-form-status");
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.className = "store-form-status";
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.className = `store-form-status ${type}`;
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
      hideStoreContextMenu();
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

  function hideStoreContextMenu() {
    const menu = document.getElementById("store-context-menu");
    if (menu) menu.hidden = true;
    contextStore = null;
  }

  function showStoreContextMenu(event, store) {
    const menu = document.getElementById("store-context-menu");
    if (!menu) return;
    contextStore = store;
    menu.hidden = false;

    const pad = 8;
    const { width, height } = menu.getBoundingClientRect();
    let left = event.clientX;
    let top = event.clientY;
    if (left + width > window.innerWidth - pad) left = window.innerWidth - width - pad;
    if (top + height > window.innerHeight - pad) top = window.innerHeight - height - pad;
    menu.style.left = `${Math.max(pad, left)}px`;
    menu.style.top = `${Math.max(pad, top)}px`;
  }

  function openStoreForm(mode, store = null) {
    storeFormMode = mode;
    editingStoreName = store ? store.name : null;
    const modal = document.getElementById("store-form-modal");
    const title = document.getElementById("store-form-title");
    const submit = document.getElementById("store-form-submit");
    const nameInput = document.getElementById("store-form-name");
    const siteInput = document.getElementById("store-form-site-id");

    if (mode === "edit" && store) {
      title.textContent = "Edit store";
      submit.textContent = "Save changes";
      nameInput.value = store.name || "";
      siteInput.value = store.site_id || "";
    } else {
      title.textContent = "Add store";
      submit.textContent = "Add store";
      nameInput.value = "";
      siteInput.value = "";
    }

    setStoreFormStatus("");
    if (typeof DashboardUI !== "undefined") {
      DashboardUI.openModal("store-form-modal");
    } else if (modal) {
      modal.hidden = false;
    }
    nameInput.focus();
    nameInput.select?.();
  }

  function setActiveStoreInfo(name, siteId, batchCount, dbPath) {
    activeStore = name;
    activeSiteId = siteId || null;
    const siteLabel = siteId ? ` · site ${siteId}` : "";
    document.getElementById("active-store").textContent =
      `Active: ${name}${siteLabel} (${batchCount} batches)`;
    document.getElementById("batch-count-badge").textContent = String(batchCount);
    updateStoreToggleLabel(name);
    if (typeof DashboardUI !== "undefined") {
      DashboardUI.updateBrand(name, siteId, dbPath);
    }
  }

  function clearActiveStore() {
    activeStore = null;
    activeSiteId = null;
    document.getElementById("active-store").textContent = "No store selected";
    document.getElementById("batch-count-badge").textContent = "0";
    updateStoreToggleLabel(null);
    if (typeof DashboardUI !== "undefined") {
      DashboardUI.updateBrand(null, null, null);
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
      empty.textContent = "No stores yet — click Add store.";
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
        hideStoreContextMenu();
        await openStore(store.name);
        setSidebarOpen(false);
      });
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showStoreContextMenu(event, {
          name: store.name,
          site_id: store.site_id || "",
        });
      });
      switchEl.appendChild(btn);
    }

    const search = document.getElementById("store-search-input");
    if (search?.value) filterStoreList(search.value);
  }

  async function refreshStoreList() {
    const stores = await window.api.listStores();
    renderStorePills(stores);
    if (!stores.length) {
      updateStoreToggleLabel(activeStore ? activeStore : null);
    }
    return stores;
  }

  async function openStore(name) {
    const result = await window.api.openStore(name);
    setActiveStoreInfo(result.name, result.site_id, result.batchCount, result.dbPath);
    await refreshStoreList();
    if (onStoreChange) {
      await onStoreChange(result);
    }
    return result;
  }

  async function createStore(name, siteId) {
    await window.api.createStore(name, siteId);
    await refreshStoreList();
    await openStore(name);
  }

  async function updateStore(name, siteId) {
    if (editingStoreName && editingStoreName !== activeStore) {
      await window.api.openStore(editingStoreName);
    }
    const result = await window.api.updateStore(name, siteId);
    setActiveStoreInfo(result.name, result.site_id, result.batchCount, result.dbPath);
    await refreshStoreList();
    if (onStoreChange) {
      await onStoreChange(result);
    }
    return result;
  }

  async function deleteStore(name) {
    const wasActive = activeStore === name;
    await window.api.deleteStore(name);
    const stores = await refreshStoreList();

    if (!wasActive) return;

    if (stores.length > 0) {
      await openStore(stores[0].name);
    } else {
      clearActiveStore();
      if (onStoreChange) {
        await onStoreChange(null);
      }
    }
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

    document.getElementById("add-store-btn")?.addEventListener("click", () => {
      openStoreForm("add");
    });

    document.getElementById("store-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("store-form-name").value.trim();
      const siteId = document.getElementById("store-form-site-id").value.trim();
      if (!name || !siteId) return;

      try {
        if (storeFormMode === "edit") {
          await updateStore(name, siteId);
        } else {
          await createStore(name, siteId);
        }
        if (typeof DashboardUI !== "undefined") {
          DashboardUI.closeModal("store-form-modal");
        } else {
          document.getElementById("store-form-modal").hidden = true;
        }
        setStoreFormStatus("");
      } catch (err) {
        setStoreFormStatus(err.message || "Failed to save store.", "error");
      }
    });

    document.getElementById("store-context-menu")?.addEventListener("click", async (e) => {
      const action = e.target.closest("[data-store-action]")?.dataset.storeAction;
      if (!action || !contextStore) return;
      const store = contextStore;
      hideStoreContextMenu();

      if (action === "edit") {
        openStoreForm("edit", store);
        return;
      }

      if (action === "delete") {
        const ok = window.confirm(
          `Delete store "${store.name}"?\n\nThis permanently removes its database file and cannot be undone.`
        );
        if (!ok) return;
        try {
          await deleteStore(store.name);
        } catch (err) {
          alert(err.message || "Failed to delete store.");
        }
      }
    });

    document.addEventListener("click", (e) => {
      const menu = document.getElementById("store-context-menu");
      if (!menu || menu.hidden) return;
      if (!menu.contains(e.target)) hideStoreContextMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideStoreContextMenu();
    });
    window.addEventListener("blur", hideStoreContextMenu);
    document.addEventListener("scroll", hideStoreContextMenu, true);

    refreshStoreList().then(async (stores) => {
      if (stores.length > 0 && !activeStore) {
        await openStore(stores[0].name);
      } else if (!stores.length && typeof DashboardUI !== "undefined") {
        DashboardUI.updateBrand(null, null, null);
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
