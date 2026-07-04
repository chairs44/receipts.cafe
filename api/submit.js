import { createHash, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

const QUEUE_KEY = "receipt-drop:queue";
const LOG_KEY = "receipt-drop:log";

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

function settingInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.headers["x-real-ip"] || "unknown";
}

function sanitizeMessage(value, maxChars) {
  const message = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!message) return { error: "Message is empty." };
  if (message.length > maxChars) return { error: `Message must be ${maxChars} characters or fewer.` };
  if (/https?:\/\/|www\./i.test(message)) return { error: "Links are not allowed." };
  return { message };
}

async function incrementWithExpiry(key, seconds) {
  const redisClient = getRedis();
  const count = await redisClient.incr(key);
  if (count === 1) await redisClient.expire(key, seconds);
  return count;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  try {
    if (process.env.PRINT_ENABLED === "false") {
      return res.status(503).json({ ok: false, error: "Printer submissions are paused." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (body.website) return res.status(200).json({ ok: true });

    const maxChars = settingInt("MESSAGE_MAX_CHARS", 240);
    const rateMax = settingInt("RATE_LIMIT_MAX", 2);
    const rateWindow = settingInt("RATE_LIMIT_WINDOW_SECONDS", 3600);
    const dailyLimit = settingInt("DAILY_LIMIT", 30);
    const sanitized = sanitizeMessage(body.message, maxChars);
    if (sanitized.error) return res.status(400).json({ ok: false, error: sanitized.error });

    const redisClient = getRedis();
    const ipHash = createHash("sha256").update(String(clientIp(req))).digest("hex").slice(0, 20);
    const rateKey = `receipt-drop:rate:${ipHash}`;
    const day = new Date().toISOString().slice(0, 10);
    const dailyKey = `receipt-drop:daily:${day}`;
    const duplicateHash = createHash("sha256").update(sanitized.message.toLowerCase()).digest("hex");
    const duplicateKey = `receipt-drop:dupe:${duplicateHash}`;

    const rateCount = await incrementWithExpiry(rateKey, rateWindow);
    if (rateCount > rateMax) {
      return res.status(429).json({ ok: false, error: "Slow down. Try again later." });
    }

    const dailyCount = await incrementWithExpiry(dailyKey, 36 * 60 * 60);
    if (dailyCount > dailyLimit) {
      return res.status(429).json({ ok: false, error: "The printer has had enough for today." });
    }

    const isDuplicate = await redisClient.set(duplicateKey, "1", { nx: true, ex: 6 * 60 * 60 });
    if (!isDuplicate) {
      return res.status(409).json({ ok: false, error: "That message was already sent recently." });
    }

    const item = {
      id: randomUUID(),
      message: sanitized.message,
      createdAt: new Date().toISOString(),
      ipHash,
    };

    await redisClient.rpush(QUEUE_KEY, JSON.stringify(item));
    await redisClient.lpush(LOG_KEY, JSON.stringify(item));
    await redisClient.ltrim(LOG_KEY, 0, 199);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("receipt submit failed", {
      message: error?.message,
      hasIntegrationUrl: Boolean(process.env.UPSTASH_REDIS_REST_KV_REST_API_URL),
      hasIntegrationToken: Boolean(process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN),
      hasAliasUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
      hasAliasToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    });
    return res.status(500).json({ ok: false, error: "Submission service is unavailable." });
  }
}
