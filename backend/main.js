const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { createStoreManager } = require("./reconciling/db/store");
const {
  DEFAULT_DATA_ROOT,
  loadDataRoot,
  saveDataRoot,
  getStoresDir,
  countStoreDatabases,
  moveStoreFiles,
} = require("./paths");

let mainWindow = null;
let storeManager = null;
let dataRoot = DEFAULT_DATA_ROOT;

function initStoreManager() {
  if (storeManager) {
    storeManager.close();
  }
  const storesDir = getStoresDir(dataRoot);
  fs.mkdirSync(storesDir, { recursive: true });
  storeManager = createStoreManager(storesDir);
}

function getStorageInfo() {
  const storesDir = getStoresDir(dataRoot);
  return {
    dataRoot,
    storesDir,
    defaultDataRoot: DEFAULT_DATA_ROOT,
    storeCount: countStoreDatabases(storesDir),
  };
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
  ipcMain.handle("paths:get", () => getStorageInfo());

  ipcMain.handle("paths:chooseFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose storage location",
      defaultPath: dataRoot,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    return path.resolve(result.filePaths[0]);
  });

  ipcMain.handle("paths:set", (_event, newDataRoot, moveExisting) => {
    if (!newDataRoot || typeof newDataRoot !== "string") {
      throw new Error("Storage location is required.");
    }

    const nextRoot = path.resolve(newDataRoot);
    const currentStoresDir = getStoresDir(dataRoot);
    const nextStoresDir = getStoresDir(nextRoot);

    if (path.resolve(nextRoot) === path.resolve(dataRoot)) {
      return { ...getStorageInfo(), movedCount: 0, changed: false };
    }

    const existingCount = countStoreDatabases(currentStoresDir);
    const nextCount = countStoreDatabases(nextStoresDir);
    let movedCount = 0;

    if (storeManager) {
      storeManager.close();
      storeManager = null;
    }

    if (existingCount > 0 && moveExisting) {
      movedCount = moveStoreFiles(currentStoresDir, nextStoresDir);
    } else if (existingCount > 0 && !moveExisting && nextCount === 0) {
      throw new Error(
        "The current location has store databases. Enable “Move existing store files” or choose a folder that already contains them."
      );
    } else {
      fs.mkdirSync(nextStoresDir, { recursive: true });
    }

    dataRoot = nextRoot;
    saveDataRoot(app, dataRoot);
    initStoreManager();

    return {
      ...getStorageInfo(),
      movedCount,
      changed: true,
    };
  });

  ipcMain.handle("stores:list", () => storeManager.listStores());

  ipcMain.handle("stores:create", (_event, name, siteId) =>
    storeManager.createStore(name, siteId)
  );

  ipcMain.handle("stores:info", () => storeManager.getStoreInfo());

  ipcMain.handle("stores:open", (_event, name) => storeManager.openStore(name));

  ipcMain.handle("stores:update", (_event, name, siteId) =>
    storeManager.updateStore(name, siteId)
  );

  ipcMain.handle("stores:delete", (_event, name) => storeManager.deleteStore(name));

  ipcMain.handle("shell:showItemInFolder", (_event, filePath) => {
    if (!filePath || typeof filePath !== "string") {
      throw new Error("File path is required.");
    }
    shell.showItemInFolder(filePath);
  });

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

  ipcMain.handle("batches:set-expected-on-next-invoice", (_event, batchId, expected) =>
    storeManager.setBatchExpectedOnNextInvoice(batchId, expected)
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

  ipcMain.handle("invoices:delete-line", (_event, lineId) =>
    storeManager.deleteInvoiceLine(lineId)
  );

  ipcMain.handle("reconcile:run", () => storeManager.reconcileStore());

  ipcMain.handle("reconcile:last", () => storeManager.getStoreReconciliation());

  ipcMain.handle("reconcile:scope", () => storeManager.getReconciliationScope());

  ipcMain.handle("reconcile:searchBatch", (_event, batchNumber) =>
    storeManager.searchByBatchNumber(batchNumber)
  );

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
  dataRoot = loadDataRoot(app);
  initStoreManager();
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
