import { Redis } from "@upstash/redis";

const QUEUE_KEY = "receipt-drop:queue";
const INFLIGHT_KEY = "receipt-drop:inflight";
const FAILED_LOG_KEY = "receipt-drop:failed";
const PRINTED_LOG_KEY = "receipt-drop:printed";
const RECOVERED_LOG_KEY = "receipt-drop:recovered";
const STATUS_KEY = "receipt-drop:status";
const LAST_PRINTED_KEY = "receipt-drop:last-printed";
const LAST_FAILURE_KEY = "receipt-drop:last-failure";
const STALE_AFTER_MS = 45 * 1000;
const DEFAULT_INFLIGHT_STALE_SECONDS = 10 * 60;

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

function claimTimeMs(item) {
  const claimedAt = item?.claimedAt || item?.claim?.claimedAt;
  if (claimedAt) return Date.parse(claimedAt) || 0;
  return Date.parse(item?.createdAt || "") || 0;
}

function inspectInflight(rawItems) {
  const staleMs = settingInt("INFLIGHT_STALE_SECONDS", DEFAULT_INFLIGHT_STALE_SECONDS) * 1000;
  const now = Date.now();
  let staleInFlightDepth = 0;
  let oldestInFlightClaimedAt = null;

  for (const raw of rawItems || []) {
    let item;
    try {
      item = parseItem(raw);
    } catch {
      continue;
    }

    const claimedAtMs = claimTimeMs(item);
    if (!claimedAtMs) continue;
    if (!oldestInFlightClaimedAt || claimedAtMs < Date.parse(oldestInFlightClaimedAt)) {
      oldestInFlightClaimedAt = new Date(claimedAtMs).toISOString();
    }
    if (now - claimedAtMs >= staleMs) {
      staleInFlightDepth += 1;
    }
  }

  return {
    staleAfterSeconds: staleMs / 1000,
    staleInFlightDepth,
    oldestInFlightClaimedAt,
  };
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
      recoveredDepth,
      rawInFlightItems,
      statusValue,
      lastPrintedAt,
      lastFailureAt,
    ] = await Promise.all([
      redisClient.llen(QUEUE_KEY),
      redisClient.llen(INFLIGHT_KEY),
      redisClient.llen(FAILED_LOG_KEY),
      redisClient.llen(PRINTED_LOG_KEY),
      redisClient.llen(RECOVERED_LOG_KEY),
      redisClient.lrange(INFLIGHT_KEY, 0, 49),
      redisClient.get(STATUS_KEY),
      redisClient.get(LAST_PRINTED_KEY),
      redisClient.get(LAST_FAILURE_KEY),
    ]);

    const status = typeof statusValue === "string" ? JSON.parse(statusValue) : statusValue;
    const checkedAtMs = status?.checkedAt ? Date.parse(status.checkedAt) : 0;
    const heartbeatFresh = checkedAtMs > 0 && Date.now() - checkedAtMs <= STALE_AFTER_MS;
    const inFlight = inspectInflight(rawInFlightItems);

    return res.status(200).json({
      ok: true,
      queueDepth,
      inFlightDepth,
      staleInFlightDepth: inFlight.staleInFlightDepth,
      staleAfterSeconds: inFlight.staleAfterSeconds,
      oldestInFlightClaimedAt: inFlight.oldestInFlightClaimedAt,
      failedDepth,
      printedDepth,
      recoveredDepth,
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
