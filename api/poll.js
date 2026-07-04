import { Redis } from "@upstash/redis";

const QUEUE_KEY = "receipt-drop:queue";

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
    const item = await getRedis().lpop(QUEUE_KEY);
    const parsedItem =
      typeof item === "string"
        ? JSON.parse(item)
        : item;
    return res.status(200).json({ ok: true, item: parsedItem || null });
  } catch (error) {
    console.error("receipt poll failed", {
      message: error?.message,
      hasIntegrationUrl: Boolean(process.env.UPSTASH_REDIS_REST_KV_REST_API_URL),
      hasIntegrationToken: Boolean(process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN),
      hasAliasUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
      hasAliasToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    });
    return res.status(500).json({ ok: false, error: "Queue unavailable." });
  }
}
