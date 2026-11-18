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

test('confirmed receipt appears automatically above the X link on a short mobile screen', async ({page}) => {
  await page.setViewportSize({width:320,height:568});
  await page.emulateMedia({reducedMotion:'reduce'});
  const sharp = (await import('sharp')).default;
  const receipt = await sharp({create:{width:512,height:655,channels:3,background:'white'}}).png().toBuffer();
  let confirmPrint;
  const confirmation = new Promise(resolve => { confirmPrint = resolve; });
  await page.route('**/api/submit', r => r.fulfill({json:{ok:true,token:'private-token'}}));
  await page.route('**/api/receipt', async r => {
    expect(r.request().postDataJSON()).toEqual({token:'private-token'});
    await confirmation;
    return r.fulfill({json:{state:'printed',png:receipt.toString('base64')}});
  });
  await page.goto('/');
  await page.locator('#message').fill('local confirmation');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  const image = page.getByRole('img', {name:'Printed message receipt'});
  try {
    await expect(page.locator('#receipt-results')).toContainText('Message queued.');
    await expect(image).toHaveCount(0);
  } finally {
    confirmPrint();
  }
  await expect(page.locator('#receipt-results')).toContainText('Message printed.');
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.getByText('View receipt')).toHaveCount(0);
  await expect(page.locator('#receipt-results [download]')).toHaveCount(0);

  const link = page.getByRole('link', {name:'chairs44 on X'});
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeInViewport({ratio:1});
  const preview = await page.locator('.receipt-preview').boundingBox();
  const footer = await link.boundingBox();
  expect(footer.y).toBeGreaterThanOrEqual(preview.y + preview.height);
});
