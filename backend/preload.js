const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listStores: () => ipcRenderer.invoke("stores:list"),
  createStore: (name) => ipcRenderer.invoke("stores:create", name),
  openStore: (name) => ipcRenderer.invoke("stores:open", name),
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
