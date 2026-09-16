#!/usr/bin/env node
// Screenshot capture for book figures, driven through the user's own logged-in Chrome.
// Connects to the already-running browser over the DevTools protocol with playwright-core,
// so every page is captured inside the user's real session (Google, Notion, an admin console)
// without a second login and without downloading a browser.
//
// The captured PNG is meant to go straight into an image placeholder:
//   capture.mjs shot <url> out.png ...
//   puvles.mjs set-image <chapterId> --image <n> --file out.png
//
// usage:
//   capture.mjs tabs                                list the open pages in the running Chrome
//   capture.mjs shot <url> <out.png> [options]      open a new tab, capture it, close it
//   capture.mjs run <recipe.mjs> [args...]          multi-step flow (open a menu, run something, then shoot)
//
// shot options:
//   --wait <ms>           extra settle time after load (default 3000; raise for heavy web apps)
//   --selector <css>      capture only this element (the window chrome is usually noise in a book)
//   --clip <x,y,w,h>      capture this CSS-pixel rectangle (tighter book figures than a whole window)
//   --full                full scrollable page instead of the viewport
//   --viewport <WxH>      window size, default 1440x900
//   --dpr <n>             device pixel ratio, default 2 (print needs the extra pixels)
//   --click <css>         click this before shooting; repeatable, applied in order
//   --press <key>         press a key before shooting (e.g. Escape); repeatable
//   --hide <css>          hide matching elements (cookie bars, chat bubbles); repeatable
//   --keep-open           leave the tab open so the user can look at it
//   --reuse               capture the current tab matching <url> instead of opening a new one
//   --timeout <ms>        navigation timeout, default 60000
//
// recipe file (for `run`): an ES module with a default async function.
//   export default async ({ page, context, browser, shot, args, argv }) => {
//     await page.goto('https://docs.google.com/spreadsheets/u/0/create');
//     await page.getByRole('menuitem', { name: '확장 프로그램' }).click();
//     await shot(page, 'menu.png', { selector: '.menu-root' });
//   };
// `shot(page, out, opts)` takes the same options as the shot command.
//
// env: CDP_PORT (default 9222)
//
// Chrome must already be running with --remote-debugging-port=9222 and the user must
// already be signed in there. playwright-core must be installed somewhere this script
// can resolve it (the skill directory is the usual place):
//   cd ~/.claude/skills/puvles-writer && npm i playwright-core

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const PORT = process.env.CDP_PORT || 9222;
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flags = {};
const multi = { click: [], press: [], hide: [] };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const hasValue = i + 1 < argv.length && !argv[i + 1].startsWith('--');
    const value = hasValue ? argv[++i] : true;
    if (key in multi) multi[key].push(value); else flags[key] = value;
  } else positional.push(a);
}
const [cmd, ...args] = positional;

function fail(msg) { console.error(msg); process.exit(1); }

// playwright-core may live in the skill dir, the project, or a global prefix.
async function loadPlaywright() {
  const bases = [SKILL_DIR, process.cwd(), path.join(process.env.HOME || '', '.claude')];
  for (const base of bases) {
    try {
      const req = createRequire(path.join(base, 'noop.js'));
      const mod = await import(pathToFileURL(req.resolve('playwright-core')).href);
      // playwright-core is CommonJS: named exports may only appear under .default
      const pw = mod?.chromium ? mod : mod?.default;
      if (pw?.chromium) return pw;
    } catch { /* try the next base */ }
  }
  fail(`playwright-core not found. Install it once:\n  cd ${SKILL_DIR} && npm i playwright-core`);
}

async function connect() {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => {
    fail(`cannot reach Chrome on port ${PORT}. Start it with --remote-debugging-port=${PORT} (or set CDP_PORT).`);
  });
  const context = browser.contexts()[0];
  if (!context) fail('Chrome has no browser context; open a tab and retry.');
  return { browser, context };
}

// One screenshot with the shared option handling.
export async function shot(page, out, opts = {}) {
  const {
    wait = 3000, selector, clip: clipArg, full = false, viewport = '1440x900', dpr = 2,
    click = [], press = [], hide = [],
  } = opts;
  const [w, h] = String(viewport).split('x').map(Number);
  const width = w || 1440;
  const height = h || 900;
  const scale = Number(dpr) || 1;
  // Attached pages ignore Playwright's viewport/deviceScaleFactor, and page.screenshot()
  // drops the emulation override, so drive the size and the capture through CDP directly.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile: false,
  }).catch(() => {});
  if (wait) await page.waitForTimeout(Number(wait));
  for (const sel of [].concat(click)) {
    await page.locator(sel).first().click({ timeout: 15000 });
    await page.waitForTimeout(800);
  }
  for (const key of [].concat(press)) {
    await page.keyboard.press(key);
    await page.waitForTimeout(500);
  }
  for (const sel of [].concat(hide)) {
    await page.evaluate((s) => document.querySelectorAll(s).forEach(el => { el.style.visibility = 'hidden'; }), sel)
      .catch(() => {});
  }
  // clip is in CSS document coordinates; deviceScaleFactor already multiplies the pixels
  let clip;
  if (clipArg) {
    const [x, y, cw, ch] = String(clipArg).split(',').map(Number);
    if ([x, y, cw, ch].some(n => !Number.isFinite(n))) throw new Error(`--clip needs x,y,w,h (got ${clipArg})`);
    clip = { x, y, width: cw, height: ch, scale: 1 };
  } else if (selector) {
    const el = page.locator(selector).first();
    await el.scrollIntoViewIfNeeded({ timeout: 15000 });
    await page.waitForTimeout(400);
    const box = await el.boundingBox();
    if (!box) throw new Error(`selector matched nothing visible: ${selector}`);
    const off = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    clip = { x: box.x + off.x, y: box.y + off.y, width: box.width, height: box.height, scale: 1 };
  } else if (full) {
    const m = await cdp.send('Page.getLayoutMetrics');
    const size = m.cssContentSize || m.contentSize;
    clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
  } else {
    clip = { x: 0, y: 0, width, height, scale: 1 };
  }
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', clip, captureBeyondViewport: !!full || !!selector || !!clipArg,
  });
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  // leave the tab usable if the caller keeps it open
  await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  const px = { w: Math.round(clip.width * scale), h: Math.round(clip.height * scale) };
  console.log(JSON.stringify({
    saved: path.resolve(out), url: page.url(), selector: selector || null,
    pixels: `${px.w}x${px.h}`, dpr: scale,
  }, null, 2));
  return out;
}

const shotOpts = () => ({
  wait: flags.wait, selector: flags.selector, clip: flags.clip, full: flags.full,
  viewport: flags.viewport, dpr: flags.dpr,
  click: multi.click, press: multi.press, hide: multi.hide,
});

async function main() {
  if (cmd === 'tabs') {
    const { browser, context } = await connect();
    const rows = context.pages().map(p => ({ url: p.url(), title: '' }));
    for (const [i, p] of context.pages().entries()) rows[i].title = await p.title().catch(() => '');
    console.log(JSON.stringify(rows, null, 2));
    await browser.close();
    return;
  }

  if (cmd === 'shot') {
    const [url, out] = args;
    if (!url || !out) fail('usage: capture.mjs shot <url> <out.png> [options]');
    const { browser, context } = await connect();
    let page;
    let opened = false;
    if (flags.reuse) {
      page = context.pages().find(p => p.url().startsWith(url));
      if (!page) fail(`no open tab starting with ${url}; drop --reuse to open one.`);
    } else {
      page = await context.newPage();
      opened = true;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Number(flags.timeout || 60000) });
    }
    await page.bringToFront().catch(() => {});
    await shot(page, out, shotOpts());
    if (opened && !flags['keep-open']) await page.close();
    await browser.close();
    return;
  }

  if (cmd === 'run') {
    const [recipe, ...rest] = args;
    if (!recipe) fail('usage: capture.mjs run <recipe.mjs> [args...]');
    const mod = await import(pathToFileURL(path.resolve(recipe)).href);
    const fn = mod.default;
    if (typeof fn !== 'function') fail(`${recipe} must export a default async function.`);
    const { browser, context } = await connect();
    const page = await context.newPage();
    try {
      await fn({ page, context, browser, shot, args: rest, argv: flags });
    } finally {
      if (!flags['keep-open']) await page.close().catch(() => {});
      await browser.close();
    }
    return;
  }

  fail('commands: tabs | shot <url> <out.png> | run <recipe.mjs>');
}

main().catch(e => fail(e.stack || e.message));
