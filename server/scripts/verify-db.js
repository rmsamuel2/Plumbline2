// Safe connectivity/schema check. It prints no credentials or connection URL.
const { pool } = require("../src/db.js");

(async () => {
  const result = await pool.query(`
    select
      current_database() as database_name,
      exists(
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'users'
          and column_name = 'settings'
      ) as user_settings,
      exists(
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'workflow'
          and column_name = 'sort_order'
      ) as workflow_sort_order,
      to_regclass('public.ai_workflow_edit') is not null as ai_edit_history,
      to_regclass('public.ai_analysis_report') is not null as ai_analysis_reports,
      to_regclass('public.ai_analysis_report_workflow') is not null as ai_analysis_report_workflows
  `);
  const row = result.rows[0];
  if (!row.user_settings || !row.workflow_sort_order || !row.ai_edit_history ||
      !row.ai_analysis_reports || !row.ai_analysis_report_workflows) {
    throw new Error("Database is reachable, but migrations 004 through 007 are incomplete.");
  }
  console.log("database connection: ok");
  console.log("migration 004 user settings: ok");
  console.log("migration 005 workflow ordering: ok");
  console.log("migration 006 AI edit history: ok");
  console.log("migration 007 durable AI analysis reports: ok");
  await pool.end();
})().catch(async error => {
  console.error("database verification failed:", error.code || "ERROR", error.message);
  try { await pool.end(); } catch (_) { /* already disconnected */ }
  process.exit(1);
});
