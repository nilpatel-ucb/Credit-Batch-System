const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listStores: () => ipcRenderer.invoke("stores:list"),
  createStore: (name, siteId) => ipcRenderer.invoke("stores:create", name, siteId),
  openStore: (name) => ipcRenderer.invoke("stores:open", name),
  updateStore: (name, siteId) => ipcRenderer.invoke("stores:update", name, siteId),
  getBatches: () => ipcRenderer.invoke("batches:list"),
  getBatchCount: () => ipcRenderer.invoke("batches:count"),
  insertBatches: (records, sourcePdf) =>
    ipcRenderer.invoke("batches:insert", records, sourcePdf),
  parseChevronPdf: (buffer) => {
    const bytes =
      buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    return ipcRenderer.invoke("parse:chevron", bytes);
  },
});
