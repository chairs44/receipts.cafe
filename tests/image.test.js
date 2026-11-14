import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { monochrome, encodePNG } from '../preview/image-processing.js';

test('white transparency is preserved and output is binary', () => {
 const data = new Uint8ClampedArray([0,0,0,0, 0,0,0,255, 255,255,255,255]);
 assert.deepEqual([...monochrome(data,3,1,0)], [255,0,255]);
});
test('PNG is packed 1-bit grayscale with valid dimensions and pixel rows', async () => {
 const png = Buffer.from(await encodePNG(new Uint8Array([0,255,0,255,0,255,0,255]),8,1));
 assert.equal(png.readUInt32BE(16),8); assert.equal(png.readUInt32BE(20),1);
 assert.equal(png[24],1); assert.equal(png[25],0);
 let offset=8; let idat=[];
 while(offset<png.length){const n=png.readUInt32BE(offset); if(png.toString('ascii',offset+4,offset+8)==='IDAT')idat.push(png.subarray(offset+8,offset+8+n));offset+=12+n;}
 assert.deepEqual([...inflateSync(Buffer.concat(idat))],[0,85]);
});
