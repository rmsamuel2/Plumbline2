// Applies every server/migrations/*.sql in filename order. Migrations are
// idempotent (IF NOT EXISTS / CREATE OR REPLACE / guarded DO blocks), so
// re-running is always safe — on a brand-new Supabase project or a live 001 DB.
//   001_init.sql               original base schema
//   002_production_schema.sql  = plumbline_supabase_setup.sql (001 + migration 002)
//   003_security_patch.sql     = plumbline_supabase_patch_003.sql
//   004-006                    settings, workflow ordering, AI edit history
const fs = require("fs");
const path = require("path");
const { pool } = require("./db.js");

const TRANSIENT_CONNECTION_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03"  // cannot_connect_now
]);

function isTransientConnectionError(error) {
  if (error && TRANSIENT_CONNECTION_CODES.has(error.code)) return true;
  const message = String(error && error.message || "").toLowerCase();
  return message.includes("connection terminated") ||
    message.includes("connection reset") ||
    message.includes("socket hang up");
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function applyMigration(sql) {
  const configuredAttempts = Number(process.env.MIGRATION_MAX_ATTEMPTS || 4);
  const maxAttempts = Math.max(1, Math.min(8,
    Number.isFinite(configuredAttempts) ? Math.floor(configuredAttempts) : 4));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query(sql);
      return;
    } catch (error) {
      if (!isTransientConnectionError(error) || attempt === maxAttempts) throw error;
      const delayMs = Math.min(5000, 750 * (2 ** (attempt - 1)));
      process.stdout.write("connection interrupted; retrying in " + delayMs + "ms ... ");
      await wait(delayMs);
    }
  }
}

(async () => {
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
  for (const f of files) {
    process.stdout.write("applying " + f + " ... ");
    await applyMigration(fs.readFileSync(path.join(dir, f), "utf8"));
    console.log("ok");
  }
  console.log("migrated (" + files.length + " files)");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
