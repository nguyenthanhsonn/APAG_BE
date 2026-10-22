// Creates a NEW local database. Never resets, truncates, or seeds the application's database.
const { randomUUID, randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const {
  fs,
  path,
  project,
  dependency,
  resolveDatabaseUrl,
  localDatabase,
  writeJson,
} = require("./support.cjs");
const { Client } = dependency("pg");
const bcrypt = dependency("bcrypt");
const id = () => randomUUID();
async function main() {
  const source = resolveDatabaseUrl(process.env);
  if (!source) throw new Error("Configure local database credentials");
  const url = localDatabase(source);
  const databaseName =
    process.env.BENCH_DB_NAME ||
    `apag_benchmark_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(3).toString("hex")}`;
  if (
    !/^apag_benchmark_[a-z0-9_]{1,42}$/.test(databaseName) ||
    url.pathname === `/${databaseName}`
  )
    throw new Error("Fresh benchmark database name required");
  const admin = new Client({
    connectionString: source,
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
  url.pathname = `/${databaseName}`;
  url.search = "?schema=public";
  const databaseUrl = url.toString();
  const migration = spawnSync(
    process.execPath,
    [
      dependency.resolve("prisma/build/index.js"),
      "--config",
      "prisma.config.ts",
      "migrate",
      "deploy",
    ],
    {
      cwd: project,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DIRECT_URL: databaseUrl,
      },
      encoding: "utf8",
      timeout: 60000,
    },
  );
  if (migration.status !== 0)
    throw new Error(
      "Migration failed in the new benchmark DB; application DB was not changed",
    );
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  const password = randomBytes(18).toString("hex");
  const hash = await bcrypt.hash(password, 10);
  const faculties = Array.from({ length: 10 }, (_, i) => ({
    id: id(),
    code: `BENCH_F${i + 1}`,
    name: `Synthetic Faculty ${i + 1}`,
  }));
  const majors = Array.from({ length: 20 }, (_, i) => ({
    id: id(),
    code: `BENCH_M${i + 1}`,
    name: `Synthetic Major ${i + 1}`,
    facultyId: faculties[i % 10].id,
  }));
  const classes = Array.from({ length: 400 }, (_, i) => ({
    id: id(),
    code: `BENCH_C${i + 1}`,
    name: `Synthetic Class ${i + 1}`,
    majorId: majors[i % 20].id,
    enrollmentYear: 2025,
  }));
  const account = (username, role, fullName) => ({
    id: id(),
    username,
    role,
    fullName,
    email: `${username}@benchmark.invalid`,
    passwordHash: hash,
  });
  const students = Array.from({ length: 10000 }, (_, i) => ({
    ...account(
      `bench_sv_${String(i + 1).padStart(5, "0")}`,
      "student",
      `Synthetic Student ${String(i + 1).padStart(5, "0")}`,
    ),
    classId: classes[i % 400].id,
    studentCode: `BENCH${String(i + 1).padStart(5, "0")}`,
  }));
  const leaders = classes.map((c, i) => ({
    ...account(
      `bench_leader_${i + 1}`,
      "class_leader",
      `Synthetic Leader ${i + 1}`,
    ),
    classId: c.id,
  }));
  const advisors = Array.from({ length: 80 }, (_, i) =>
    account(`bench_advisor_${i + 1}`, "advisor", `Synthetic Advisor ${i + 1}`),
  );
  const facultyUsers = faculties.map((f, i) => ({
    ...account(
      `bench_faculty_${i + 1}`,
      "faculty",
      `Synthetic Faculty Actor ${i + 1}`,
    ),
    facultyId: f.id,
  }));
  const adminUser = account("bench_admin", "admin", "Synthetic Admin");
  const trainingUser = account(
    "bench_training",
    "training_department",
    "Synthetic Training",
  );
  const semesters = [
    {
      id: id(),
      year: 2025,
      semester: "1",
      start: "2025-09-01",
      end: "2025-12-31",
      active: false,
    },
    {
      id: id(),
      year: 2025,
      semester: "2",
      start: "2026-01-01",
      end: "2026-06-30",
      active: false,
    },
    {
      id: id(),
      year: 2026,
      semester: "1",
      start: "2026-09-01",
      end: "2027-01-31",
      active: true,
    },
  ];
  const criteria = ["I", "II", "III", "IV", "V"].map((code, i) => ({
    id: id(),
    code,
    max: [20, 25, 20, 25, 10][i],
  }));
  async function insert(table, columns, rows) {
    for (let start = 0; start < rows.length; start += 1000) {
      await client.query(
        `INSERT INTO ${table} (${columns.map((x) => `"${x}"`).join(",")}) SELECT ${columns.map((x) => `"${x}"`).join(",")} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`,
        [JSON.stringify(rows.slice(start, start + 1000))],
      );
    }
  }
  // All synthetic content is committed together. Failure leaves a new empty DB, never a half seed.
  try {
    await client.query("BEGIN");
    await insert("faculties", ["id", "code", "name"], faculties);
    await insert(
      "majors",
      ["id", "code", "name", "faculty_id"],
      majors.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        faculty_id: m.facultyId,
      })),
    );
    await insert(
      "classes",
      ["id", "code", "name", "major_id", "enrollment_year"],
      classes.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        major_id: c.majorId,
        enrollment_year: c.enrollmentYear,
      })),
    );
    await insert(
      "users",
      [
        "id",
        "username",
        "email",
        "password_hash",
        "role",
        "full_name",
        "updated_at",
      ],
      [
        ...students,
        ...leaders,
        ...advisors,
        ...facultyUsers,
        adminUser,
        trainingUser,
      ].map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        password_hash: u.passwordHash,
        role: u.role,
        full_name: u.fullName,
        updated_at: "2026-10-01T00:00:00Z",
      })),
    );
    await insert(
      "class_students",
      ["id", "class_id", "student_id", "student_code"],
      students.map((s) => ({
        id: id(),
        class_id: s.classId,
        student_id: s.id,
        student_code: s.studentCode,
      })),
    );
    await insert(
      "class_leader_assignments",
      ["id", "user_id", "class_id"],
      leaders.map((l) => ({ id: id(), user_id: l.id, class_id: l.classId })),
    );
    await insert(
      "advisor_assignments",
      ["id", "user_id", "class_id"],
      classes.map((c, i) => ({
        id: id(),
        user_id: advisors[i % 80].id,
        class_id: c.id,
      })),
    );
    await insert(
      "faculty_assignments",
      ["id", "user_id", "faculty_id"],
      facultyUsers.map((f) => ({
        id: id(),
        user_id: f.id,
        faculty_id: f.facultyId,
      })),
    );
    await insert(
      "semesters",
      [
        "id",
        "year",
        "semester",
        "start_date",
        "end_date",
        "student_deadline",
        "class_deadline",
        "faculty_deadline",
        "is_active",
      ],
      semesters.map((s) => ({
        id: s.id,
        year: s.year,
        semester: s.semester,
        start_date: s.start,
        end_date: s.end,
        student_deadline: "2027-01-31T16:59:59.999Z",
        class_deadline: "2027-02-07T16:59:59.999Z",
        faculty_deadline: "2027-02-14T16:59:59.999Z",
        is_active: s.active,
      })),
    );
    const leaves = [];
    for (const root of criteria)
      for (let j = 1; j <= 2; j++)
        leaves.push({
          id: id(),
          code: `${root.code}.${j}`,
          max: Math.ceil(root.max / 2),
          parent: root.id,
          section: criteria.indexOf(root),
          part: j,
        });
    await insert(
      "evaluation_criteria",
      ["id", "code", "title", "max_score", "sort_order", "parent_id"],
      [
        ...criteria.map((c, i) => ({
          id: c.id,
          code: c.code,
          title: `Synthetic rubric ${c.code}`,
          max_score: c.max,
          sort_order: i,
          parent_id: null,
        })),
        ...leaves.map((c, i) => ({
          id: c.id,
          code: c.code,
          title: `Synthetic criterion ${c.code}`,
          max_score: c.max,
          sort_order: i + 5,
          parent_id: c.parent,
        })),
      ],
    );
    const forms = [],
      scores = [],
      evidences = [];
    const currentStates = [
      "draft",
      "submitted",
      "class_leader_approved",
      "class_approved",
      "faculty_approved",
      "finalized",
      "rejected",
    ];
    const rank = (n) =>
      n >= 90
        ? "excellent"
        : n >= 80
          ? "good"
          : n >= 65
            ? "fair"
            : n >= 50
              ? "average"
              : n >= 35
                ? "weak"
                : "poor";
    for (let term = 0; term < 3; term++)
      for (let i = 0; i < students.length; i++) {
        const s = students[i],
          formId = id(),
          section = [
            12 + (i % 9),
            20 + (i % 6),
            8 + (i % 13),
            10 + (i % 16),
            i % 11,
          ],
          total = section.reduce((a, b) => a + b, 0);
        const bucket = (i * 37 + Math.floor(i / 400) * 13) % 100;
        const status =
          term < 2
            ? "finalized"
            : i < 200
              ? "draft"
              : currentStates[
                  bucket < 20
                    ? 0
                    : bucket < 40
                      ? 1
                      : bucket < 55
                        ? 2
                        : bucket < 70
                          ? 3
                          : bucket < 85
                            ? 4
                            : bucket < 95
                              ? 5
                              : 6
                ];
        const reviewed = [
            "class_leader_approved",
            "class_approved",
            "faculty_approved",
            "finalized",
          ].includes(status),
          advisorReviewed = [
            "class_approved",
            "faculty_approved",
            "finalized",
          ].includes(status),
          final = status === "finalized";
        const classIndex = i % 400;
        forms.push({
          id: formId,
          version: 0,
          student_id: s.id,
          class_id: s.classId,
          semester_id: semesters[term].id,
          status,
          student_score: total,
          class_score: advisorReviewed ? total : null,
          final_score: final ? total : null,
          rank: rank(total),
          study_score: section[0],
          discipline_score: section[1],
          activity_score: section[2],
          community_score: section[3],
          role_score: section[4],
          is_locked: final,
          submitted_at:
            status === "draft"
              ? null
              : `${term < 2 ? "2026-01-01" : "2026-10-01"}T00:00:00Z`,
          class_leader_reviewed_by: reviewed ? leaders[classIndex].id : null,
          class_reviewed_by: advisorReviewed
            ? advisors[classIndex % 80].id
            : null,
          admin_finalized_by: final ? trainingUser.id : null,
          updated_at: "2026-10-01T00:00:00Z",
        });
        for (const c of leaves)
          scores.push({
            id: id(),
            form_id: formId,
            criteria_id: c.id,
            student_score:
              c.part === 1
                ? Math.floor(section[c.section] / 2)
                : Math.ceil(section[c.section] / 2),
            class_score: advisorReviewed
              ? c.part === 1
                ? Math.floor(section[c.section] / 2)
                : Math.ceil(section[c.section] / 2)
              : null,
          });
        if (i % 3 === 0)
          evidences.push({
            id: id(),
            student_id: s.id,
            evaluation_form_id: formId,
            criterion_id: leaves[i % leaves.length].id,
            image_url: `https://benchmark.invalid/evidence/${formId}.png`,
            public_id: `synthetic/${formId}`,
            updated_at: "2026-10-01T00:00:00Z",
          });
        if (term === 2) s.formId = formId;
      }
    await insert("evaluation_forms", Object.keys(forms[0]), forms);
    await insert("form_criteria_scores", Object.keys(scores[0]), scores);
    await insert("evidences", Object.keys(evidences[0]), evidences);
    await insert(
      "notifications",
      ["id", "user_id", "type", "title", "content", "is_read"],
      students.map((s, i) => ({
        id: id(),
        user_id: s.id,
        type: "benchmark",
        title: "Synthetic benchmark notice",
        content: "Synthetic data only. No real APAG recipient.",
        is_read: i % 2 === 0,
      })),
    );
    await client.query("COMMIT");
    await client.query("ANALYZE");
    const counts = {};
    for (const table of [
      "users",
      "faculties",
      "majors",
      "classes",
      "class_students",
      "semesters",
      "evaluation_forms",
      "form_criteria_scores",
      "evidences",
      "notifications",
    ])
      counts[table] = Number(
        (await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count,
      );
    const statuses = (
      await client.query(
        "SELECT status,count(*)::int AS count FROM evaluation_forms GROUP BY status ORDER BY status",
      )
    ).rows;
    const environment = (
      await client.query(
        "SELECT version() AS postgres, pg_database_size(current_database())::text AS bytes, current_setting('max_connections') AS max_connections",
      )
    ).rows[0];
    const manifest = {
      synthetic: true,
      createdAt: new Date().toISOString(),
      databaseName,
      databaseUrl,
      password,
      counts,
      statuses,
      environment,
      classes: classes.map((c) => ({
        id: c.id,
        facultyId: majors.find((m) => m.id === c.majorId).facultyId,
      })),
      semesters,
      admin: { username: adminUser.username },
      students: students
        .slice(0, 200)
        .map((s) => ({ username: s.username, formId: s.formId })),
    };
    writeJson(
      path.join(__dirname, ".local", `${databaseName}.json`),
      manifest,
      true,
    );
    writeJson(path.join(__dirname, ".local/fixture.json"), manifest, true);
    writeJson(
      path.join(__dirname, ".local/k6.json"),
      {
        synthetic: true,
        password,
        classes: manifest.classes,
        semesters,
        admin: manifest.admin,
        students: manifest.students,
      },
      true,
    );
    writeJson(path.join(__dirname, "results", databaseName, "dataset.json"), {
      ...manifest,
      databaseUrl: undefined,
      password: undefined,
      admin: undefined,
      students: undefined,
    });
    console.log(
      JSON.stringify({
        event: "benchmark.seeded",
        databaseName,
        counts,
        statuses,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((error) => {
  console.error(
    `Benchmark seed failed (${error.code || error.name}); no application database reset was performed.`,
  );
  process.exitCode = 1;
});
