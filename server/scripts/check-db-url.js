// server/scripts/check-db-url.js
const { URL } = require("url");

function redactUserPass(input) {
  // Keep it safe to print: postgres://user:****@host:5432/dbname
  return input.replace(/(\/\/)([^:/]+):([^@]+)@/g, "$1$2:****@");
}

const s = process.env.DATABASE_URL;

if (!s) {
  console.error("❌ DATABASE_URL is not set in the environment.");
  process.exit(1);
}

let u;
try {
  u = new URL(s);
} catch (e) {
  console.error("❌ DATABASE_URL is not a valid URI.");
  console.error("Reason:", e.message);
  console.error("Value (redacted):", redactUserPass(s).slice(0, 200));
  process.exit(1);
}

// Helpful, non-secret checks
const issues = [];
if (!/^postgres/i.test(u.protocol)) issues.push(`Unexpected protocol: ${u.protocol}`);
if (!u.host || !u.host.includes(".")) issues.push(`Host looks wrong: ${u.host || "(empty)"}`);
if (!u.hostname.includes("supabase.co")) issues.push(`Host is not ending in supabase.co: ${u.hostname}`);

const hasAt = s.includes("@");
if (!hasAt) issues.push("Missing '@' separator between user/pass and host.");

console.log("✅ DATABASE_URL is parseable");
console.log("Protocol:", u.protocol);
console.log("Host:", u.host); // host only; no password/user
console.log("Username:", u.username ? u.username : "(none)"); // user only
console.log("Database path:", u.pathname); // /db or /schema
if (u.search) console.log("Query params:", u.search);

if (issues.length) {
  console.log("\n⚠️ Potential problems:");
  for (const it of issues) console.log(" -", it);
} else {
  console.log("\n🎉 No obvious formatting issues detected.");
}