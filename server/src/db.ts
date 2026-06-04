import Database from "better-sqlite3";

export type TelemetryDb = Database.Database;

export function openTelemetryDb(path = process.env.SQLITE_PATH ?? "telemetry.sqlite"): TelemetryDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS match_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      match_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aggregate_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      match_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
  return db;
}
