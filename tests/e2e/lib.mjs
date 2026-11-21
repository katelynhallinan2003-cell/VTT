import { chromium } from 'playwright-core';

export async function launch() {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
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
