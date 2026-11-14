import { defineConfig } from '@playwright/test';

const previewURL = 'http://127.0.0.1:3000';
const productionFormURL = 'http://127.0.0.1:3011';

export default defineConfig({
  testDir: './tests/browser',
  projects: [
    { name: 'preview', testMatch: 'upload.spec.js', use: { baseURL: process.env.TEST_URL || previewURL } },
    { name: 'production-form', testMatch: 'production.spec.js', use: { baseURL: productionFormURL } },
  ],
  webServer: [
    ...(process.env.TEST_URL ? [] : [{ command: 'npm run dev', url: previewURL, env: { PORT: '3000', LOCAL_PRODUCTION_FORM: 'false' } }]),
    { command: 'npm run dev', url: productionFormURL, env: { PORT: '3011', LOCAL_PRODUCTION_FORM: 'true' } },
  ],
  reporter: 'list',
});
