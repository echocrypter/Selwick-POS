
"use strict";

const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

let db = null;

function initializeDatabase(userDataPath) {
  if (db) return db;

  const databaseFolder = path.join(userDataPath, "database");
  fs.mkdirSync(databaseFolder, { recursive: true });

  const databasePath = path.join(databaseFolder, "selwick.db");

  db = new DatabaseSync(databasePath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS app_storage (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("Selwick POS SQLite database initialized.");

  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  initializeDatabase,
  closeDatabase,
};
