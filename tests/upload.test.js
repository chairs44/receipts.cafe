import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { normalizeImage, persistSubmission, previewEnabled, PREFIX } from '../lib/image-upload.js';

test('preview guard fails closed outside explicit preview',()=>{
 assert.equal(previewEnabled({}),false);
 assert.equal(previewEnabled({RECEIPT_IMAGE_PREVIEW:'true',VERCEL_ENV:'production'}),false);
 assert.equal(previewEnabled({RECEIPT_IMAGE_PREVIEW:'true',VERCEL_ENV:'preview'}),true);
 assert.equal(PREFIX.startsWith('receipt-drop:'),false);
});
test('invalid uploads and excessive receipt lengths are refused',async()=>{
 await assert.rejects(normalizeImage('not base64'),/PNG/);
 const image=await sharp({create:{width:512,height:1025,channels:3,background:'white'}}).png().toBuffer();
 await assert.rejects(normalizeImage(image.toString('base64')),/dimensions/);
 const fake=Buffer.from('<svg/>').toString('base64'); await assert.rejects(normalizeImage(fake),/PNG/);
});
test('normalization strips metadata and emits compact binary PNG',async()=>{
 const image=await sharp({create:{width:512,height:256,channels:4,background:'white'}}).png().toBuffer();
 const out=await normalizeImage(image.toString('base64'));
 assert.equal(out.width,512);assert.equal(out.height,256); assert.ok(out.buffer.length<1000);
 const {data}=await sharp(out.buffer).raw().toBuffer({resolveWithObject:true});assert.ok(data.every(v=>v===255));
});
test('Blob failure never registers a queued item',async()=>{
 let registered=false;
 await assert.rejects(persistSubmission({id:'test',kind:'image'},Buffer.from('png'),{put:async()=>{throw Error('blob failed');},register:async()=>{registered=true;},del:async()=>{}}));
 assert.equal(registered,false);
});
test('registration failure retains private Blob for recovery rather than deleting possibly committed data',async()=>{
 let deleted=false;
 await assert.rejects(persistSubmission({id:'test',kind:'image'},Buffer.from('png'),{put:async()=>({url:'https://private.example/test.png',pathname:'test.png'}),register:async()=>{throw Error('redis timeout');},del:async()=>{deleted=true;}}));
 assert.equal(deleted,false);
});
test('successful persistence queues only metadata and keeps private image reference',async()=>{
 let registered;let options;
 const item=await persistSubmission({id:'test',kind:'image'},Buffer.from('png'),{put:async(path,data,opts)=>{options=opts;return {url:'https://private.example/test.png',pathname:path};},register:async i=>{registered=i;}});
 assert.equal(options.access,'private');assert.equal(registered.blobPathname,`${PREFIX}/test.png`);assert.equal(item.archiveStatus,'pending');assert.equal(item.printStatus,'queued');assert.equal('image' in item,false);
});
