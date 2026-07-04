import { Redis } from "@upstash/redis";

const STATUS_KEY = "receipt-drop:status";
const STALE_AFTER_MS = 45 * 1000;

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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const value = await getRedis().get(STATUS_KEY);
    const status = typeof value === "string" ? JSON.parse(value) : value;
    const checkedAtMs = status?.checkedAt ? Date.parse(status.checkedAt) : 0;
    const fresh = checkedAtMs > 0 && Date.now() - checkedAtMs <= STALE_AFTER_MS;
    const printerOnline = Boolean(fresh && status?.printerOnline);

    return res.status(200).json({
      ok: true,
      printerOnline,
      checkedAt: status?.checkedAt || null,
    });
  } catch (error) {
    console.error("receipt status failed", { message: error?.message });
    return res.status(200).json({ ok: true, printerOnline: false, checkedAt: null });
  }
}
