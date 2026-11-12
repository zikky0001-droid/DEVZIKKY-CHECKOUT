// Explicit Vercel function entry point for POST /api/automation/verify.
// Keep authentication and Paystack verification centralized in the shared API router.
import handler from "../[...path].js";

export const config = { api: { bodyParser: false } };

export default function automationVerify(req, res) {
  const incomingUrl = typeof req.url === "string" ? req.url : "";
  const queryIndex = incomingUrl.indexOf("?");
  const query = queryIndex >= 0 ? incomingUrl.slice(queryIndex) : "";
  req.url = `/api/automation/verify${query}`;
  return handler(req, res);
}
