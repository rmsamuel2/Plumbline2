// Applies every server/migrations/*.sql in filename order. All three files
// are idempotent (IF NOT EXISTS / CREATE OR REPLACE / guarded DO blocks), so
// re-running is always safe — on a brand-new Supabase project or a live 001 DB.
//   001_init.sql               original base schema
//   002_production_schema.sql  = plumbline_supabase_setup.sql (001 + migration 002)
//   003_security_patch.sql     = plumbline_supabase_patch_003.sql
const fs = require("fs");
const path = require("path");
const { pool } = require("./db.js");

(async () => {
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
  for (const f of files) {
    process.stdout.write("applying " + f + " ... ");
    await pool.query(fs.readFileSync(path.join(dir, f), "utf8"));
    console.log("ok");
  }
  console.log("migrated (" + files.length + " files)");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
