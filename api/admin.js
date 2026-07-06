import { Redis } from "@upstash/redis";

const QUEUE_KEY = "receipt-drop:queue";
const INFLIGHT_KEY = "receipt-drop:inflight";
const FAILED_LOG_KEY = "receipt-drop:failed";
const PRINTED_LOG_KEY = "receipt-drop:printed";
const STATUS_KEY = "receipt-drop:status";
const LAST_PRINTED_KEY = "receipt-drop:last-printed";
const LAST_FAILURE_KEY = "receipt-drop:last-failure";
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

function authorized(req) {
  const token = process.env.POLL_TOKEN;
  return Boolean(token && req.headers.authorization === `Bearer ${token}`);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized." });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const redisClient = getRedis();
    const [
      queueDepth,
      inFlightDepth,
      failedDepth,
      printedDepth,
      statusValue,
      lastPrintedAt,
      lastFailureAt,
    ] = await Promise.all([
      redisClient.llen(QUEUE_KEY),
      redisClient.llen(INFLIGHT_KEY),
      redisClient.llen(FAILED_LOG_KEY),
      redisClient.llen(PRINTED_LOG_KEY),
      redisClient.get(STATUS_KEY),
      redisClient.get(LAST_PRINTED_KEY),
      redisClient.get(LAST_FAILURE_KEY),
    ]);

    const status = typeof statusValue === "string" ? JSON.parse(statusValue) : statusValue;
    const checkedAtMs = status?.checkedAt ? Date.parse(status.checkedAt) : 0;
    const heartbeatFresh = checkedAtMs > 0 && Date.now() - checkedAtMs <= STALE_AFTER_MS;

    return res.status(200).json({
      ok: true,
      queueDepth,
      inFlightDepth,
      failedDepth,
      printedDepth,
      lastHeartbeat: status?.checkedAt || null,
      heartbeatFresh,
      printerOnline: Boolean(heartbeatFresh && status?.printerOnline),
      printer: status?.printer || null,
      lastPrintedAt: lastPrintedAt || null,
      lastFailureAt: lastFailureAt || null,
    });
  } catch (error) {
    console.error("receipt admin failed", { message: error?.message });
    return res.status(500).json({ ok: false, error: "Admin status unavailable." });
  }
}
