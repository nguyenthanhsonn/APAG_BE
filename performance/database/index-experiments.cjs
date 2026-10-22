// Each candidate is visible to EXPLAIN on this connection only and is rolled back.
const { data, output, percentiles } = require('./measure.cjs');
const { dependency, path, writeJson } = require('../support.cjs');
const { Client } = dependency('pg');
const before = require(path.join(output, 'before.json'));
const candidates = [
  { name: 'proposed_semester_status_class', sql: 'CREATE INDEX dbperf_candidate_forms ON evaluation_forms (semester_id,status,class_id)' },
  { name: 'ordered_semester_listing', sql: 'CREATE INDEX dbperf_candidate_forms ON evaluation_forms (semester_id,submitted_at DESC,created_at DESC)' },
  { name: 'ordered_student_listing', sql: 'CREATE INDEX dbperf_candidate_users ON users (role,deleted_at,created_at DESC,id DESC)' },
  { name: 'ordered_user_timeline', sql: 'CREATE INDEX dbperf_candidate_users ON users (created_at DESC,id DESC)' },
  { name: 'ordered_live_user_timeline', sql: 'CREATE INDEX dbperf_candidate_users ON users (deleted_at,created_at DESC,id DESC)' },
  { name: 'proposed_notification_unread', sql: 'CREATE INDEX dbperf_candidate_notifications ON notifications (user_id,is_read)' },
];
async function main() {
  const client = new Client({ connectionString: data.databaseUrl, statement_timeout: 15000, application_name: 'apag-dbperf-candidates' });
  await client.connect();
  const results = [];
  try {
    const installed = (await client.query("SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND indexname IN ('evaluation_forms_semester_listing_idx','users_created_at_id_idx')")).rows[0].n;
    if (installed) throw Error('Create a fresh clone before independent candidate experiments');
    for (const candidate of candidates) {
      await client.query('BEGIN');
      try {
        await client.query(candidate.sql);
        const cases = [];
        for (const test of before.cases) {
          const statements = [];
          for (const statement of test.statements) {
            const samples = []; let plan;
            for (let run = 0; run < 7; run++) {
              const response = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`, statement.values);
              plan = response.rows[0]['QUERY PLAN'][0];
              if (run) samples.push(plan['Execution Time']);
            }
            statements.push({ query: statement.query, executionMs: percentiles(samples), sharedHitBlocks: plan.Plan['Shared Hit Blocks'], plan });
          }
          cases.push({ name: test.name, statements });
        }
        results.push({ ...candidate, cases });
        const target = cases.filter(c => ['evaluations_semester','evaluations_status','evaluations_class_status','admin_approval','students_listing','student_search_hit','notifications_unread'].includes(c.name));
        console.log(JSON.stringify({ candidate: candidate.name, cases: target.map(c => ({name:c.name,queryMs:c.statements.map(s=>s.executionMs.median)})) }));
      } finally { await client.query('ROLLBACK'); }
    }
    writeJson(path.join(output, 'index-experiments.json'), { synthetic: true, databaseName: data.databaseName, repetitions: 6, candidateScope: 'transactional DDL; every candidate rolled back', results });
  } finally { await client.end(); }
}
main().catch(error => { console.error(`Index experiment failed (${error.code || error.name}): ${error.message}`); process.exitCode = 1; });
