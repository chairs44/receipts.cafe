import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const productionForm = process.env.LOCAL_PRODUCTION_FORM === 'true';
const previewDir = path.join(root, 'preview');
const port = Number(process.env.PORT || 3000);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    let body;
    if (!productionForm) {
      try {
        body = await readFile(path.join(previewDir, safePath));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    body ??= await readFile(filePath);
    res.writeHead(200, {
      "content-type": types[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const demoRecords = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/image-submit') {
    if (productionForm) { json(res, 404, {ok:false}); return; }
    if(req.method === 'GET') { json(res,200,{ok:true,local:true,preview:true,printing:false,configured:true});return; }
    if(req.method !== 'POST') { json(res,405,{ok:false,error:'Method not allowed.'});return; }
    if(req.headers.origin !== `http://${req.headers.host}`) { json(res,403,{ok:false,error:'Use the preview form.'});return; }
    let raw='';
    try {
      for await(const chunk of req) {raw+=chunk;if(raw.length>210000){json(res,413,{ok:false,error:'Image is too large.'});return;}}
      const body=JSON.parse(raw);
      if(!['text','image'].includes(body.kind))throw Error('Choose text or image.');
      if(body.kind==='image') { const {normalizeImage}=await import('../lib/image-upload.js');await normalizeImage(body.image); }
      else if(typeof body.message!=='string'||!body.message.trim()||body.message.length>300)throw Error('Enter 1–300 characters.');
      const id=crypto.randomUUID();
      demoRecords.push({id,kind:body.kind});if(demoRecords.length>100)demoRecords.shift();
      json(res,200,{ok:true,id,local:true,preview:true,printing:false});
    } catch(error) {json(res,400,{ok:false,error:error.message});}
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    json(res, 200, {
      ok: true,
      printerOnline: true,
      preview: true,
      message: "v0 preview mode: printer status is stubbed.",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin") {
    json(res, 200, {
      ok: true,
      queueDepth: 0,
      inFlightDepth: 0,
      failedDepth: 0,
      printedDepth: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatFresh: true,
      printerOnline: true,
      printer: "EPSON_TM_T88V",
      lastPrintedAt: null,
      lastFailureAt: null,
      preview: true,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/submit") {
    req.resume();
    json(res, 200, {
      ok: true,
      queued: true,
      preview: true,
      message: "v0 preview mode: message was not sent to the printer.",
    });
    return;
  }

  if (req.method === "POST" && ["/api/poll", "/api/ack", "/api/fail", "/api/heartbeat"].includes(url.pathname)) {
    req.resume();
    json(res, 200, {
      ok: true,
      item: null,
      preview: true,
      message: "v0 preview mode: worker route is stubbed.",
    });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    json(res, 404, { error: "Preview API route not implemented." });
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`receipt.cafe preview running at http://localhost:${port}`);
});
