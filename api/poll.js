import { Redis } from "@upstash/redis";
import { randomUUID } from "node:crypto";

const QUEUE_KEY = "receipt-drop:queue";
const INFLIGHT_KEY = "receipt-drop:inflight";
const RECOVERED_LOG_KEY = "receipt-drop:recovered";
const DEFAULT_INFLIGHT_STALE_SECONDS = 10 * 60;
const MAX_RECOVER_PER_POLL = 5;

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

function settingInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseItem(raw) {
  if (!raw) return null;
  if (typeof raw === "string") return JSON.parse(raw);
  return raw;
}

function serializeItem(item) {
  return typeof item === "string" ? item : JSON.stringify(item);
}

function claimItem(item) {
  return {
    ...item,
    claimId: randomUUID(),
    claimedAt: new Date().toISOString(),
    attempts: Number(item.attempts || 0) + 1,
  };
}

function claimTimeMs(item) {
  const claimedAt = item?.claimedAt || item?.claim?.claimedAt;
  if (claimedAt) return Date.parse(claimedAt) || 0;
  return Date.parse(item?.createdAt || "") || 0;
}

async function recoverStaleInflight(redisClient) {
  const staleMs = settingInt("INFLIGHT_STALE_SECONDS", DEFAULT_INFLIGHT_STALE_SECONDS) * 1000;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const rawItems = await redisClient.lrange(INFLIGHT_KEY, 0, 49);
  let recovered = 0;

  for (const raw of rawItems || []) {
    if (recovered >= MAX_RECOVER_PER_POLL) break;

    let item;
    try {
      item = parseItem(raw);
    } catch {
      continue;
    }

    const claimedAtMs = claimTimeMs(item);
    if (!claimedAtMs || now - claimedAtMs < staleMs) continue;

    const serialized = serializeItem(raw);
    const removed = await redisClient.lrem(INFLIGHT_KEY, 1, serialized);
    if (!removed) continue;

    const recoveredItem = {
      ...item,
      recoveredAt: nowIso,
      recoveries: Number(item.recoveries || 0) + 1,
    };
    delete recoveredItem.claimId;
    delete recoveredItem.claimedAt;

    const recoveredRaw = JSON.stringify(recoveredItem);
    await redisClient.lpush(QUEUE_KEY, recoveredRaw);
    await redisClient.lpush(
      RECOVERED_LOG_KEY,
      JSON.stringify({
        ...recoveredItem,
        staleClaimedAt: item.claimedAt || item?.claim?.claimedAt || null,
      })
    );
    recovered += 1;
  }

  if (recovered) {
    await redisClient.ltrim(RECOVERED_LOG_KEY, 0, 199);
  }

  return recovered;
}

async function claimNext(redisClient) {
  const rawItem = await redisClient.lmove(QUEUE_KEY, INFLIGHT_KEY, "LEFT", "RIGHT");
  if (!rawItem) return { item: null, rawItem: null };

  const item = parseItem(rawItem);
  const claimedItem = claimItem(item);
  const claimedRaw = JSON.stringify(claimedItem);
  const removed = await redisClient.lrem(INFLIGHT_KEY, 1, serializeItem(rawItem));
  if (!removed) {
    throw new Error("Claim replacement failed.");
  }

  await redisClient.rpush(INFLIGHT_KEY, claimedRaw);
  return { item: claimedItem, rawItem: claimedRaw };
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
    const redisClient = getRedis();
    const recovered = await recoverStaleInflight(redisClient);
    const { item, rawItem } = await claimNext(redisClient);
    return res.status(200).json({
      ok: true,
      item,
      rawItem,
      recovered,
    });
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
