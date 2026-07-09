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

  ipcMain.handle("stores:create", (_event, name) => storeManager.createStore(name));

  ipcMain.handle("stores:open", (_event, name) => storeManager.openStore(name));

  ipcMain.handle("batches:list", () => storeManager.getBatches());

  ipcMain.handle("batches:count", () => storeManager.getBatchCount());

  ipcMain.handle("batches:insert", (_event, records, sourcePdf) =>
    storeManager.insertBatches(records, sourcePdf)
  );

  ipcMain.handle("parse:chevron", async (_event, buffer) => {
    const { parseChevronPdf } = require("./parsing/chevron-pipeline");
    const { toUint8Array } = require("./parsing/buffer-utils");
    const bytes = toUint8Array(buffer);
    if (bytes.byteLength === 0) {
      throw new Error("The PDF file is empty.");
    }
    return parseChevronPdf(bytes);
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
