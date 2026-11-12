// One dynamic Vercel function for POST /api/automation/initialize and /verify.
// API-key authentication, validation, Paystack calls, and verification remain
// centralized in the existing shared API router.
import handler from "../[...path].js";

export const config = { api: { bodyParser: false } };

export default function automationAction(req, res) {
  const incomingUrl = typeof req.url === "string" ? req.url : "/";
  const url = new URL(incomingUrl, `https://${req.headers.host || "localhost"}`);
  const segments = url.pathname.split("/").filter(Boolean);
  const action = segments[segments.length - 1] || "";

  req.url = `/api/automation/${encodeURIComponent(action)}${url.search}`;
  return handler(req, res);
}
