import { defineConfig } from '@playwright/test';
const port=Number(process.env.CAMERA_LAB_PORT||4173);
export default defineConfig({
  testDir:'./tests/browser', timeout:90000, workers:1,
  use:{baseURL:`http://localhost:${port}`,permissions:['camera'],viewport:{width:390,height:844},launchOptions:{channel:process.env.CAMERA_LAB_BROWSER || 'chrome',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']}},
  webServer:{command:`npm run preview -- --port ${port} --strictPort`,url:`http://localhost:${port}`,reuseExistingServer:false},
  reporter:'list'
});
