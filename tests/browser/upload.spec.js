import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test('crop, dither, download and save an image without touching live routes',async({page})=>{
 const errors=[];const requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
 await page.goto('/');
 await page.getByRole('button',{name:'Image',exact:true}).click();
 await expect(page.getByRole('button',{name:'Save test image'})).toBeDisabled();
 const width=800,height=600,raw=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let i=(y*width+x)*3;raw[i]=x%256;raw[i+1]=y%256;raw[i+2]=128;}
 const image=await sharp(raw,{raw:{width,height,channels:3}}).png().toBuffer();
 await page.locator('#image-file').setInputFiles({name:'synthetic-test.png',mimeType:'image/png',buffer:image});
 await expect(page.locator('#image-info')).toContainText('512 × 512');
 await expect(page.getByRole('button',{name:'Save test image'})).toBeEnabled();
 await page.locator('#crop-ratio').selectOption('0.5');
 await expect(page.locator('#image-info')).toContainText('512 × 1024');
 await page.locator('#image-zoom').fill('1.6');await page.locator('#image-brightness').fill('25');
 await expect(page.getByRole('button',{name:'Save test image'})).toBeEnabled();
 const dims=await page.locator('#image-preview').evaluate(c=>({width:c.width,height:c.height,colors:[...new Set(c.getContext('2d').getImageData(0,0,c.width,c.height).data)]}));
 expect(dims.width).toBe(512);expect(dims.height).toBe(1024);expect(dims.colors.sort()).toEqual([0,255]);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save PNG',exact:true}).click();expect((await download).suggestedFilename()).toBe('receipt-preview.png');
 await page.getByRole('button',{name:'Save test image'}).click();
 await expect(page.locator('#status')).toContainText('Nothing uploaded or printed');
 expect(requests.every(p=>p==='/api/image-submit')).toBe(true);expect(errors).toEqual([]);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/receipts-upload-mobile.png',fullPage:true});
});
test('invalid files cannot be submitted',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Image',exact:true}).click();
 await page.locator('#image-file').setInputFiles({name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('not an image')});
 await expect(page.locator('#image-error')).toContainText('Choose a JPEG');
 await expect(page.getByRole('button',{name:'Save test image'})).toBeDisabled();
});
test('text is routed to isolated demo and network failure leaves image available',async({page})=>{
 await page.goto('/');await page.locator('#message').fill('Synthetic test receipt');
 await page.getByRole('button',{name:'Save test message'}).click();await expect(page.locator('#status')).toContainText('Nothing uploaded or printed');
 await page.route('**/api/image-submit',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Preview storage is not configured.'})}));
 await page.locator('#message').fill('Retain this on failure');await page.getByRole('button',{name:'Save test message'}).click();
 await expect(page.locator('#status')).toContainText('not configured');await expect(page.locator('#message')).toHaveValue('Retain this on failure');
});
