import http from "k6/http";
import {
  base,
  fixture,
  mode,
  body,
  params,
  record,
  query,
  pause,
} from "./common.js";
export function evaluationsRead(data) {
  const cls = fixture.classes[(__VU * 7 + __ITER) % fixture.classes.length];
  const term = fixture.semesters[__ITER % fixture.semesters.length];
  const filter = { semesterId: term.id, limit: 20, page: 1 + (__ITER % 5) };
  if (mode === "evaluations_class") {
    filter.classId = cls.id;
    filter.page = 1;
  }
  if (mode === "evaluations_faculty") filter.facultyId = cls.facultyId;
  if (mode === "evaluations_status") {
    filter.semesterId = fixture.semesters[2].id;
    filter.status = __ITER % 2 ? "finalized" : "submitted";
  }
  if (mode === "evaluations_keyword")
    filter.keyword =
      __ITER % 2 ? "Synthetic Student 00" : "no-such-benchmark-student";
  if (mode === "evaluations_combined") {
    filter.classId = cls.id;
    filter.facultyId = cls.facultyId;
    filter.status = "finalized";
    filter.keyword = "Synthetic Student";
    filter.page = 1;
  }
  const r = http.get(
    `${base}/admin/evaluations?${query(filter)}`,
    params(data.tokens[0], mode),
  );
  const result = body(r);
  record(
    r,
    "read",
    r.status === 200 &&
      Array.isArray(result?.items) &&
      Number.isInteger(result?.total),
  );
  pause();
}
