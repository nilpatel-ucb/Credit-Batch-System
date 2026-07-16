const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listStores: () => ipcRenderer.invoke("stores:list"),
  createStore: (name, siteId, batchTemplate, eftTemplate) =>
    ipcRenderer.invoke("stores:create", name, siteId, batchTemplate, eftTemplate),
  openStore: (name) => ipcRenderer.invoke("stores:open", name),
  updateStore: (name, siteId, batchTemplate, eftTemplate) =>
    ipcRenderer.invoke("stores:update", name, siteId, batchTemplate, eftTemplate),
  deleteStore: (name) => ipcRenderer.invoke("stores:delete", name),
  listTemplates: () => ipcRenderer.invoke("templates:list"),
  showItemInFolder: (filePath) => ipcRenderer.invoke("shell:showItemInFolder", filePath),
  getStorageInfo: () => ipcRenderer.invoke("paths:get"),
  chooseStorageFolder: () => ipcRenderer.invoke("paths:chooseFolder"),
  setStorageLocation: (dataRoot, moveExisting) =>
    ipcRenderer.invoke("paths:set", dataRoot, moveExisting),
  getBatches: () => ipcRenderer.invoke("batches:list"),
  getBatchCount: () => ipcRenderer.invoke("batches:count"),
  insertBatches: (records, sourcePdf) =>
    ipcRenderer.invoke("batches:insert", records, sourcePdf),
  deleteBatch: (batchId) => ipcRenderer.invoke("batches:delete", batchId),
  deleteBatchSource: (sourcePdf, ingestedAt) =>
    ipcRenderer.invoke("batches:delete-source", sourcePdf, ingestedAt),
  setBatchExpectedOnNextInvoice: (batchId, expected) =>
    ipcRenderer.invoke("batches:set-expected-on-next-invoice", batchId, expected),
  insertInvoice: (summary, batchLines, pdfFilename) =>
    ipcRenderer.invoke("invoices:insert", summary, batchLines, pdfFilename),
  getInvoices: () => ipcRenderer.invoke("invoices:list"),
  getInvoiceLines: (invoiceId) => ipcRenderer.invoke("invoices:lines", invoiceId),
  deleteInvoice: (invoiceId) => ipcRenderer.invoke("invoices:delete", invoiceId),
  deleteInvoiceLine: (lineId) => ipcRenderer.invoke("invoices:delete-line", lineId),
  reconcileStore: () => ipcRenderer.invoke("reconcile:run"),
  getLastReconciliation: () => ipcRenderer.invoke("reconcile:last"),
  getReconciliationScope: () => ipcRenderer.invoke("reconcile:scope"),
  searchByBatchNumber: (batchNumber) =>
    ipcRenderer.invoke("reconcile:searchBatch", batchNumber),
  confirmReconciliation: () => ipcRenderer.invoke("reconcile:confirm"),
  listReconciliationRuns: () => ipcRenderer.invoke("reconcile:runs"),
  getReconciliationRun: (runId) => ipcRenderer.invoke("reconcile:runDetail", runId),
  parseBatchPdf: (buffer, templateId) => {
    const bytes =
      buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    return ipcRenderer.invoke("parse:batch", bytes, templateId);
  },
  parseEftPdf: (buffer, templateId) => {
    const bytes =
      buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    return ipcRenderer.invoke("parse:eft", bytes, templateId);
  },
});
