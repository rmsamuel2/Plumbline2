#!/usr/bin/env node
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

function requireArg(name, value) {
  if (!value) throw new Error(`Missing required argument: --${name}`);
  return value;
}

function toJsonMaybe(v) {
  if (!v) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    throw new Error(`--user-metadata must be valid JSON (got: ${v})`);
  }
}

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Set env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
}

const email = requireArg("email", getArg("--email"));
const password = requireArg("password", getArg("--password"));

const emailConfirm = (getArg("--email-confirm") ?? "true").toLowerCase();
const email_confirm = emailConfirm === "true";

const user_metadata = toJsonMaybe(getArg("--user-metadata")) ?? {};
const sendInvite = getArg("--send-invite"); // placeholder if you later want custom logic

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

const { data, error } = await supabaseAdmin.auth.admin.createUser({
  email,
  password,
  user_metadata,
  email_confirm,
});

if (error) {
  console.error("Error:", error);
  process.exit(1);
}

console.log("Created user:");
console.log({
  id: data.user.id,
  email: data.user.email,
  email_confirmed_at: data.user.email_confirmed_at,
});