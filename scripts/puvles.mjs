#!/usr/bin/env node
// Puvles (puvles.lopapps.com) writing CLI, built on the WebMCP tools the Puvles
// editor registers on `document.modelContext` (Chrome native API or the official
// polyfill): get_project_context, get_book_toc, create_part, create_chapter,
// get_chapter_content, write_chapter_markdown, navigate_to_chapter,
// update_toc_structure, save_chapter, delete_chapter, delete_part,
// update_project_settings.
// It runs inside the user's logged-in Chrome tab through the DevTools protocol, so
// the app itself performs every write (with its own animations and permissions).
//
// usage:
//   puvles.mjs tab                                  find/open the Puvles tab, print its target id
//   puvles.mjs tools                                list registered WebMCP tools with schemas
//   puvles.mjs call <tool> '<json args>'            call any tool directly
//   puvles.mjs context                              get_project_context
//   puvles.mjs toc                                  get_book_toc
//   puvles.mjs create-part "<title>" ["<code>"] [--focus]
//   puvles.mjs create-chapter <partId> "<title>" ["<code>"] [--question "..."] [--summary "..."] [--no-focus]
//   puvles.mjs write-chapter <chapterId> <file.md> [--complete] [--no-focus]
//   puvles.mjs read-chapter <chapterId>             get_chapter_content
//   puvles.mjs navigate <chapterId>                 navigate_to_chapter
//   puvles.mjs save-chapter [--complete]            save_chapter (same as the editor's save button)
//   puvles.mjs images <chapterId>                   list_chapter_images (image blocks: id, imageIndex, caption, hasImage)
//   puvles.mjs set-image <chapterId> (--block <id> | --image <n> | --caption-match "..." | --at <index> | --after <blockId>)
//                                   (--url <https://...> | --file <path.png>) [--caption "..."] [--book <dir>] [--no-focus]
//                                                   set_chapter_image: fill a placeholder (or insert a new image block) with a URL or an uploaded file
//   puvles.mjs generate-image <chapterId> (--block <id> | --image <n> | --caption-match "..." | --at <index> | --after <blockId>)
//                                   [--prompt "..."] [--caption "..."] [--no-focus]
//                                                   generate_chapter_image: the editor's AI illustration (needs the Google API key saved in the editor's AI 설정)
//   puvles.mjs remove-image <chapterId> (--block <id> | --image <n> | --caption-match "...") [--delete-block] [--keep-file] [--no-focus]
//                                                   remove_chapter_image: clear the image (keeps the caption placeholder) or delete the block; irreversible
//   puvles.mjs image-prompt [--set "..."]           show / set the project's AI image style prompt (update_project_settings.aiImagePrompt)
//   puvles.mjs plan-images <chapterId> (--image <n> | --all-empty | --all) [--prompt "..."] [--style "..."] [--out <dir>] [--book <dir>]
//                                                   assemble the editor's own illustration prompt (project style prompt + caption) for each
//                                                   image block and return it with a target file path; the agent then draws each image
//                                                   itself (SVG) and inserts it with: set-image <chapterId> --image <n> --file <path> --book <dir>
//                                                   (no external image API is called; "generate-local" is kept as an alias)
// env: PUVLES_TARGET (tab id; auto-detected otherwise), CDP_PORT (default 9222),
//      PUVLES_HOME (site origin, default https://puvles.lopapps.com/ — use http://localhost:5174/ for a dev server)

import fs from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const HOME = (process.env.PUVLES_HOME || 'https://puvles.lopapps.com/').replace(/\/?$/, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { flags[key] = argv[++i]; } else { flags[key] = true; }
  } else positional.push(a);
}
const [cmd, ...args] = positional;

async function listPages() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  return (await r.json()).filter(t => t.type === 'page');
}
async function getTarget() {
  if (process.env.PUVLES_TARGET) return process.env.PUVLES_TARGET;
  const hit = (await listPages()).find(p => p.url.startsWith(HOME));
  if (hit) return hit.id;
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${HOME}`, { method: 'PUT' });
  const t = await r.json(); await sleep(4000); return t.id;
}
function cdp(targetId, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${targetId}`);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) { ws.close(); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } });
    ws.addEventListener('error', (e) => reject(new Error('CDP websocket error (is Chrome running with --remote-debugging-port?): ' + e.message)));
  });
}
async function evalInPage(expression) {
  const t = await getTarget();
  const res = await cdp(t, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (res.exceptionDetails) throw new Error('page exception: ' + (res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails)));
  return res.result.value;
}
// Call a WebMCP tool inside the page. Tool results are the app's own JSON strings.
async function callTool(name, toolArgs = {}) {
  const raw = await evalInPage(`(async()=>{
    const mc=document.modelContext||navigator.modelContext;
    if(!mc||typeof mc.executeTool!=='function'||typeof mc.getTools!=='function') throw new Error('WebMCP not available: open a Puvles project page and sign in first');
    const tools=await mc.getTools();
    const tool=tools.find(t=>t.name===${JSON.stringify(name)});
    if(!tool) throw new Error('tool not registered (open a project in the editor): '+${JSON.stringify(name)}+' ; available: '+tools.map(t=>t.name).join(','));
    // native API and the official polyfill both take the tool object, not its name
    const r=await mc.executeTool(tool, ${JSON.stringify(toolArgs)});
    return typeof r==='string'?r:JSON.stringify(r);
  })().then(v=>({ok:v})).catch(e=>({error:e.message}))`);
  if (raw.error) throw new Error(raw.error);
  try { return JSON.parse(raw.ok); } catch { return raw.ok; }
}

// The editor's own parser turns blank-line separated paragraphs inside one section into a single
// text block. Joining paragraphs with <br/><br/> keeps visible paragraph breaks in that case.
export function prepareMarkdown(src, { joinParagraphs = true } = {}) {
  let md = src.replace(/\r\n/g, '\n');
  const meta = { title: '' };
  if (md.startsWith('---')) {
    const parts = md.split('---');
    if (parts.length >= 3) {
      const fm = parts[1];
      const t = fm.match(/title:\s*(?:"([^"]*)"|'([^']*)'|(.*))/);
      if (t) { meta.title = (t[1] || t[2] || t[3] || '').trim(); }
      // keep question/summary frontmatter: the app reads them itself
      md = '---' + fm.replace(/^\s*title:.*$/m, '').replace(/\n{2,}/g, '\n') + '---' + parts.slice(2).join('---');
    }
  }
  // bold → <b>, but keep the box markers (> **조금 더 쉽게**: / > **Basic Study**:) intact
  md = md.split('\n').map(line => {
    const marker = line.match(/^(> \*\*(?:조금 더 쉽게|Basic Study|Chapter Question|Chapter Summary|Question|Summary)\*\*\s*:\s*)/);
    const head = marker ? marker[1] : '';
    return head + line.slice(head.length).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }).join('\n');
  if (!joinParagraphs) return { md, meta };
  // inside each run of plain-text lines, replace paragraph breaks with <br/><br/>
  const out = []; let buf = []; let inCode = false;
  const structural = (l) => /^(#{1,4} |> \*\*|\[이미지)/.test(l);
  const flush = () => { if (buf.length) { const paras = buf.join('\n').split(/\n{2,}/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean); out.push(paras.join('<br/><br/>')); buf = []; } };
  for (const line of md.split('\n')) {
    if (line.trim().startsWith('```')) { flush(); inCode = !inCode; out.push(line); continue; }
    if (inCode) { out.push(line); continue; }
    if (structural(line) || line.startsWith('---')) { flush(); out.push(line); continue; }
    buf.push(line);
  }
  flush();
  return { md: out.join('\n'), meta };
}

// Wait until a WebMCP tool is registered on the current page (route hooks register on mount).
async function waitForTool(name = 'get_project_context', timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const names = await evalInPage(`(async()=>{const mc=document.modelContext; if(!mc) return []; return (await mc.getTools()).map(t=>t.name);})()`).catch(() => []);
    if (names.includes(name)) return true;
    await sleep(400);
  }
  throw new Error(`tool "${name}" did not register within ${timeoutMs}ms (is the right page open and the user signed in?)`);
}
async function status() { return callTool('get_auth_status'); }
async function ensureLoggedIn() {
  const s = await status();
  if (s.loading) { await sleep(1500); return ensureLoggedIn(); }
  if (!s.loggedIn) throw new Error('not signed in: ask the user to log in on the Puvles main page, then retry');
  return s;
}
async function goDashboard() {
  await ensureLoggedIn();
  await callTool('navigate_to', { target: 'dashboard' });
  await waitForTool('list_projects');
  return status();
}
async function openProject(projectId) {
  await ensureLoggedIn();
  await callTool('navigate_to', { target: 'project', projectId });
  await waitForTool('get_project_context');
  await sleep(800);
  return callTool('get_project_context');
}

// ---- local book folder (book.json + chapters/*.md) ----
const BOOK_TEMPLATE = (title) => ({
  title,
  description: '',
  bookSize: '신국판',
  projectId: null,
  parts: [
    {
      title: '1부 시작하기',
      code: '1부',
      introduction: '',
      chapters: [
        { file: 'chapters/01-01.md', title: '첫 번째 챕터', code: '01', complete: false }
      ]
    }
  ]
});
const CHAPTER_TEMPLATE = `---
question: "이 챕터가 답하는 핵심 질문"
summary: "챕터 요약 두세 문장"
---

## 절 제목

본문 문단. **굵게** 강조는 script가 <b>로 바꿉니다.

> **조금 더 쉽게**: 초보자용 보충 설명 (초록 박스)

> **Basic Study**: 꼭 알아야 할 개념 정리 (분홍 박스)
`;
function readBook(dir) {
  const manifestPath = `${dir}/book.json`;
  if (!fs.existsSync(manifestPath)) throw new Error(`book.json not found in ${dir} (run init-book first)`);
  const book = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { book, manifestPath };
}
function validateBook(dir) {
  const { book } = readBook(dir);
  const problems = [];
  if (!book.title || !String(book.title).trim()) problems.push('book.title is empty');
  if (!Array.isArray(book.parts) || book.parts.length === 0) problems.push('book.parts must be a non-empty array');
  const seenCodes = new Set();
  (book.parts || []).forEach((part, pi) => {
    if (!part.title) problems.push(`parts[${pi}].title is empty`);
    if (!Array.isArray(part.chapters) || part.chapters.length === 0) problems.push(`parts[${pi}] "${part.title}" has no chapters`);
    (part.chapters || []).forEach((ch, ci) => {
      const where = `parts[${pi}].chapters[${ci}]`;
      if (!ch.file) problems.push(`${where}.file is missing`);
      else if (!fs.existsSync(`${dir}/${ch.file}`)) problems.push(`${where}: file not found: ${ch.file}`);
      else {
        const src = fs.readFileSync(`${dir}/${ch.file}`, 'utf8');
        if (!/^---[\s\S]*?question:/m.test(src)) problems.push(`${where}: ${ch.file} has no "question" in its frontmatter`);
        if (!/^---[\s\S]*?summary:/m.test(src)) problems.push(`${where}: ${ch.file} has no "summary" in its frontmatter`);
        if (!/^## /m.test(src)) problems.push(`${where}: ${ch.file} has no "## " section heading`);
      }
      if (!ch.title) problems.push(`${where}.title is empty`);
      const key = `${part.code || pi}/${ch.code || ci}`;
      if (seenCodes.has(key)) problems.push(`${where}: duplicate chapter code ${key}`);
      seenCodes.add(key);
    });
  });
  return { ok: problems.length === 0, problems, parts: (book.parts || []).length, chapters: (book.parts || []).reduce((n, p) => n + (p.chapters || []).length, 0) };
}

// ── image helpers (set-image / generate-image) ──
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
function fileToDataUrl(p) {
  const ext = String(p).split('.').pop().toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) throw new Error(`unsupported image type .${ext} (png, jpg, gif, webp, svg)`);
  const buf = fs.readFileSync(p);
  if (buf.length > 10 * 1024 * 1024) throw new Error('image larger than 10MB: resize or compress it first');
  return `data:${mime};base64,${buf.toString('base64')}`;
}
// --block / --image / --caption-match pick an existing image block; --at / --after insert a new one
function imageTarget() {
  const t = {};
  if (flags.block) t.blockId = flags.block;
  if (flags.image !== undefined) t.imageIndex = Number(flags.image);
  if (flags['caption-match']) t.captionMatch = flags['caption-match'];
  if (flags.at !== undefined) t.insertAtIndex = Number(flags.at);
  if (flags.after) t.insertAfterBlockId = flags.after;
  if (Object.keys(t).length === 0) throw new Error('pick a target: --block <id> | --image <n> | --caption-match "..." | --at <index> | --after <blockId>  (see: images <chapterId>)');
  return t;
}

// ── AI illustration: the same prompt template as the editor (src/lib/megaPie.js generateMegaPieImage) ──
export function buildImagePrompt(userPrompt, projectInstruction = '') {
  return `${projectInstruction ? `*** PROJECT STYLE GUIDELINES ***\n${projectInstruction}\n********************************\n\n` : ''}USER REQUEST: ${userPrompt}\n\nREMINDER: PURE ILLUSTRATION, NO TEXT, NO BORDERS.`;
}
// book.json chapter entry for a chapter id (matched through the live TOC by part title + chapter title/code)
function findBookChapter(book, toc, chapterId) {
  for (const p of toc.parts || []) {
    const c = (p.chapters || []).find(x => x.id === chapterId);
    if (!c) continue;
    const bp = (book.parts || []).find(x => x.title === p.title) || null;
    const bc = bp ? (bp.chapters || []).find(x => x.title === c.title || (x.code && x.code === c.chapter_code)) : null;
    return { part: p, chapter: c, bookChapter: bc };
  }
  return { part: null, chapter: null, bookChapter: null };
}

// record {index, file} for a chapter in book.json (file path stored relative to the book dir)
async function recordBookImage(bookDir, chapterId, imageIndex, file) {
  const { book, manifestPath } = readBook(bookDir);
  const toc = await callTool('get_book_toc');
  const { bookChapter } = findBookChapter(book, toc, chapterId);
  if (!bookChapter) return { recorded: false, reason: 'chapter not found in book.json (title/code mismatch)' };
  const rel = file.startsWith(bookDir + '/') ? file.slice(bookDir.length + 1) : file;
  bookChapter.images = (bookChapter.images || []).filter(im => im.index !== imageIndex);
  bookChapter.images.push({ index: imageIndex, file: rel });
  bookChapter.images.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  fs.writeFileSync(manifestPath, JSON.stringify(book, null, 2) + '\n');
  return { recorded: true, file: rel };
}

const commands = {
  async tab() { return { targetId: await getTarget() }; },
  async tools() {
    return evalInPage(`(async()=>{const mc=document.modelContext||navigator.modelContext; if(!mc) throw new Error('WebMCP not available'); const t=await mc.getTools(); return t.map(x=>({name:x.name,description:x.description,inputSchema:x.inputSchema,annotations:x.annotations||null}));})()`);
  },
  async call([name, json]) { return callTool(name, json ? JSON.parse(json) : {}); },
  async context() { return callTool('get_project_context'); },
  async toc() { return callTool('get_book_toc'); },
  async 'create-part'([title, code]) {
    return callTool('create_part', { title, chapterCode: code || undefined, introduction: flags.intro || undefined, focus: !!flags.focus });
  },
  async 'create-chapter'([partId, title, code]) {
    return callTool('create_chapter', { partId, title, chapterCode: code || undefined, question: flags.question || undefined, summary: flags.summary || undefined, focus: !flags['no-focus'] });
  },
  async 'write-chapter'([chapterId, file]) {
    const { md } = prepareMarkdown(fs.readFileSync(file, 'utf8'), { joinParagraphs: !flags['split-paragraphs'] });
    return callTool('write_chapter_markdown', { chapterId, markdown: md, markAsCompleted: !!flags.complete, focus: !flags['no-focus'] });
  },
  async 'read-chapter'([chapterId]) { return callTool('get_chapter_content', { chapterId }); },
  async navigate([chapterId]) { return callTool('navigate_to_chapter', { chapterId }); },
  async 'save-chapter'() { return callTool('save_chapter', { markAsCompleted: !!flags.complete }); },
  async 'delete-chapter'([chapterId]) { return callTool('delete_chapter', { chapterId }); },
  async 'delete-part'([partId]) { return callTool('delete_part', { partId }); },
  async settings([json]) { return callTool('update_project_settings', json ? JSON.parse(json) : {}); },
  async open([projectId, chapterId]) {
    const url = `${HOME}project/${projectId}${chapterId ? `?chapter=${chapterId}` : ''}`;
    await evalInPage(`location.href=${JSON.stringify(url)};'ok'`);
    await sleep(Number(flags.wait || 6000));
    return evalInPage(`({url:location.href,title:document.title})`);
  },
  async status() { return status(); },
  async dashboard() { return goDashboard(); },
  async projects() { await ensureLoggedIn(); const s = await status(); if (s.page !== 'dashboard') await goDashboard(); return callTool('list_projects'); },
  async 'create-project'([title]) {
    if (!title) throw new Error('usage: create-project "<title>" [--description "..."] [--book-size 신국판] [--sample] [--no-open]');
    const s = await ensureLoggedIn();
    if (s.page !== 'dashboard') await goDashboard();
    const r = await callTool('create_project', { title, description: flags.description || '', bookSize: flags['book-size'] || undefined, withSample: !!flags.sample, open: !flags['no-open'] });
    if (!flags['no-open']) { await waitForTool('get_project_context'); await sleep(800); }
    return r;
  },
  async 'open-project'([projectId]) { if (!projectId) throw new Error('usage: open-project <projectId>'); return openProject(projectId); },
  async 'wait-tools'([name]) { await waitForTool(name || 'get_project_context', Number(flags.timeout || 15000)); return { ready: name || 'get_project_context' }; },
  async 'complete-all'() {
    const toc = await callTool('get_book_toc');
    const chapterUpdates = toc.parts.flatMap(p => p.chapters.map(c => ({ id: c.id, is_completed: true })));
    if (chapterUpdates.length === 0) return { updated: 0 };
    return callTool('update_toc_structure', { chapterUpdates });
  },
  async 'init-book'([dir]) {
    if (!dir) throw new Error('usage: init-book <dir> [--title "..."]');
    fs.mkdirSync(`${dir}/chapters`, { recursive: true });
    const manifestPath = `${dir}/book.json`;
    if (fs.existsSync(manifestPath) && !flags.force) throw new Error(`${manifestPath} already exists (use --force to overwrite)`);
    fs.writeFileSync(manifestPath, JSON.stringify(BOOK_TEMPLATE(flags.title || '새 책'), null, 2) + '\n');
    const sample = `${dir}/chapters/01-01.md`;
    if (!fs.existsSync(sample)) fs.writeFileSync(sample, CHAPTER_TEMPLATE);
    return { created: [manifestPath, sample], next: 'edit book.json (parts/chapters) and write one Markdown file per chapter, then: validate <dir> → publish <dir>' };
  },
  async validate([dir]) { if (!dir) throw new Error('usage: validate <dir>'); return validateBook(dir); },
  async publish([dir]) {
    if (!dir) throw new Error('usage: publish <dir> [--project <id>] [--complete] [--dry-run]');
    const v = validateBook(dir);
    if (!v.ok) throw new Error('book is not valid:\n- ' + v.problems.join('\n- '));
    const { book, manifestPath } = readBook(dir);
    const plan = { project: flags.project || book.projectId || null, parts: book.parts.map(p => ({ title: p.title, code: p.code, chapters: p.chapters.map(c => `${c.code || ''} ${c.title}`.trim()) })) };
    if (flags['dry-run']) return { dryRun: true, ...plan, wouldCreateProject: !plan.project };

    await ensureLoggedIn();
    let projectId = plan.project;
    let createdProject = false;
    if (!projectId) {
      const s = await status();
      if (s.page !== 'dashboard') await goDashboard();
      const r = await callTool('create_project', { title: book.title, description: book.description || '', bookSize: book.bookSize || undefined, withSample: false, open: true });
      projectId = r.projectId; createdProject = true;
      book.projectId = projectId;
      fs.writeFileSync(manifestPath, JSON.stringify(book, null, 2) + '\n');
      await waitForTool('get_project_context'); await sleep(800);
    } else {
      await openProject(projectId);
    }
    if (book.bookSize && !createdProject) {
      const ctx = await callTool('get_project_context');
      if (ctx.bookSize !== book.bookSize) await callTool('update_project_settings', { bookSize: book.bookSize });
    }

    const existing = await callTool('get_book_toc');
    const report = { projectId, createdProject, parts: [] };
    let firstChapterId = null;
    for (const part of book.parts) {
      let partRow = existing.parts.find(p => p.title === part.title);
      let partId = partRow?.id;
      if (!partId) {
        const r = await callTool('create_part', { title: part.title, introduction: part.introduction || '', chapterCode: part.code || undefined, focus: false });
        partId = r.partId; partRow = { chapters: [] };
        await sleep(600);
      }
      const partReport = { title: part.title, partId, chapters: [] };
      for (const ch of part.chapters) {
        let chapterRow = (partRow.chapters || []).find(c => c.title === ch.title || (ch.code && c.chapter_code === ch.code));
        let chapterId = chapterRow?.id;
        if (!chapterId) {
          const r = await callTool('create_chapter', { partId, title: ch.title, chapterCode: ch.code || undefined, focus: false });
          chapterId = r.chapterId;
          await sleep(600);
        }
        if (!firstChapterId) firstChapterId = chapterId;
        const { md } = prepareMarkdown(fs.readFileSync(`${dir}/${ch.file}`, 'utf8'), { joinParagraphs: !flags['split-paragraphs'] });
        const w = await callTool('write_chapter_markdown', { chapterId, markdown: md, markAsCompleted: !!(flags.complete || ch.complete), focus: true });
        // chapter.images: [{ index | captionMatch, file | url, caption? }] — re-applied after every write, since
        // write_chapter_markdown recreates all blocks and would otherwise leave the placeholders empty
        const imageReport = [];
        for (const im of ch.images || []) {
          const target = typeof im.index === 'number' ? { imageIndex: im.index } : im.captionMatch ? { captionMatch: im.captionMatch } : null;
          if (!target) throw new Error(`${ch.file}: each image needs "index" or "captionMatch"`);
          const source = im.file ? { dataUrl: fileToDataUrl(`${dir}/${im.file}`) } : im.url ? { url: im.url } : null;
          if (!source) throw new Error(`${ch.file}: each image needs "file" or "url"`);
          const r = await callTool('set_chapter_image', { chapterId, ...target, ...source, caption: im.caption || undefined, focus: false });
          imageReport.push({ index: r.imageIndex, blockId: r.blockId, url: r.url });
          await sleep(400);
        }
        partReport.chapters.push({ code: ch.code, title: ch.title, chapterId, blocks: w.blocksCreated, charCount: w.charCount, pages: imageReport.length ? undefined : w.estimatedPages, completed: !!(flags.complete || ch.complete), images: imageReport.length ? imageReport : undefined });
        await sleep(Number(flags.pause || 2500));
      }
      report.parts.push(partReport);
    }
    if (firstChapterId) await callTool('navigate_to_chapter', { chapterId: firstChapterId });
    report.context = await callTool('get_project_context');
    return report;
  },
  async images([chapterId]) { if (!chapterId) throw new Error('usage: images <chapterId>'); return callTool('list_chapter_images', { chapterId }); },
  async 'set-image'([chapterId]) {
    if (!chapterId || (!flags.url && !flags.file)) throw new Error('usage: set-image <chapterId> (--block <id> | --image <n> | --caption-match "..." | --at <index> | --after <blockId>) (--url <url> | --file <path>) [--caption "..."] [--no-focus]');
    const source = flags.file ? { dataUrl: fileToDataUrl(flags.file) } : { url: flags.url };
    const r = await callTool('set_chapter_image', { chapterId, ...imageTarget(), ...source, caption: flags.caption || undefined, focus: !flags['no-focus'] });
    if (flags.book && flags.file && typeof r.imageIndex === 'number') r.book = await recordBookImage(flags.book, chapterId, r.imageIndex, flags.file);
    return r;
  },
  async 'generate-image'([chapterId]) {
    if (!chapterId) throw new Error('usage: generate-image <chapterId> (--block <id> | --image <n> | --caption-match "..." | --at <index> | --after <blockId>) [--prompt "..."] [--caption "..."] [--no-focus]');
    return callTool('generate_chapter_image', { chapterId, ...imageTarget(), prompt: flags.prompt || undefined, caption: flags.caption || undefined, focus: !flags['no-focus'] });
  },
  async 'remove-image'([chapterId]) {
    if (!chapterId) throw new Error('usage: remove-image <chapterId> (--block <id> | --image <n> | --caption-match "...") [--delete-block] [--keep-file] [--no-focus]');
    const t = imageTarget();
    if (t.insertAtIndex !== undefined || t.insertAfterBlockId) throw new Error('remove-image takes --block, --image or --caption-match only');
    return callTool('remove_chapter_image', { chapterId, ...t, deleteBlock: !!flags['delete-block'], deleteFile: !flags['keep-file'], focus: !flags['no-focus'] });
  },
  async 'image-prompt'() {
    if (flags.set !== undefined) {
      const r = await callTool('update_project_settings', { aiImagePrompt: String(flags.set) });
      return { updated: true, aiImagePrompt: String(flags.set), result: r };
    }
    const ctx = await callTool('get_project_context');
    return { projectId: ctx.projectId, aiImagePrompt: ctx.aiImagePrompt || '', hint: 'set with: image-prompt --set "스타일 지시문"' };
  },
  async 'plan-images'([chapterId]) {
    if (!chapterId || (flags.image === undefined && !flags['all-empty'] && !flags.all)) throw new Error('usage: plan-images <chapterId> (--image <n> | --all-empty | --all) [--prompt "..."] [--style "..."] [--out <dir>] [--book <dir>]');
    const ctx = await callTool('get_project_context');
    const style = flags.style !== undefined ? String(flags.style) : (ctx.aiImagePrompt || '');
    const list = await callTool('list_chapter_images', { chapterId });
    const targets = flags.all ? list.images : flags['all-empty'] ? list.images.filter(i => !i.hasImage) : list.images.filter(i => i.imageIndex === Number(flags.image));
    if (targets.length === 0) throw new Error(flags.image !== undefined ? `image block ${flags.image} not found (${list.images.length} image blocks)` : 'no matching image blocks in this chapter');
    if (flags.prompt && targets.length > 1) throw new Error('--prompt applies to one block; use --image <n> with it');
    const toc = await callTool('get_book_toc');
    const { part, chapter } = findBookChapter({ parts: [] }, toc, chapterId);
    const outDir = flags.out || (flags.book ? `${flags.book}/images` : 'puvles-images');
    const stem = chapter ? `${part?.chapter_code || 'part'}-${chapter.chapter_code || 'ch'}`.replace(/[^\w.-]+/g, '_') : chapterId.slice(0, 8);
    const images = targets.map(t => ({
      imageIndex: t.imageIndex, blockId: t.blockId, hasImage: t.hasImage, caption: t.caption,
      prompt: buildImagePrompt(flags.prompt ? String(flags.prompt) : t.caption, style),
      file: `${outDir}/${stem}-${t.imageIndex}.svg`
    }));
    return {
      chapterId, chapterTitle: chapter?.title || null, projectStylePrompt: style || '(none: set one with image-prompt --set "...")', outDir, images,
      next: `Read projectStylePrompt and each prompt, draw each image yourself as an SVG at "file" (SKILL.md → Drawing diagrams as SVG), then insert it with:  set-image ${chapterId} --image <imageIndex> --file <file>${flags.book ? ` --book ${flags.book}` : ''}`
    };
  },
  async 'generate-local'(args) { return commands['plan-images'](args); },
  async screenshot([out = 'puvles.png']) {
    const t = await getTarget();
    const r = await cdp(t, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(r.data, 'base64')); return { saved: out };
  },
};

if (!commands[cmd]) { console.error(`unknown command "${cmd}". See the header of this file for usage.`); process.exit(1); }
commands[cmd](args)
  .then(r => console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2)))
  .catch(e => { console.error('ERROR:', e.message); process.exit(2); });
