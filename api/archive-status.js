import { Redis } from "@upstash/redis";

const PRINTED_LOG_KEY = "receipt-drop:printed";

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
    const totalMessages = await getRedis().llen(PRINTED_LOG_KEY);

    return res.status(200).json({
      ok: true,
      totalMessages,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("archive status failed", { message: error?.message });
    return res.status(503).json({ ok: false, error: "Archive status unavailable." });
  }
}
