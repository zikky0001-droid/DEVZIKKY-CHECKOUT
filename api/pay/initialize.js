// Explicit Vercel function entry point for /api/pay/initialize.
// Routes the request through the shared API handler.
import handler from "../[...path].js";

export const config = { api: { bodyParser: false } };

export default function payInitialize(req, res) {
  const incomingUrl = typeof req.url === "string" ? req.url : "";
  const queryIndex = incomingUrl.indexOf("?");
  const query = queryIndex >= 0 ? incomingUrl.slice(queryIndex) : "";
  req.url = `/api/pay/initialize${query}`;
  return handler(req, res);
}
