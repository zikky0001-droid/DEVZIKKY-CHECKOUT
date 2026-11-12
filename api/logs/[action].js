// Single dynamic Vercel function for the Runtime Logs authentication routes.
// It keeps the existing independent dz_logs session handling in the shared router.
import handler from "../[...path].js";

export const config = { api: { bodyParser: false } };

export default function logsAction(req, res) {
  const incomingUrl = typeof req.url === "string" ? req.url : "/";
  const url = new URL(incomingUrl, `https://${req.headers.host || "localhost"}`);
  const segments = url.pathname.split("/").filter(Boolean);
  const action = segments[segments.length - 1] || "";

  req.url = `/api/logs/${encodeURIComponent(action)}${url.search}`;
  return handler(req, res);
}
