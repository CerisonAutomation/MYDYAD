import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
// db.ts
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import log from "electron-log";
import { getUserDataPath } from "../paths/paths";
import * as schema from "./schema";

const logger = log.scope("db");

// Database connection factory
let _db: ReturnType<typeof drizzle> | null = null;

/**
 * Get the database path based on the current environment
 */
export function getDatabasePath(): string {
  return path.join(getUserDataPath(), "sqlite.db");
}

export function getDatabaseFilePaths(): string[] {
  const dbPath = getDatabasePath();
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

/**
 * Initialize the database connection
 */
export function initializeDatabase(): BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
} {
  if (_db) return _db as any;

  const dbPath = getDatabasePath();
  logger.log("Initializing database at:", dbPath);

  // Check if the database file exists and remove it if it has issues
  try {
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      if (stats.size < 100) {
        logger.log("Database file exists but may be corrupted. Removing it...");
        fs.unlinkSync(dbPath);
      }
    }
  } catch (error) {
    logger.error("Error checking database file:", error);
  }

  fs.mkdirSync(getUserDataPath(), { recursive: true });

  const sqlite = new Database(dbPath, { timeout: 10000 });
  sqlite.pragma("foreign_keys = ON");

  try {
    sqlite.pragma("journal_mode = WAL");
  } catch (error) {
    logger.warn(
      "Could not enable WAL mode, falling back to default journal mode:",
      error,
    );
  }

  // WAL performance tuning — safe defaults for an Electron single-process app.
  // busy_timeout: wait up to 5s for a lock instead of failing immediately.
  try {
    sqlite.pragma("busy_timeout = 5000");
  } catch (error) {
    logger.warn("Could not set busy_timeout:", error);
  }

  // synchronous = NORMAL is safe with WAL mode (WAL guarantees crash recovery)
  // and significantly faster than the default FULL.
  try {
    sqlite.pragma("synchronous = NORMAL");
  } catch (error) {
    logger.warn("Could not set synchronous mode:", error);
  }

  // Memory-mapped I/O for faster reads (256MB).
  try {
    sqlite.pragma("mmap_size = 268435456");
  } catch (error) {
    logger.warn("Could not set mmap_size:", error);
  }

  // Configure WAL auto-checkpoint to prevent unbounded WAL growth.
  // Default is 1000 pages (~4MB); we set it to 500 (~2MB) to keep the WAL
  // from growing too large between checkpoints, which can cause the main
  // thread to stall during checkpoint operations.
  try {
    sqlite.pragma("wal_autocheckpoint = 500");
  } catch (error) {
    logger.warn("Could not set wal_autocheckpoint:", error);
  }

  // Cap WAL size at 8MB to prevent disk space exhaustion and long
  // checkpoint times. If the WAL exceeds this, older frames are discarded.
  try {
    sqlite.pragma("journal_size_limit = 8388608");
  } catch (error) {
    logger.warn("Could not set journal_size_limit:", error);
  }

  // Run a checkpoint on startup to clear any WAL bloat from a previous
  // unclean shutdown. PASSIVE mode never blocks readers/writers — it
  // checkpoint frames that are already committed and leaves the rest for
  // later. This avoids stalling the main thread during startup.
  try {
    const walSize = fs.statSync(`${dbPath}-wal`).size;
    if (walSize > 1024 * 1024) {
      // Only checkpoint if WAL is >1MB to avoid unnecessary I/O
      logger.log(
        `WAL file is ${(walSize / 1024 / 1024).toFixed(1)}MB, running checkpoint...`,
      );
      sqlite.pragma("wal_checkpoint(PASSIVE)");
      logger.log("WAL checkpoint complete");
    }
  } catch (error) {
    // ENOENT is expected on first run when no WAL file exists yet.
    // Any other error (locked DB, I/O failure) should be logged.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn("WAL checkpoint failed:", error);
    }
  }

  _db = drizzle(sqlite, { schema });

  try {
    const migrationsFolder = path.join(__dirname, "..", "..", "drizzle");
    if (!fs.existsSync(migrationsFolder)) {
      throw new Error(`Migrations folder not found: ${migrationsFolder}`);
    }
    logger.log("Running migrations from:", migrationsFolder);
    migrate(_db, { migrationsFolder });
  } catch (error) {
    logger.error("Migration error:", error);
    _db = null;
    sqlite.close();
    throw error;
  }

  return _db as any;
}

export function closeDatabase(): void {
  if (!_db) {
    return;
  }

  const database = _db as BetterSQLite3Database<typeof schema> & {
    $client: Database.Database;
  };
  _db = null;
  database.$client.close();
}

/**
 * Replaces the database instance resolved by the `db` proxy. Test-only seam
 * so unit tests can point handlers at an in-memory database (see
 * `src/testing/test_db.ts`). Pass null to clear the override.
 */
export function setDatabaseForTesting(
  database:
    | (BetterSQLite3Database<typeof schema> & { $client: Database.Database })
    | null,
): void {
  _db = database;
}

/**
 * Get the database instance (throws if not initialized)
 */
export function getDb(): BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
} {
  if (!_db) {
    throw new Error(
      "Database not initialized. Call initializeDatabase() first.",
    );
  }
  return _db as any;
}

export const db = new Proxy({} as any, {
  get(target, prop) {
    const database = getDb();
    return database[prop as keyof typeof database];
  },
}) as BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};
