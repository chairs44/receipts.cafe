import { createHash, randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { put } from '@vercel/blob';
import { MAX_UPLOAD_BYTES, PREFIX, normalizeImage, persistSubmission, previewEnabled } from '../lib/image-upload.js';
let client;
function redis(){
 if(!client)client=new Redis({url:process.env.PREVIEW_REDIS_URL,token:process.env.PREVIEW_REDIS_TOKEN});
 return client;
}
const LIMIT_SCRIPT=`
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
if count > 10 then return 0 end
local daily = redis.call('INCR', KEYS[2])
if daily == 1 then redis.call('EXPIRE', KEYS[2], 90000) end
if daily > 100 then return 0 end
return 1`;
const REGISTER_SCRIPT=`
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('LPUSH', KEYS[2], ARGV[2])
redis.call('LPUSH', KEYS[3], ARGV[2])
return 1`;
export function sameOrigin(req){
 const origin=req.headers.origin,host=req.headers.host;
 if(typeof origin!=='string'||typeof host!=='string')return false;
 try {const u=new URL(origin);return u.host===host&&['https:','http:'].includes(u.protocol)&&u.origin===origin;}catch{return false;}
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!previewEnabled())return res.status(404).json({ok:false,error:'Image upload is available only in the isolated preview.'});
 if(req.method==='GET')return res.status(200).json({ok:true,preview:true,printing:false,configured:Boolean(process.env.PREVIEW_REDIS_URL&&process.env.PREVIEW_REDIS_TOKEN&&process.env.BLOB_READ_WRITE_TOKEN)});
 if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'Method not allowed.'});}
 if(!sameOrigin(req)||!String(req.headers['content-type']||'').startsWith('application/json'))return res.status(403).json({ok:false,error:'Use the form on this preview to submit.'});
 if(Number(req.headers['content-length']||0)>210000)return res.status(413).json({ok:false,error:'Image is too large.'});
 if(!process.env.PREVIEW_REDIS_URL||!process.env.PREVIEW_REDIS_TOKEN||!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({ok:false,error:'Preview storage is not configured.'});
 let body;
 try{body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};}catch{return res.status(400).json({ok:false,error:'Invalid submission.'});}
 if(body.website)return res.status(200).json({ok:true,preview:true});
 if(body.kind!=='image'&&body.kind!=='text')return res.status(400).json({ok:false,error:'Choose text or image.'});
 let normalized;
 const message=typeof body.message==='string'?body.message.replace(/[\u0000-\u001f\u007f]/g,' ').trim():'';
 if(body.kind==='text'&&(!message||message.length>300||/https?:\/\/|www\./i.test(message)))return res.status(400).json({ok:false,error:'Enter 1–300 characters without links.'});
 try{if(body.kind==='image')normalized=await normalizeImage(body.image);}catch(error){return res.status(400).json({ok:false,error:error.message});}
 const id=randomUUID();
 try{
   const r=redis();
   const ip=String(req.headers['x-forwarded-for']||req.headers['x-real-ip']||'unknown').split(',')[0].trim();
   const ipHash=createHash('sha256').update(`${process.env.PREVIEW_REDIS_TOKEN}:${ip}`).digest('hex').slice(0,20);
   const day=new Date().toISOString().slice(0,10);
   const allowed=await r.eval(LIMIT_SCRIPT,[`${PREFIX}:rate:${ipHash}`,`${PREFIX}:daily:${day}`],[]);
   if(!allowed)return res.status(429).json({ok:false,error:'Preview limit reached. Try again later (10 submissions per hour, 100 per day overall).'});
   const item={id,kind:body.kind,createdAt:new Date().toISOString(),...(normalized?{width:normalized.width,height:normalized.height}:{message})};
   const record=await persistSubmission(item,normalized?.buffer,{put,register:record=>r.eval(REGISTER_SCRIPT,[`${PREFIX}:item:${id}`,`${PREFIX}:queue`,`${PREFIX}:submissions`],[JSON.stringify(record),id])});
   return res.status(200).json({ok:true,preview:true,printing:false,id,bytes:record.bytes});
 }catch{
   console.error('Preview persistence failed',{id});
   return res.status(503).json({ok:false,error:'Could not confirm storage. Please keep your image and try again later.'});
 }
}
