import { neon } from "@neondatabase/serverless";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { APP_CONFIG, CURRENCIES } from "../config.js";

const sql = () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(process.env.DATABASE_URL);
};
const json = (res, status, data) => {
  res.status(status).setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  return res.end(JSON.stringify(data));
};
const bodyOf = async req => {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) raw += chunk;
  req.rawBody = raw;
  try { req.body = raw ? JSON.parse(raw) : {}; return req.body; } catch { req.body = {}; return {}; }
};
const emailOk = value => typeof value === "string" &&
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()) && value.length <= 254;
const moneyMinor = n => Math.round(Number(n) * 100);
const randomRef = () => "DZP-" + Date.now().toString(36).toUpperCase() + "-" + randomBytes(5).toString("hex").toUpperCase();
const paystack = async (path, payload, method="POST") => {
  if (!process.env.PAYSTACK_KEY) throw new Error("PAYSTACK_KEY is not configured");
  const r = await fetch("https://api.paystack.co"+path,{
    method, headers:{Authorization:`Bearer ${process.env.PAYSTACK_KEY}`,"Content-Type":"application/json"},
    ...(payload ? {body:JSON.stringify(payload)} : {})
  });
  const data = await r.json().catch(()=>({}));
  if (!r.ok || data.status === false) throw new Error(data.message || `Paystack request failed (${r.status})`);
  return data.data;
};
const ageDays = d => (Date.now() - new Date(d+"T00:00:00Z").getTime()) / 86400000;
const isValidRateSet = rates => rates && typeof rates === "object" &&
  CURRENCIES.every(c => c.code === "NGN" || (Number.isFinite(Number(rates[c.code])) && Number(rates[c.code]) > 0));
async function getRates(db) {
  const now = new Date();
  try {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), APP_CONFIG.RATE_TIMEOUT_MS);
    const response = await fetch(APP_CONFIG.RATE_SOURCE_URL,{signal:controller.signal,headers:{Accept:"application/json"}});
    clearTimeout(timer);
    if (!response.ok) throw new Error(`Rates API HTTP ${response.status}`);
    const data = await response.json();
    if (data.base !== "NGN" || !data.date || ageDays(data.date) > APP_CONFIG.RATE_MAX_AGE_DAYS || ageDays(data.date) < -1)
      throw new Error("Rates API returned an unexpected base or stale/future date");
    const rates = {NGN:1};
    for (const c of CURRENCIES) {
      if (c.code === "NGN") continue;
      const n = Number(data.rates?.[c.code]);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Missing/invalid rate: ${c.code}`);
      rates[c.code] = 1 / n; // API gives foreign units per NGN; we store NGN per foreign unit.
    }
    await db`INSERT INTO rate_snapshots(rate_date,source_url,rates)
      VALUES(${data.date},${APP_CONFIG.RATE_SOURCE_URL},${JSON.stringify(rates)}::jsonb)
      ON CONFLICT(rate_date,source_url) DO UPDATE SET rates=EXCLUDED.rates,created_at=NOW()`;
    return {rates,rateDate:data.date,source:"live"};
  } catch (err) {
    console.error("[rates] Live provider failed:",err.message);
    const cached = await db`SELECT rate_date, rates FROM rate_snapshots ORDER BY rate_date DESC, created_at DESC LIMIT 1`;
    if (cached.length && ageDays(String(cached[0].rate_date).slice(0,10)) <= APP_CONFIG.RATE_MAX_AGE_DAYS) {
      const rates = cached[0].rates;
      return {rates,rateDate:String(cached[0].rate_date).slice(0,10),source:"cached"};
    }
    const backup = {...APP_CONFIG.STATIC_BACKUP_NGN_PER_UNIT};
    const missing = CURRENCIES.filter(c=>!Number.isFinite(Number(backup[c.code]))).map(c=>c.code);
    return {rates:backup,rateDate:APP_CONFIG.STATIC_BACKUP_DATE,source:"static_backup",missing};
  }
}
async function lazyCleanup(db) {
  // At most once per 24 hours; atomic claim prevents concurrent requests duplicating work.
  await db`
    WITH claim AS (
      UPDATE maintenance_state SET last_run_at=NOW()
      WHERE task='transaction_retention'
        AND (last_run_at IS NULL OR last_run_at < NOW() - INTERVAL '24 hours')
      RETURNING task
    )
    DELETE FROM transactions
    WHERE created_at < NOW() - INTERVAL '3 years'
      AND EXISTS (SELECT 1 FROM claim)
  `;
}
const sessionToken = () => {
  const exp = Date.now()+8*60*60*1000;
  const payload = Buffer.from(JSON.stringify({exp})).toString("base64url");
  const sig = createHmac("sha256",process.env.ADMIN_KEY).update(payload).digest("base64url");
  return `${payload}.${sig}`;
};
function validSession(req) {
  if (!process.env.ADMIN_KEY) return false;
  const cookie = req.headers.cookie || "";
  const token = cookie.split(";").map(x=>x.trim()).find(x=>x.startsWith("dz_admin="))?.slice(9);
  if (!token) return false;
  const [payload,sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = createHmac("sha256",process.env.ADMIN_KEY).update(payload).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return false;
    return JSON.parse(Buffer.from(payload,"base64url").toString()).exp > Date.now();
  } catch { return false; }
}
const adminOnly = req => validSession(req);
const apiKeyOk = req => {
  const auth = req.headers.authorization || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expected = process.env.API_KEY || "";
  return !!expected && supplied.length===expected.length &&
    timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
};
async function initPayment(db, {amountNgn,email,name,type,note,source,originalAmount,originalCurrency,exchangeRate,rateDate,rateSource}) {
  if (!Number.isFinite(amountNgn) || amountNgn < 1 || amountNgn > 100000000)
    throw new Error("Amount must be between ₦1 and ₦100,000,000");
  const reference = randomRef();
  const minor = Math.round(amountNgn*100);
  const row = await db`INSERT INTO transactions
    (reference,name,email,amount_minor,currency,original_amount,original_currency,exchange_rate,rate_date,rate_source,type,note,source)
    VALUES(${reference},${name},${email},${minor},'NGN',${originalAmount ?? amountNgn},
      ${originalCurrency ?? 'NGN'},${exchangeRate ?? 1},${rateDate ?? null},${rateSource ?? 'api'},
      ${type},${note ?? null},${source}) RETURNING id`;
  try {
    const data = await paystack("/transaction/initialize",{
      email,amount:String(minor),currency:"NGN",reference,
      callback_url: `${process.env.APP_URL || "https://example.com"}/?payment=return`,
      metadata:{custom_fields:[{display_name:"Payment type",variable_name:"payment_type",value:type},
        {display_name:"Source",variable_name:"source",value:source}]}
    });
    return {reference,authorization_url:data.authorization_url,access_code:data.access_code};
  } catch (e) {
    await db`UPDATE transactions SET status='failed',updated_at=NOW() WHERE reference=${reference}`;
    throw e;
  }
}
async function verifyAndUpdate(db, reference) {
  const data = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`,null,"GET");
  const status = data.status === "success" ? "success" : data.status === "failed" ? "failed" : "pending";
  await db`UPDATE transactions SET status=${status},paystack_status=${data.status},
    paid_at=CASE WHEN ${status}='success' THEN COALESCE(paid_at,NOW()) ELSE paid_at END,
    updated_at=NOW() WHERE reference=${reference}`;
  return {status,reference,amount:data.amount,currency:data.currency};
}
async function webhook(req, db) {
  const signature = req.headers["x-paystack-signature"];
  if (!signature || !process.env.PAYSTACK_KEY) return false;
  const raw = req.rawBody || JSON.stringify(req.body || {});
  const expected = createHmac("sha512",process.env.PAYSTACK_KEY).update(raw).digest("hex");
  if (signature.length!==expected.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) return false;
  const event = req.body || {};
  if (event.event === "charge.success" && event.data?.reference) {
    await verifyAndUpdate(db,event.data.reference);
  }
  return true;
}
export const config = { api: { bodyParser: false } };

export default async function handler(req,res) {
  const db = sql();
  try {
    await lazyCleanup(db);
    const path = (req.url || "/").split("?")[0].replace(/^\/api\/?/,"").replace(/\/+$/,"");
    if (path==="health" && req.method==="GET") return json(res,200,{ok:true,service:"DEVZIKKY PAY"});
    if (path==="rates" && req.method==="GET") {
      const r=await getRates(db);
      return json(res,200,{base:"NGN",date:r.rateDate,source:r.source,rates:r.rates,missing:r.missing||[]});
    }
    if (path==="webhook" && req.method==="POST") {
      await bodyOf(req);
      const ok=await webhook(req,db);
      return json(res,ok?200:401,{received:ok});
    }
    if (path==="pay/initialize" && req.method==="POST") {
      const b=await bodyOf(req);
      if (!emailOk(b.email)) return json(res,400,{error:"Enter a valid email address"});
      const currency=String(b.currency||"NGN").toUpperCase();
      const curr=CURRENCIES.find(c=>c.code===currency);
      if (!curr) return json(res,400,{error:"Unsupported currency"});
      const amount=Number(b.amount);
      if (!Number.isFinite(amount)||amount<=0||amount>10000000) return json(res,400,{error:"Invalid amount"});
      const rates=await getRates(db);
      const rate=Number(rates.rates[currency]);
      if (!Number.isFinite(rate)||rate<=0) return json(res,503,{error:"This currency is temporarily unavailable"});
      const amountNgn=currency==="NGN"?amount:amount*rate;
      const result=await initPayment(db,{amountNgn,email:b.email.trim(),name:String(b.name||"Customer").slice(0,100),
        type:["donation","service"].includes(b.type)?b.type:"donation",note:String(b.note||"").slice(0,500),
        source:"website",originalAmount:amount,originalCurrency:currency,exchangeRate:rate,rateDate:rates.rateDate,rateSource:rates.source});
      return json(res,200,{...result,currency:"NGN",amount_ngn:Math.round(amountNgn*100)/100,
        original_amount:amount,original_currency:currency,rate_date:rates.rateDate,rate_source:rates.source});
    }
    if (path==="pay/verify" && req.method==="GET") {
      const ref=new URL(req.url,"https://local.invalid").searchParams.get("reference");
      if (!ref) return json(res,400,{error:"Missing reference"});
      return json(res,200,await verifyAndUpdate(db,ref));
    }
    if (path==="automation/initialize" && req.method==="POST") {
      if (!apiKeyOk(req)) return json(res,401,{error:"Unauthorized"});
      const b=await bodyOf(req);
      const amount=Number(b.amount);
      const result=await initPayment(db,{amountNgn:amount,email:APP_CONFIG.API_EMAIL,name:"Anonymous",
        type:"transaction",note:"Automation",source:"api"});
      return json(res,200,{...result,currency:"NGN",email:APP_CONFIG.API_EMAIL});
    }
    if (path==="stats" && req.method==="GET") {
      const [totals,byCurrency,byType,recent]=await Promise.all([
        db`SELECT COUNT(*) FILTER(WHERE status='success')::int AS successful,
          COALESCE(SUM(amount_minor) FILTER(WHERE status='success'),0)::numeric/100 AS total_ngn
          FROM transactions`,
        db`SELECT original_currency AS currency,COUNT(*)::int AS count,
          COALESCE(SUM(original_amount),0)::numeric AS total
          FROM transactions WHERE status='success' GROUP BY original_currency ORDER BY count DESC`,
        db`SELECT type,COUNT(*)::int AS count,COALESCE(SUM(amount_minor),0)::numeric/100 AS total_ngn
          FROM transactions WHERE status='success' GROUP BY type`,
        db`SELECT reference,amount_minor::numeric/100 AS amount_ngn,type,created_at
          FROM transactions WHERE status='success' ORDER BY paid_at DESC LIMIT 20`
      ]);
      return json(res,200,{totals:totals[0],by_currency:byCurrency,by_type:byType,recent});
    }
    if (path==="admin/login" && req.method==="POST") {
      const b=await bodyOf(req);
      const supplied=String(b.key||"");
      const expected=process.env.ADMIN_KEY||"";
      if (!expected||supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))
        return json(res,401,{error:"Invalid admin key"});
      res.setHeader("Set-Cookie",`dz_admin=${sessionToken()}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);
      return json(res,200,{ok:true});
    }
    if (path==="admin/logout" && req.method==="POST") {
      res.setHeader("Set-Cookie","dz_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
      return json(res,200,{ok:true});
    }
    if (path.startsWith("admin/")) {
      if (!adminOnly(req)) return json(res,401,{error:"Admin authentication required"});
      if (path==="admin/transactions" && req.method==="GET") {
        const rows=await db`SELECT id,reference,name,email,amount_minor::numeric/100 AS amount_ngn,
          original_amount,original_currency,type,note,source,status,created_at,paid_at
          FROM transactions ORDER BY created_at DESC LIMIT 500`;
        return json(res,200,{transactions:rows});
      }
      if (path==="admin/export" && req.method==="GET") {
        const rows=await db`SELECT reference,name,email,amount_minor::numeric/100 AS amount_ngn,
          original_amount,original_currency,type,note,source,status,created_at,paid_at
          FROM transactions ORDER BY created_at DESC`;
        const cols=Object.keys(rows[0]||{reference:""});
        const csv=[cols.join(","),...rows.map(row=>cols.map(k=>`"${String(row[k]??"").replace(/"/g,'""')}"`).join(","))].join("\n");
        res.setHeader("Content-Type","text/csv; charset=utf-8");
        res.setHeader("Content-Disposition",'attachment; filename="devzikky-pay-transactions.csv"');
        return res.end(csv);
      }
    }
    return json(res,404,{error:"Route not found"});
  } catch(err) {
    console.error("[DEVZIKKY PAY]",err?.stack||err);
    return json(res,500,{error:"Server error. Check Vercel function logs."});
  }
}
