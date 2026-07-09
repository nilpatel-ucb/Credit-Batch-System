const fs = require("fs");
const path = require("path");

const CURRENT_VERSION = 1;

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

function migrate(db) {
  const version = getSchemaVersion(db);
  if (version >= CURRENT_VERSION) return;

  db.exec(getSchemaSql());

  const count = db.prepare("SELECT COUNT(*) AS c FROM schema_version").get().c;
  if (count === 0) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(CURRENT_VERSION);
  } else {
    db.prepare("UPDATE schema_version SET version = ?").run(CURRENT_VERSION);
  }
}

module.exports = { migrate, CURRENT_VERSION };
