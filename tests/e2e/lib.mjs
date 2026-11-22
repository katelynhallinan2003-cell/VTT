import { chromium } from 'playwright-core';

/** Where Chrome is: set CHROME_PATH to say, otherwise the usual place for this kind of computer. */
const CHROME = process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');

export async function launch() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  return { browser, context };
}

export function watch(page, name, errors) {
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') errors.push(`[${name}] console.${t}: ${m.text()}`);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
