// Explicit Vercel function entry point for POST /api/automation/initialize.
// Keep authentication, validation and Paystack logic centralized in the shared API router.
import handler from "../[...path].js";

export const config = { api: { bodyParser: false } };

export default function automationInitialize(req, res) {
  const incomingUrl = typeof req.url === "string" ? req.url : "";
  const queryIndex = incomingUrl.indexOf("?");
  const query = queryIndex >= 0 ? incomingUrl.slice(queryIndex) : "";
  req.url = `/api/automation/initialize${query}`;
  return handler(req, res);
}
