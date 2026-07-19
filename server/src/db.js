
// Postgres access for the Plumbline API (Supabase in production).
//
// Two ways to talk to the database:
//   query()/one()      — plain one-shot statements (health check, login lookup).
//   tx(ctx, fn)        — a transaction that FIRST sets the row-level-security
//                        context the schema defines (setup.sql §10):
//                            SET LOCAL app.user_id      = '<uuid>'
//                            SET LOCAL app.is_superuser = 'true'|'false'
//                        Every authenticated request runs inside tx() so the
//                        database — not just the API — knows who is acting.
//                        RLS is ENABLEd (not FORCEd), so the owner role the
//                        API uses is not blocked today; setting the context
//                        anyway means the API can later run as a non-owner
//                        role with zero code changes, and SQL helpers (e.g.
//                        audit inserts) can read the acting user.
//
// Configure with DATABASE_URL (Supabase → Project → Database → URI).
// Remember: the Supabase hostname uses the 20-char project reference id.
//
// server/.env is loaded here (no dependency) so `npm start` and
// `npm run migrate` work exactly as the README documents. Real environment
// variables win over .env values.
const fs = require("fs");
const path = require("path");
(function loadDotEnv() {
  try {
    const file = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch (e) { /* .env is optional */ }
})();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
});

async function query(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}
async function one(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

/**
 * Run fn(client) inside a transaction with the RLS context set.
 * ctx = { userId: uuid|null, isSuperuser: boolean }
 * fn receives helpers bound to the transaction's client:
 *   q(text, params) -> rows      o(text, params) -> first row or null
 */
async function tx(ctx, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // set_config with `true` = local to this transaction. Parameterised —
    // no string interpolation of user data into SQL.
    await client.query("select set_config('app.user_id', $1, true), " +
                       "set_config('app.is_superuser', $2, true)",
      [ctx && ctx.userId ? String(ctx.userId) : "",
       ctx && ctx.isSuperuser ? "true" : "false"]);
    const q = async (text, params) => (await client.query(text, params)).rows;
    const o = async (text, params) => {
      const rows = await q(text, params);
      return rows[0] || null;
    };
    const result = await fn({ client, q, o });
    await client.query("commit");
    return result;
  } catch (err) {
    try { await client.query("rollback"); } catch (e) { /* already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, one, tx };
console.log("Has DATABASE_URL in process.env?", Boolean(process.env.DATABASE_URL));
