import { Redis } from "@upstash/redis";

const STATUS_KEY = "receipt-drop:status";

let redis;

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && !/^\*+$/.test(value)) return value;
  }
  return undefined;
}

function getRedis() {
  if (!redis) {
    const url = envValue(
      "UPSTASH_REDIS_REST_KV_REST_API_URL",
      "UPSTASH_REDIS_REST_URL"
    );
    const token = envValue(
      "UPSTASH_REDIS_REST_KV_REST_API_TOKEN",
      "UPSTASH_REDIS_REST_TOKEN"
    );
    redis = new Redis({ url, token });
  }
  return redis;
}

function authorized(req) {
  const token = process.env.POLL_TOKEN;
  return Boolean(token && req.headers.authorization === `Bearer ${token}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const status = {
      printerOnline: Boolean(body.printerOnline),
      printer: String(body.printer || "EPSON_TM_T88V").slice(0, 80),
      checkedAt: new Date().toISOString(),
    };

    await getRedis().set(STATUS_KEY, JSON.stringify(status), { ex: 90 });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("receipt heartbeat failed", { message: error?.message });
    return res.status(500).json({ ok: false, error: "Status unavailable." });
  }
}
