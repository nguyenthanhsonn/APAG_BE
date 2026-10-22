import http from "k6/http";
import { base, fixture, body, params, record, pause } from "./common.js";
export function login() {
  const user = fixture.students[(__VU - 1) % fixture.students.length];
  const r = http.post(
    `${base}/auth/login`,
    JSON.stringify({ username: user.username, password: fixture.password }),
    params(undefined, "login"),
  );
  const payload = body(r);
  record(
    r,
    "login",
    r.status === 201 && Boolean(payload?.accessToken && payload?.refreshToken),
  );
  pause();
}
