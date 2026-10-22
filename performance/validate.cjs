const assert = require("node:assert/strict");
const { dependency, fixture } = require("./support.cjs");
const { Client } = dependency("pg");
async function main() {
  const data = fixture();
  const db = new Client({
    connectionString: data.databaseUrl,
    connectionTimeoutMillis: 5000,
  });
  await db.connect();
  try {
    const checks = {
      students: "SELECT count(*)::int AS n FROM users WHERE role='student'",
      classes: "SELECT count(*)::int AS n FROM classes",
      forms: "SELECT count(*)::int AS n FROM evaluation_forms",
      scores: "SELECT count(*)::int AS n FROM form_criteria_scores",
      activeSemesters:
        "SELECT count(*)::int AS n FROM semesters WHERE is_active",
      mismatchedEnrollment:
        "SELECT count(*)::int AS n FROM evaluation_forms f JOIN class_students cs ON cs.student_id=f.student_id WHERE cs.class_id<>f.class_id",
      mismatchedScore:
        "SELECT count(*)::int AS n FROM evaluation_forms WHERE status='finalized' AND (final_score<>study_score+discipline_score+activity_score+community_score+role_score OR NOT is_locked)",
      duplicateForms:
        "SELECT count(*)::int AS n FROM (SELECT student_id,semester_id FROM evaluation_forms GROUP BY 1,2 HAVING count(*)>1) duplicates",
      leaderRole:
        "SELECT count(*)::int AS n FROM class_leader_assignments a JOIN users u ON u.id=a.user_id WHERE u.role<>'class_leader'",
      editableFixture:
        "SELECT count(*)::int AS n FROM evaluation_forms WHERE id=ANY($1::uuid[]) AND status='draft' AND NOT is_locked",
    };
    const observed = {};
    for (const [key, sql] of Object.entries(checks))
      observed[key] = (
        await db.query(
          sql,
          key === "editableFixture" ? [data.students.map((s) => s.formId)] : [],
        )
      ).rows[0].n;
    for (const [key, expected] of Object.entries({
      students: 10000,
      classes: 400,
      forms: 30000,
      scores: 300000,
      activeSemesters: 1,
      mismatchedEnrollment: 0,
      mismatchedScore: 0,
      duplicateForms: 0,
      leaderRole: 0,
      editableFixture: 200,
    }))
      assert.equal(observed[key], expected, key);
    console.log(
      JSON.stringify({
        event: "benchmark.dataset_validated",
        databaseName: data.databaseName,
        checks: observed,
      }),
    );
  } finally {
    await db.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : `Dataset validation failed (${error.code || error.name})`,
  );
  process.exitCode = 1;
});
