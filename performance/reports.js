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
export function reports(data) {
  const endpoint =
    mode === "export"
      ? "export-pdf"
      : mode.replace("reports_", "").replaceAll("_", "-");
  const filters = { semester: "HK1", academicYear: "2026-2027" };
  // Export a real, bounded class report (~25 rows); full-faculty/full-semester exports are separate capacity experiments.
  if (mode === "export")
    filters.classId =
      fixture.classes[(__VU + __ITER) % fixture.classes.length].id;
  const r = http.get(
    `${base}/reports/${endpoint}?${query(filters)}`,
    params(
      data.tokens[0],
      mode,
      mode === "export" ? { responseType: "binary" } : {},
    ),
  );
  const result = mode === "export" ? null : body(r);
  const valid =
    mode === "export"
      ? r.status === 200 &&
        String(r.headers["Content-Type"]).includes("application/pdf") &&
        r.body?.byteLength > 300
      : r.status === 200 &&
        (mode === "reports_overview"
          ? Number.isInteger(result?.totalForms)
          : mode === "reports_training_results"
            ? Number.isInteger(result?.totalFinalized)
            : Array.isArray(result));
  record(r, mode === "export" ? "export" : "read", valid);
  pause();
}
