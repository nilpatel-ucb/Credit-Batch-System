const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_DATA_ROOT = path.join(
  os.homedir(),
  "Documents",
  "Credit Batch Reconciler"
);

function getConfigPath(app) {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadDataRoot(app) {
  const configPath = getConfigPath(app);
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (data.dataRoot && typeof data.dataRoot === "string") {
        return path.resolve(data.dataRoot);
      }
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_DATA_ROOT;
}

function saveDataRoot(app, dataRoot) {
  const configPath = getConfigPath(app);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({ dataRoot: path.resolve(dataRoot) }, null, 2)
  );
}

function getStoresDir(dataRoot) {
  return path.join(dataRoot, "Stores");
}

function countStoreDatabases(storesDir) {
  if (!fs.existsSync(storesDir)) return 0;
  return fs.readdirSync(storesDir).filter((file) => file.endsWith(".db")).length;
}

function moveStoreFiles(fromDir, toDir) {
  fs.mkdirSync(toDir, { recursive: true });
  if (!fs.existsSync(fromDir)) return 0;

  let moved = 0;
  for (const file of fs.readdirSync(fromDir)) {
    if (!file.endsWith(".db") && !file.endsWith(".db-wal") && !file.endsWith(".db-shm")) {
      continue;
    }
    const src = path.join(fromDir, file);
    const dest = path.join(toDir, file);
    if (fs.existsSync(dest)) {
      throw new Error(`A store file already exists at the new location: ${file}`);
    }
    fs.renameSync(src, dest);
    if (file.endsWith(".db")) moved += 1;
  }
  return moved;
}

module.exports = {
  DEFAULT_DATA_ROOT,
  loadDataRoot,
  saveDataRoot,
  getStoresDir,
  countStoreDatabases,
  moveStoreFiles,
};
