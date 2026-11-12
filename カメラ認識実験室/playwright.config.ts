import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser', timeout:90000, workers:1,
  use:{baseURL:'http://localhost:4173',permissions:['camera'],viewport:{width:390,height:844},launchOptions:{channel:process.env.CAMERA_LAB_BROWSER || 'chrome',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']}},
  webServer:{command:'npm run preview -- --port 4173 --strictPort',url:'http://localhost:4173',reuseExistingServer:false},
  reporter:'list'
});
