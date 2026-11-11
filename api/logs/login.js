// Explicit Vercel function entry point for /api/logs/login.
// Runtime Logs uses an independent session cookie from the Control Room.
import handler from "../[...path].js";

export const config = { api: { bodyParser: false } };

export default function logsLogin(req, res) {
  const incomingUrl = typeof req.url === "string" ? req.url : "";
  const queryIndex = incomingUrl.indexOf("?");
  const query = queryIndex >= 0 ? incomingUrl.slice(queryIndex) : "";
  req.url = `/api/logs/login${query}`;
  return handler(req, res);
}
