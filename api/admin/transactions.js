// Explicit Vercel function entry point for /api/admin/transactions.
// Keep request handling centralized in the shared API router.
import handler from "../[...path].js";

export const config = { api: { bodyParser: false } };

export default function adminTransactions(req, res) {
  const incomingUrl = typeof req.url === "string" ? req.url : "";
  const queryIndex = incomingUrl.indexOf("?");
  const query = queryIndex >= 0 ? incomingUrl.slice(queryIndex) : "";
  req.url = `/api/admin/transactions${query}`;
  return handler(req, res);
}
