import { Redis } from "@upstash/redis";

const QUEUE_KEY = "receipt-drop:queue";
const INFLIGHT_KEY = "receipt-drop:inflight";
const FAILED_LOG_KEY = "receipt-drop:failed";
const LAST_FAILURE_KEY = "receipt-drop:last-failure";

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
    const item = body.item;
    if (!item?.id) {
      return res.status(400).json({ ok: false, error: "Missing item." });
    }

    const reason = String(body.reason || "print failed").slice(0, 240);
    const failedAt = new Date().toISOString();
    const serialized = typeof body.rawItem === "string" ? body.rawItem : JSON.stringify(item);
    const redisClient = getRedis();
    const removed = await redisClient.lrem(INFLIGHT_KEY, 1, serialized);
    const requeued = body.requeue !== false;

    if (requeued) {
      await redisClient.lpush(QUEUE_KEY, serialized);
    }

    await redisClient.lpush(FAILED_LOG_KEY, JSON.stringify({ ...item, failedAt, reason, requeued }));
    await redisClient.ltrim(FAILED_LOG_KEY, 0, 199);
    await redisClient.set(LAST_FAILURE_KEY, failedAt, { ex: 7 * 24 * 60 * 60 });

    return res.status(200).json({ ok: true, removed, requeued });
  } catch (error) {
    console.error("receipt fail failed", { message: error?.message });
    return res.status(500).json({ ok: false, error: "Failure handling failed." });
  }
}
