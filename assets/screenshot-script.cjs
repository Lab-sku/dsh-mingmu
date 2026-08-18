const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assetsDir = 'C:/Users/Labma/Documents/Codex/2026-08-16/ban/work/dsh-vision-bridge/assets';
fs.mkdirSync(assetsDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  
  await page.goto('http://127.0.0.1:3080');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(assetsDir, 'dsh-home.png'), fullPage: false });
  console.log('1. home saved');
  
  // Click settings gear at bottom left
  const settingsSelectors = [
    '[data-testid=\"settings-button\"]',
    'button[title=\"设置\"]',
    'button[aria-label=\"设置\"]',
    '[class*=\"settings\"]',
    'nav button:last-child'
  ];
  let clicked = false;
  for (const sel of settingsSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        await el.click();
        clicked = true;
        break;
      }
    } catch (e) {}
  }
  if (!clicked) {
    // try clicking the gear icon by position (bottom left)
    await page.click('svg');
  }
  
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(assetsDir, 'dsh-settings.png'), fullPage: false });
  console.log('2. settings saved');
  
  // Try to find vision-bridge settings
  const visionSelectors = ['text=明眸', 'text=VisionBridge', 'text=vision-bridge', 'text=视觉桥'];
  let visionClicked = false;
  for (const sel of visionSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        await el.click();
        visionClicked = true;
        break;
      }
    } catch (e) {}
  }
  
  if (visionClicked) {
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(assetsDir, 'dsh-vision-settings.png'), fullPage: false });
    console.log('3. vision settings saved');
  } else {
    console.log('3. vision settings link not found');
  }
  
  await browser.close();
})().catch(e => console.error('Error:', e.message));
