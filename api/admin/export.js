// Explicit Vercel function entry point for /api/admin/export.
// Keep request handling centralized in the shared API router.
import handler from "../[...path].js";

export const config = { api: { bodyParser: false } };

export default function adminExport(req, res) {
  const incomingUrl = typeof req.url === "string" ? req.url : "";
  const queryIndex = incomingUrl.indexOf("?");
  const query = queryIndex >= 0 ? incomingUrl.slice(queryIndex) : "";
  req.url = `/api/admin/export${query}`;
  return handler(req, res);
}
