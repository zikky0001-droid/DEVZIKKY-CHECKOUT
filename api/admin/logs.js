// Explicit Vercel function entry point for /api/admin/logs.
// Runtime log access is protected by the same signed Admin session as the Control Room.
import handler from "../[...path].js";

export const config = { api: { bodyParser: false } };

export default function adminLogs(req, res) {
  const incomingUrl = typeof req.url === "string" ? req.url : "";
  const queryIndex = incomingUrl.indexOf("?");
  const query = queryIndex >= 0 ? incomingUrl.slice(queryIndex) : "";
  req.url = `/api/admin/logs${query}`;
  return handler(req, res);
}
