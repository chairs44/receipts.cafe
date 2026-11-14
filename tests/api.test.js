import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler, {sameOrigin} from '../api/image-submit.js';
function response(){return {code:0,body:null,setHeader(){},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};}
test('API cannot enable uploads in production even with preview flag',async()=>{
 const old={...process.env};try{
 process.env.RECEIPT_IMAGE_PREVIEW='true';process.env.VERCEL_ENV='production';
 const res=response();await handler({method:'POST',headers:{}},res);assert.equal(res.code,404);
 }finally{process.env=old;}
});
test('same origin rejects missing, spoofed and foreign origins',()=>{
 assert.equal(sameOrigin({headers:{host:'preview.example',origin:'https://preview.example'}}),true);
 for(const origin of [undefined,'https://evil.example','https://preview.example.evil.test','null'])assert.equal(sameOrigin({headers:{host:'preview.example',origin}}),false);
});
test('preview config reports disconnected storage and POST fails closed',async()=>{
 const old={...process.env};try{
 process.env.RECEIPT_IMAGE_PREVIEW='true';process.env.VERCEL_ENV='preview';delete process.env.PREVIEW_REDIS_URL;delete process.env.BLOB_READ_WRITE_TOKEN;
 let res=response();await handler({method:'GET',headers:{}},res);assert.equal(res.body.configured,false);assert.equal(res.body.printing,false);
 res=response();await handler({method:'POST',headers:{host:'preview.example',origin:'https://preview.example','content-type':'application/json'},body:{kind:'text',message:'test'}},res);assert.equal(res.code,503);
 }finally{process.env=old;}
});

test('production rejects malformed image crops and mixed submissions before queue access', async()=>{
  const {default:submit}=await import('../api/submit.js');
  for(const body of [{kind:'image',raster:'bad'}, {kind:'image',message:'mixed',raster:Buffer.alloc(32768).toString('base64')}]) {
    let code;
    await submit({method:'POST',headers:{host:'receipts.cafe',origin:'https://receipts.cafe','content-type':'application/json'},body},
      {status(n){code=n;return this},json(){}});
    assert.equal(code,400);
  }
});
