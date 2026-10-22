import http from "k6/http";
import {
  base,
  fixture,
  mode,
  body,
  params,
  record,
  pause,
  conflicts,
  invariants,
} from "./common.js";
export function evaluationsWrite(data) {
  // Each VU owns its student's draft form; conflict mode deliberately races TWO writes on that form.
  const student = fixture.students[__VU - 1],
    token = data.tokens[__VU - 1];
  const url = `${base}/training-evaluations/${student.formId}`;
  const before = http.get(url, params(token, "write_read_version"));
  const version = body(before)?.version;
  if (
    !record(
      before,
      "read_before_write",
      before.status === 200 && Number.isInteger(version),
    )
  ) {
    pause();
    return;
  }
  const payload = JSON.stringify({
    expectedVersion: version,
    regularScoreLevel: "FROM_7_TO_UNDER_9",
    academicRank: "GOOD",
    activities: [],
  });
  if (mode === "conflict") {
    const p = params(token, "write_race", {
      responseCallback: http.expectedStatuses(200, 409),
    });
    const responses = http.batch([
      ["PATCH", `${url}/study-score`, payload, p],
      ["PATCH", `${url}/study-score`, payload, p],
    ]);
    for (const r of responses) {
      if (r.status === 409) conflicts.add(1);
      record(r, "conflict", r.status === 200 || r.status === 409);
    }
    const after = http.get(url, params(token, "verify_version"));
    const winners = responses.filter((r) => r.status === 200);
    const valid =
      winners.length === 1 &&
      responses.filter((r) => r.status === 409).length === 1 &&
      body(after)?.version === version + 1 &&
      body(winners[0])?.version === version + 1;
    invariants.add(!valid);
    record(after, "verify", after.status === 200 && valid);
  } else {
    const r = http.patch(
      `${url}/study-score`,
      payload,
      params(token, "write_score"),
    );
    record(r, "write", r.status === 200 && body(r)?.version === version + 1);
  }
  pause();
}
