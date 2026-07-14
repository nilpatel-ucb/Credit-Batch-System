const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const os = require("os");
const { createStoreManager } = require("./reconciling/db/store");

let mainWindow = null;
let storeManager = null;

function getDataRoot() {
  return path.join(os.homedir(), "Documents", "Credit Batch Reconciler");
}

function getStoresDir() {
  return path.join(getDataRoot(), "Stores");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../frontend/index.html"));

  // Prevent dropped files from navigating the window away from the app
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
}

function registerIpcHandlers() {
  ipcMain.handle("stores:list", () => storeManager.listStores());

  ipcMain.handle("stores:create", (_event, name, siteId) =>
    storeManager.createStore(name, siteId)
  );

  ipcMain.handle("stores:info", () => storeManager.getStoreInfo());

  ipcMain.handle("stores:open", (_event, name) => storeManager.openStore(name));

  ipcMain.handle("stores:update", (_event, name, siteId) =>
    storeManager.updateStore(name, siteId)
  );

  ipcMain.handle("batches:list", () => storeManager.getBatches());

  ipcMain.handle("batches:count", () => storeManager.getBatchCount());

  ipcMain.handle("batches:insert", (_event, records, sourcePdf) =>
    storeManager.insertBatches(records, sourcePdf)
  );

  ipcMain.handle("batches:delete", (_event, batchId) =>
    storeManager.deleteBatch(batchId)
  );

  ipcMain.handle("batches:delete-source", (_event, sourcePdf, ingestedAt) =>
    storeManager.deleteBatchSource(sourcePdf, ingestedAt)
  );

  ipcMain.handle("invoices:insert", (_event, summary, batchLines, pdfFilename) =>
    storeManager.insertInvoice(summary, batchLines, pdfFilename)
  );

  ipcMain.handle("invoices:list", () => storeManager.getInvoices());

  ipcMain.handle("invoices:lines", (_event, invoiceId) =>
    storeManager.getInvoiceLines(invoiceId)
  );

  ipcMain.handle("invoices:delete", (_event, invoiceId) =>
    storeManager.deleteInvoice(invoiceId)
  );

  ipcMain.handle("reconcile:run", () => storeManager.reconcileStore());

  ipcMain.handle("reconcile:last", () => storeManager.getStoreReconciliation());

  ipcMain.handle("reconcile:scope", () => storeManager.getReconciliationScope());

  ipcMain.handle("reconcile:confirm", () => storeManager.confirmReconciliation());

  ipcMain.handle("reconcile:runs", () => storeManager.listReconciliationRuns());

  ipcMain.handle("reconcile:runDetail", (_event, runId) =>
    storeManager.getReconciliationRun(runId)
  );
//if parsing is empty throw an error
  ipcMain.handle("parse:chevron", async (_event, buffer) => {
    const { parseChevronPdf } = require("./parsing/chevron-pipeline");
    const { toUint8Array } = require("./parsing/buffer-utils");
    const bytes = toUint8Array(buffer);
    if (bytes.byteLength === 0) {
      throw new Error("The PDF file is empty.");
    }
    return parseChevronPdf(bytes);
  });

  ipcMain.handle("parse:eft", async (_event, buffer) => {
    const { parseEftPdf } = require("./parsing/eft-pipeline");
    const { toUint8Array } = require("./parsing/buffer-utils");
    const bytes = toUint8Array(buffer);
    if (bytes.byteLength === 0) {
      throw new Error("The PDF file is empty.");
    }
    return parseEftPdf(bytes);
  });
}

app.whenReady().then(() => {
  storeManager = createStoreManager(getStoresDir());
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (storeManager) {
    storeManager.close();
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (storeManager) {
    storeManager.close();
  }
});
