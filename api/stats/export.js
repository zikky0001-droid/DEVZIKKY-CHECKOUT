// Explicit Vercel function entry point for GET /api/stats/export.
// Keep validation, privacy filtering and report generation in the shared router.
import handler from "../[...path].js";

export const config = { api: { bodyParser: false } };

export default function statsExport(req, res) {
  const incomingUrl = typeof req.url === "string" ? req.url : "";
  const queryIndex = incomingUrl.indexOf("?");
  const query = queryIndex >= 0 ? incomingUrl.slice(queryIndex) : "";
  req.url = `/api/stats/export${query}`;
  return handler(req, res);
}
