# Backend

Electron main process and business logic for the Credit Batch Reconciler.

## Layout

| Path | Role |
|------|------|
| `main.js` | App window, IPC handlers, data folder paths |
| `preload.js` | `window.api` bridge for the renderer |
| `parsing/` | PDF → normalized batch records (Chevron) |
| `reconciling/db/` | Per-store SQLite ledger |

## Data folder

```
~/Documents/Credit Batch Reconciler/Stores/{StoreName}.db
```

## Commands

```bash
npm run setup             # Download Electron + rebuild native modules
npm run rebuild:node      # Rebuild better-sqlite3 for Node (tests)
npm run rebuild:electron  # Rebuild better-sqlite3 for Electron (app)
npm start                 # Rebuilds for Electron, then launches app
npm test                  # Rebuilds for Node, then runs tests
```

`better-sqlite3` is a native module — it must match the runtime. `npm test` compiles for system Node; `npm start` recompiles for Electron automatically. If you see a `NODE_MODULE_VERSION` error, run `npm run rebuild:electron` before starting the app.

After `npm install`, run `npm run setup` if Electron did not install completely.
