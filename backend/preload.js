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
  deleteBatch: (batchId) => ipcRenderer.invoke("batches:delete", batchId),
  deleteBatchSource: (sourcePdf, ingestedAt) =>
    ipcRenderer.invoke("batches:delete-source", sourcePdf, ingestedAt),
  insertInvoice: (summary, batchLines, pdfFilename) =>
    ipcRenderer.invoke("invoices:insert", summary, batchLines, pdfFilename),
  getInvoices: () => ipcRenderer.invoke("invoices:list"),
  getInvoiceLines: (invoiceId) => ipcRenderer.invoke("invoices:lines", invoiceId),
  deleteInvoice: (invoiceId) => ipcRenderer.invoke("invoices:delete", invoiceId),
  reconcileInvoice: (invoiceId) => ipcRenderer.invoke("reconcile:run", invoiceId),
  getLastReconciliation: (invoiceId) => ipcRenderer.invoke("reconcile:last", invoiceId),
  parseChevronPdf: (buffer) => {
    const bytes =
      buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    return ipcRenderer.invoke("parse:chevron", bytes);
  },
  parseEftPdf: (buffer) => {
    const bytes =
      buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    return ipcRenderer.invoke("parse:eft", bytes);
  },
});
