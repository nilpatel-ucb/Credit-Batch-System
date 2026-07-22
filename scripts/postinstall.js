const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const electronDir = path.join(root, "node_modules", "electron");

function electronBinaryRelative() {
  if (process.platform === "darwin") {
    return path.join(
      "Electron.app",
      "Contents",
      "MacOS",
      "Electron"
    );
  }
  if (process.platform === "win32") {
    return "electron.exe";
  }
  return "electron";
}

function electronBinaryPath() {
  return path.join(electronDir, "dist", electronBinaryRelative());
}

function electronReady() {
  try {
    return fs.existsSync(electronBinaryPath());
  } catch {
    return false;
  }
}

function run(cmd, opts = {}) {
  execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
}

function extractZip(zipPath, dest) {
  if (process.platform === "darwin") {
    // unzip preserves macOS symlinks; extract-zip does not
    run(`unzip -q -o "${zipPath}" -d "${dest}"`);
    return;
  }

  if (process.platform === "win32") {
    const psZip = zipPath.replace(/'/g, "''");
    const psDest = dest.replace(/'/g, "''");
    run(
      `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${psZip}' -DestinationPath '${psDest}' -Force"`
    );
    return;
  }

  run(`unzip -q -o "${zipPath}" -d "${dest}"`);
}

async function downloadElectron() {
  const { downloadArtifact } = require("@electron/get");
  const version = require(path.join(electronDir, "package.json")).version;
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch;

  console.log(`Downloading Electron ${version} (${process.platform}-${arch})…`);
  const zipPath = await downloadArtifact({
    version,
    artifactName: "electron",
    platform: process.platform,
    arch,
    force: true,
  });

  const dist = path.join(electronDir, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  extractZip(zipPath, dist);

  fs.writeFileSync(
    path.join(electronDir, "path.txt"),
    electronBinaryRelative().split(path.sep).join("/")
  );
}

async function main() {
  if (!electronReady()) {
    await downloadElectron();
  }

  if (!electronReady()) {
    console.error(
      "Electron install failed. Try: rm -rf node_modules/electron/dist && npm run setup"
    );
    process.exit(1);
  }

  try {
    console.log("Rebuilding native modules for Electron…");
    run("npx electron-rebuild -f -w better-sqlite3");
  } catch (err) {
    console.warn("Warning: electron-rebuild failed:", err.message);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
