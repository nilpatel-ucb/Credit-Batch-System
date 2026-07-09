const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const electronDir = path.join(root, "node_modules", "electron");
const frameworkPath = path.join(
  electronDir,
  "dist",
  "Electron.app",
  "Contents",
  "Frameworks",
  "Electron Framework.framework",
  "Electron Framework"
);

function electronReady() {
  if (!fs.existsSync(frameworkPath)) return false;
  try {
    const stat = fs.statSync(frameworkPath);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function run(cmd, opts = {}) {
  execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
}

async function downloadElectron() {
  const { downloadArtifact } = require("@electron/get");
  const version = require(path.join(electronDir, "package.json")).version;
  const arch = process.arch === "x64" ? "x64" : "arm64";

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

  // unzip preserves macOS symlinks; extract-zip does not
  run(`unzip -q -o "${zipPath}" -d "${dist}"`);

  const platformPath =
    process.platform === "darwin"
      ? "Electron.app/Contents/MacOS/Electron"
      : process.platform === "win32"
        ? "electron.exe"
        : "electron";

  fs.writeFileSync(path.join(electronDir, "path.txt"), platformPath);
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
