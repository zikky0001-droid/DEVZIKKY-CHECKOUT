// Explicit Vercel function entry point for /api/admin/login.
// Keep request handling centralized in the shared API router.
import handler from "../[...path].js";

export const config = { api: { bodyParser: false } };

export default function adminLogin(req, res) {
  const incomingUrl = typeof req.url === "string" ? req.url : "";
  const queryIndex = incomingUrl.indexOf("?");
  const query = queryIndex >= 0 ? incomingUrl.slice(queryIndex) : "";
  req.url = `/api/admin/login${query}`;
  return handler(req, res);
}
