import { expect, test } from '@playwright/test';

test('production form submits text to the printer route and omits the editor', async ({ page }) => {
  const paths = [];
  page.on('request', request => paths.push(new URL(request.url()).pathname));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Image', exact: true })).toHaveCount(0);
  await expect(page.locator('#printer-state-label')).toHaveText('Printer Online');
  await page.locator('#message').fill(' Local routing test ');
  const submitted = page.waitForRequest(request => request.method() === 'POST');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const request = await submitted;
  expect(new URL(request.url()).pathname).toBe('/api/submit');
  expect(request.postDataJSON()).toEqual({ message: 'Local routing test', website: '' });
  await expect(page.locator('#message')).toHaveValue('');
  await expect(page.locator("#receipt-results")).toContainText("Message queued.");
  expect(paths).not.toContain('/api/image-submit');
  expect((await page.request.get('/image-editor.js')).status()).toBe(404);
});

test('mobile image flow cancels and submits exactly the repositioned proof', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  const image = await (await import('sharp')).default({
    create:{width:600,height:450,channels:3,background:'white'}
  }).composite([{input:Buffer.from('<svg width="600" height="450"><circle cx="200" cy="200" r="120"/></svg>')}]).png().toBuffer();
  async function select() {
    await page.getByRole('button',{name:'Upload Image'}).click();
    await page.locator('#pick-file').setInputFiles({name:'test.png',mimeType:'image/png',buffer:image});
    await expect(page.locator('#image-send')).toBeEnabled();
  }
  await select();
  await page.locator('#discard').click();
  await expect(page.locator('#message')).toBeVisible();
  await select();
  const proof = page.locator('#proof');
  const before = await proof.evaluate(c=>c.toDataURL());
  const bounds = await proof.boundingBox();
  const x=bounds.x+bounds.width/2, y=bounds.y+bounds.height/2;
  await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+30,y-20); await page.mouse.up();
  await expect.poll(()=>proof.evaluate(c=>c.toDataURL())).not.toBe(before);
  const expected = await proof.evaluate(c=>{
    const rgba=c.getContext('2d').getImageData(0,0,512,512).data;
    const bytes=new Uint8Array(32768);
    for(let i=0;i<512*512;i++) bytes[i>>3]|=(rgba[i*4]===255?128:0)>>(i%8);
    return btoa(String.fromCharCode(...bytes));
  });
  const request = page.waitForRequest(r=>r.method()==='POST');
  await page.locator('#image-send').click();
  expect((await request).postDataJSON()).toEqual({kind:'image',raster:expected});
  await expect(page.locator('#receipt-results')).toContainText('Image queued.');
});

test('confirmed job exposes the worker PNG for viewing and download', async ({page}) => {
  await page.route('**/api/submit', r => r.fulfill({json:{ok:true,token:'private-token'}}));
  await page.route('**/api/receipt', r => {
    expect(r.request().postDataJSON()).toEqual({token:'private-token'});
    return r.fulfill({json:{state:'printed',png:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6l90AAAAASUVORK5CYII='}});
  });
  await page.goto('/');
  await page.locator('#message').fill('local confirmation');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('#receipt-results')).toContainText('Message printed.');
  await page.getByText('View receipt').click();
  await expect(page.getByRole('link',{name:'Download receipt PNG'})).toHaveAttribute('href', /^data:image\/png;base64,/);
});
