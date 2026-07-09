const fs = require("fs");
const path = require("path");

const CURRENT_VERSION = 2;

function getSchemaSql() {
  return fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
}

function getSchemaVersion(db) {
  try {
    const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
    return row ? row.version : 0;
  } catch {
    return 0;
  }
}

function setSchemaVersion(db, version) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM schema_version").get().c;
  if (count === 0) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(version);
  } else {
    db.prepare("UPDATE schema_version SET version = ?").run(version);
  }
}

function migrateToV1(db) {
  db.exec(getSchemaSql());
  setSchemaVersion(db, 1);
}

function migrateToV2(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  setSchemaVersion(db, 2);
}

function migrate(db) {
  let version = getSchemaVersion(db);

  if (version < 1) {
    migrateToV1(db);
    version = 1;
  }

  if (version < 2) {
    migrateToV2(db);
  }
}

module.exports = { migrate, CURRENT_VERSION };
