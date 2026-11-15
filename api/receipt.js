import { createHash } from "node:crypto";
import { getRedis } from "./submit.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).end();
  const { token, trackingKey, state, png } = req.body || {};
  if (trackingKey !== undefined) {
    if (!process.env.POLL_TOKEN || req.headers.authorization !== "Bearer " + process.env.POLL_TOKEN) return res.status(401).end();
    if (!/^[a-f0-9]{64}$/.test(trackingKey) || !["printed", "failed"].includes(state)) return res.status(400).end();
    if (state === "printed" && (typeof png !== "string" || !png.startsWith("iVBORw0KGgo") || png.length > 1000000)) return res.status(400).end();
    await getRedis().set("receipt-drop:view:" + trackingKey, { state, ...(state === "printed" ? {png} : {}) }, {xx:true, ex:86400});
    return res.json({ok:true});
  }
  if (typeof token !== "string" || !/^[a-f0-9-]{36}$/.test(token)) return res.status(404).end();
  const key = createHash("sha256").update(token).digest("hex");
  const result = await getRedis().get("receipt-drop:view:" + key);
  if (!result) return res.status(404).end();
  return res.json(result);
}
