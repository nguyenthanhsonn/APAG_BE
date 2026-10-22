import { options as configured, mode, loginSetup, summary } from "./common.js";
import { login } from "./login.js";
import { evaluationsRead } from "./evaluations-read.js";
import { evaluationsWrite } from "./evaluations-write.js";
import { reports } from "./reports.js";
export const options = configured;
export const setup = loginSetup;
export const handleSummary = summary;
export default function (data) {
  if (mode === "login") return login();
  if (mode.startsWith("evaluations_")) return evaluationsRead(data);
  if (mode === "write" || mode === "conflict") return evaluationsWrite(data);
  if (mode.startsWith("reports_") || mode === "export") return reports(data);
  throw new Error("Unknown benchmark CASE");
}
