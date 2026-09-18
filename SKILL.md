---
name: puvles-writer
description: Write whole books or single chapters into the Puvles (퍼블리스, puvles.lopapps.com) publishing platform through its WebMCP tools, either live in the browser or from a local Markdown folder published in one go. Use when the user asks to write, rewrite, restructure or publish chapters/books in Puvles, or says "퍼블리스 MCP/web MCP로 작성", "퍼블리스에 발행". Drives the user's logged-in Chrome tab through remote debugging; no direct database access.
---

# Puvles writer (WebMCP)

The Puvles app registers WebMCP tools on `document.modelContext` (Chrome's
native API or the official polyfill). `scripts/puvles.mjs` calls those tools
inside the user's signed-in Chrome tab, so the app itself creates projects,
parts and chapters, converts Markdown to blocks, records character counts,
animates the new blocks and moves the editor view. Nothing talks to Supabase
directly.

Tools by page:
- everywhere: `get_auth_status`, `navigate_to`
- dashboard (`/dashboard`): `list_projects`, `create_project`, `open_project`
- editor (`/project/:id`): `get_project_context`, `get_book_toc`,
  `create_part`, `create_chapter`, `get_chapter_content`,
  `write_chapter_markdown`, `list_chapter_images`, `set_chapter_image`,
  `generate_chapter_image`, `remove_chapter_image`, `update_chapter`, `update_part`,
  `insert_blocks`, `update_block`, `delete_blocks`, `replace_blocks`,
  `navigate_to_chapter`, `update_toc_structure`,
  `save_chapter`, `delete_chapter`, `delete_part`, `update_project_settings`

Run every command as `node ~/.claude/skills/puvles-writer/scripts/puvles.mjs <cmd> ...`.
The header of that file lists all commands. A second script,
`scripts/capture.mjs`, screenshots real product screens for the book's figures
through the same Chrome; see "Capturing product screens with Playwright".

## Step 0: choose the mode (always ask unless the user already said)

Ask with AskUserQuestion, one question, two options:

1. **웹에 바로 작성** (live): draft each chapter, then write it into the open
   editor one by one. The user watches parts and chapters appear with the block
   animation. Best for demos, recordings and short books.
2. **로컬에 작성 후 배포** (local-first): scaffold a folder with `book.json`
   and one Markdown file per chapter, write everything locally (the user can
   review and edit files), then `publish` creates the project, parts and
   chapters and uploads every body in one run. Best for long books and for
   keeping a copy in the repo.

If the user's message already names a mode ("바로 써줘", "로컬에 먼저 만들어",
"한 번에 발행") skip the question.

## Prerequisites (check in this order)

1. Chrome with remote debugging: `curl -s http://127.0.0.1:9222/json/version`.
   If it fails, ask the user to start Chrome with
   `--remote-debugging-port=9222` (or set `CDP_PORT`). For a local dev server
   set `PUVLES_HOME=http://localhost:5174/` (default is the production site).
2. The user must be **signed in** on any Puvles page; that is all they need
   to do. `status` returns `loggedIn`, `page` (home/dashboard/project) and the
   open `projectId`. If `loggedIn` is false, ask the user to log in on the
   Puvles main page and re-run `status`; never ask for their password.
3. `tools` lists what is registered on the current page. Page tools appear
   only on their page; `dashboard`, `open-project` and `create-project` move
   there and wait for the tools themselves.

## Mode 1: live writing in the browser

1. `status` → if no project is open: `projects` to pick one, or
   `create-project "<title>" [--description "..."] [--book-size 신국판]`
   (creates an empty project and opens the editor; add `--sample` only if the
   user wants the sample guide chapter).
2. `context` and `toc` (parts → chapters with ids, codes, completion).
3. Draft each chapter locally as Markdown (dialect below) so the user keeps a
   copy, then `create-part "<title>" "<code>"` →
   `create-chapter <partId> "<title>" "<code>"` →
   `write-chapter <chapterId> file.md [--complete]`. Writing moves the editor
   to the chapter, records the character count and plays the block animation
   (the view scrolls along with the blocks as they appear; a manual wheel or
   touch scroll pauses the following for 2.5 s);
   no separate save is needed. Pause a few seconds between chapters when the
   user is watching or recording.
4. Finish: `complete-all` (or `--complete` per chapter) marks chapters done so
   the progress bar reaches 100 %, then `screenshot out.png` and Read it to
   check rendering (boxes, code, bold).
5. Report the TOC with ids, block counts and the page estimate from `context`.

## Mode 2: local-first, publish in one go

1. `init-book <dir> --title "<book title>"` creates `book.json` and
   `chapters/01-01.md`. Edit `book.json`: `title`, `description`, `bookSize`
   (신국판 | 46배판 | B5 | A5 | A4), and `parts[]` each with `title`, `code`,
   `introduction` and `chapters[]` of `{ file, title, code, complete }`.
   Write one Markdown file per chapter under `chapters/` (frontmatter
   `question` and `summary` required; the manifest carries title and code).
   Name files `<part>-<chapter>.md` (e.g. `01-03.md`) so they sort.
   A chapter may also list `images`: `[{ "index": 0, "file": "images/x.svg" }]`
   (or `captionMatch` / `url`); `publish` puts them into the placeholders after
   writing each body, so re-publishing never loses inserted images.
2. `validate <dir>` until it reports `ok: true`.
3. `publish <dir> --dry-run` shows the plan; then `publish <dir>` creates the
   project (unless `--project <id>` or `book.json.projectId` is set), sets the
   book size, creates parts and chapters that do not exist yet (matched by
   title or code, so re-running updates instead of duplicating), writes every
   body with the animation, and writes the new `projectId` back into
   `book.json`. Add `--complete` to mark all chapters done, `--pause <ms>` to
   change the delay between chapters (default 2500).
4. `screenshot out.png` and Read it; report the returned summary (project id,
   per-chapter blocks, characters, pages).

Both modes end in the same state: a project with parts, chapters and bodies,
statistics recorded, chapters marked complete when asked, editor left on the
first chapter.

## Editing an existing book (change only what the user asked for)

`write-chapter` and `publish` replace a chapter's whole body. When the user
wants a title changed, a paragraph fixed, a section rewritten or a few
chapters redone, do not rewrite everything: use the partial tools.

- **Titles and metadata**: `update-chapter <id> --title ".." [--code ..]
  [--question ..] [--summary ..] [--complete|--incomplete] [--part <partId>]
  [--order <n>]` and `update-part <id> --title ".." [--intro ..] [--code ..]
  [--order <n>]`. Only the flags you pass change; the body is untouched and
  the open editor header refreshes. `--part` moves a chapter to the end of
  another part; `--order` reorders inside the part (or the book, for parts).
- **A few chapters of a local book**: `publish <dir> --only 02-03,03-01`
  (chapter code, file name or a title fragment) writes just those bodies and
  re-applies their images; every other chapter stays as it is on the site.
- **Inside one chapter**: `blocks <chapterId>` lists the blocks with index,
  id, type and a preview. Then
  `insert-blocks <id> add.md --after <blockId>` (or `--before`, `--at <n>`,
  default append) adds new blocks, `update-block <id> <blockId> one.md`
  (or `--text ".."` to keep the type) changes one block,
  `replace-blocks <id> --from <h2 blockId> --to <last blockId> section.md`
  rewrites a section in place, `delete-blocks <id> a,b,c` removes blocks.
  The markdown files use the same dialect as chapters, without frontmatter.
  New or changed blocks play the reveal animation and the page count updates.
- Read the chapter first (`blocks` or `read-chapter`) and quote the block
  ids you will touch back to the user before `replace-blocks` or
  `delete-blocks`; both are irreversible. Never "tidy up" blocks you were
  not asked about.

## Images (after the text is in place)

Every `[이미지 플레이스홀더: 캡션]` line becomes an empty image block. Fill
them once the chapter is written. Sort the captions first: a **diagram or
infographic** you draw as SVG, a **real product screen** you capture with
Playwright, a **picture** you generate, and anything that needs the user's own
data or hardware you leave empty and name for them.

Commands:

1. `images <chapterId>` lists the image blocks with `imageIndex` (0-based,
   body order), `blockId`, `caption` and `hasImage`.
2. `set-image <chapterId> --image <n> --file diagram.png` uploads a local
   png/jpg/gif/webp/svg (≤10 MB) to the same storage the editor's upload
   button uses and puts it in that block; `--url https://...` links a public
   image instead. Pick the block with `--image <n>`, `--block <id>` or
   `--caption-match "부분 문자열"`; `--at <index>` / `--after <blockId>`
   create a new image block instead. `--caption "..."` replaces the caption.
3. `generate-image <chapterId> --image <n> [--prompt "..."]` runs the
   editor's own AI illustration (Google image model with the project's AI
   image style prompt). It needs the Google API key the user saved in the
   editor's "AI 설정"; if the tool reports a missing key, ask the user to save
   it there, never ask for the key yourself. Without `--prompt` the caption
   is the prompt. Generation takes 10–30 s per image.

Both commands refresh the open chapter with the block animation and update
the page estimate (an image counts 0.4 page).

`remove-image <chapterId> --image <n>` clears the image and leaves the caption
placeholder (like the editor's ✕ button); `--delete-block` removes the block
itself and closes the gap. The uploaded file is deleted from storage too when
it lives in the editor's bucket and no other block references it (`--keep-file`
to skip). Irreversible: only on an explicit request, never to tidy up.

### AI illustrations: read the project's prompt, then draw the image yourself

The editor builds every illustration prompt the same way (src/lib/megaPie.js):

```
*** PROJECT STYLE GUIDELINES ***
<project's AI image prompt, 프로젝트 설정 → "AI 이미지 생성 지침">
********************************

USER REQUEST: <the block's caption, or the prompt passed explicitly>

REMINDER: PURE ILLUSTRATION, NO TEXT, NO BORDERS.
```

So there are two prompt levels, and the skill uses both without calling any
image API itself:

- **Project style prompt** (one per book): `image-prompt` shows it,
  `image-prompt --set "깔끔한 펜화 일러스트, 흰 배경, 파스텔 포인트 컬러"` sets it
  through `update_project_settings.aiImagePrompt`. Set or confirm it with the
  user once before drawing anything, so all figures share a style. Describe
  medium, line weight, palette, background and mood; say what to avoid.
- **Per-block prompt** = the placeholder caption. When you write
  `[이미지 플레이스홀더: …]` for a figure that will be drawn, write the caption
  as an illustration brief: subject, setting, composition, mood, in one or
  two sentences, and no text or UI to render. Screenshot-style captions
  ("Netlify 대시보드 화면") are not briefs: leave those to real screenshots.

Workflow for making the images:

1. `plan-images <chapterId> (--image <n> | --all-empty | --all) [--prompt "..."]
   [--style "..."] --book <dir>` returns, per image block, the assembled
   prompt (project style + caption) and a target path
   `<book>/images/<part>-<chapter>-<n>.svg`. Show the project style prompt
   and the briefs to the user if they have not seen them.
2. Draw each image yourself as an SVG at that path, following the style
   guidelines in the prompt and the rules in "Drawing diagrams as SVG" below.
3. `set-image <chapterId> --image <n> --file <path> --book <dir>` inserts it
   and records it in `book.json` so `publish` re-applies it.
4. `screenshot` and Read it to check the result; fix and re-run `set-image`.

Tell the user the figures are hand-drawn vector art. The editor's own
"AI 이미지 생성" button (tool `generate_chapter_image`, `generate-image` in the
CLI) still exists for users who keep a Google key in the editor's AI 설정;
use it only when the user asks for it. Never ask for an API key in the chat.

### Drawing diagrams as SVG (when the user wants figures made, not just placed)

Sort the placeholders first. A caption that describes a real product screen
(대시보드, 콘솔, 터미널, 화면 캡처 …) cannot be produced: leave that block
empty and tell the user which ones need their screenshots. A caption that
describes a **diagram, infographic, flow, comparison or before/after**
(다이어그램, 인포그래픽, 흐름도, 비교, 구조, 계보 …) can be drawn as an SVG
and inserted with `set-image --file`. Always ask, or act on an explicit
request, before drawing: it changes the book's content.

Rules that keep the SVG rendering cleanly in the editor and in exports:

- Start from `templates/diagram-template.svg` (3-column card layout with
  arrows) and see `templates/example-decision-tree.svg` for a finished
  flowchart. Save as `<book>/images/<part>-<chapter>-<slug>.svg`.
- `viewBox="0 0 1200 H"` with H 480–600, white `<rect>` background, the
  Korean font stack from the template, no external fonts, images or CSS.
- Text ≥ 13px, titles 20–26px, ≤ 3 lines per bullet block; break long
  Korean phrases into separate `<text>` lines (SVG has no wrapping).
- No brand logos or trademarks: name badges (rounded rect + text) in the
  service's colour are enough. Dates next to any price or limit.
- Keep it under ~10 KB and one idea per figure; a table with more than
  four columns is better as a code block in the text.
- After inserting, `screenshot` and Read it: check overlaps at the card
  edges and footnotes, then fix the SVG and re-run `set-image` (same
  block, new file replaces the old one).
- Record each figure in `book.json` (`images: [{ index, file }]`) so
  `publish` re-applies it, and keep the SVG source in the book folder.

`generate-image` (AI illustration) is for pictures, not for diagrams with
text: the model does not render Korean text reliably.

### Capturing product screens with Playwright (when the placeholder needs a real UI)

A caption that describes a real screen cannot be drawn, but it can often be
**photographed**: `scripts/capture.mjs` attaches to the same logged-in Chrome
the Puvles tools already use and screenshots any page inside the user's real
session, so Google, Notion or an admin console need no second login and no
browser download. Install the dependency once:

```
cd ~/.claude/skills/puvles-writer && npm i playwright-core
```

```
capture.mjs tabs                            what is open in that Chrome right now
capture.mjs shot <url> <out.png> [options]  open a tab, capture it, close it
capture.mjs run <recipe.mjs> [args...]      multi-step flow, then capture
```

`shot` options: `--wait <ms>`, `--selector <css>` (one element),
`--clip <x,y,w,h>` (a CSS-pixel rectangle, the tightest book figures),
`--full`, `--viewport <WxH>` (default 1440x900), `--dpr <n>` (default 2),
`--click <css>` and `--press <key>` (repeatable, applied before the shot),
`--hide <css>`, `--reuse` (shoot the open tab instead of a new one),
`--keep-open`, `--timeout <ms>`.

A recipe is an ES module exporting one async function, for the flows a single
URL cannot reach (open a menu, paste data, run something, then shoot):

```
export default async ({ page, context, browser, shot, args, argv }) => {
  await page.goto('https://docs.google.com/spreadsheets/d/<id>/edit');
  await page.getByRole('menuitem', { name: '확장 프로그램' }).click();
  await shot(page, 'shots/menu.png', { clip: '0,0,1000,560', dpr: 2 });
};
```

Then place it like any other figure and record it in `book.json` so a
re-publish keeps it:

```
puvles.mjs set-image <chapterId> --image <n> --file shots/menu.png
```

What actually goes wrong, and the fix:

- **Korean text never arrives through `keyboard.type()`.** Hangul needs an IME,
  so the syllables are dropped or truncated ("보호자 이메일" lands as "이메일").
  Put the text on the clipboard and paste it instead: `grantPermissions`
  `['clipboard-read','clipboard-write']` for the origin, `navigator.clipboard.writeText(tsv)`
  in the page, then `Meta+V`. Tab-separated rows paste straight into a
  spreadsheet grid, which is also far faster than typing cell by cell.
- **Set a code editor's text through its own model, not the keyboard.** Even
  clipboard paste leaves IME residue in a Monaco editor: stray syllables land
  at the end of the buffer and the saved script dies with a `ReferenceError`
  on a line past where the code ends. The Apps Script editor exposes `monaco`,
  so `monaco.editor.getModels()[0].setValue(src)` inside `page.evaluate()`
  writes the file with no key events at all. Read it back the same way and
  compare with the source before saving; `innerText` only shows the lines
  Monaco has rendered, so it cannot verify the whole file. `keyboard.insertText`
  is not a substitute: the editor auto-indents every inserted line and the
  result is mangled.
- **Keys sent to a grid become Hangul too.** An `Escape` or a stray press
  against a spreadsheet can commit a jamo into the selected cell. Take the
  shot right after a reload and send no keys at all, rather than pressing
  Escape to tidy the view.
- **Check that the run actually succeeded, not just that it started.** A web
  IDE reports "started" and then fails server-side. The Apps Script
  executions page (`/home/projects/<id>/executions`) lists each run with its
  status; expand a failed row for the error. An editor wedged on "saving"
  needs a reload, not another click.
- **Popups sit on top of the figure.** A paste-options bubble, a tooltip or an
  autocomplete needs `--press Escape`; a cookie or consent bar needs
  `--click` on its accept button or `--hide` on its container.
- **Web apps need longer than a page load.** Google's editors keep painting for
  ten seconds or more after `domcontentloaded`; give them `--wait 9000` and
  raise it if the shot comes back half-drawn.
- **A click can open a new tab.** Wait for it rather than guessing:
  `const [tab] = await Promise.all([context.waitForEvent('page'), link.click()])`,
  then `await shot(tab, ...)`.
- **Always Read the PNG back** before inserting it. Half-loaded panes, stray
  characters left in a code editor and menus that closed early all look fine
  in the log and wrong in the book.

Rules that matter more than the picture:

- **Never capture real personal data.** Use the book's own fictional names and
  example.com addresses. A real inbox, a real class roster or a real
  student's name in a figure ships that person's data with the book. If a
  screen cannot be staged with fake data, leave the placeholder for the user.
- **Staging a figure may change the user's account.** Creating documents is
  reversible and fine; granting OAuth scopes, sending mail, deleting
  anything, installing triggers and deploying a web app are not ordinary
  screenshot steps. Say what the capture will create before a long run, and
  ask before anything outward-facing. Never send mail to a third party to
  stage a figure; address it to the user's own account.
- **Keep the staged artifacts together** so the user can find and remove them
  later, and tell them what was created and where.

## Housekeeping tools (only when the user asks for exactly that)

- `save-chapter [--complete]` commits what the user typed in the open chapter,
  same as the editor's save button. Not needed after `write-chapter`.
- `delete-chapter <id>` / `delete-part <id>` are irreversible; confirm with
  the user first and never use them to "clean up" on your own.
- `settings '<json>'` changes `bookSize`, `blockLabels` (question, summary,
  box_green, box_pink), contribution `weights`, `title`, `description`,
  `aiTextPrompt`, `aiImagePrompt`. The Markdown parser still recognises only
  the default box markers (`조금 더 쉽게`, `Basic Study`), whatever the labels
  display as.

Still not available through WebMCP: deleting or editing single text blocks,
member management, deleting projects. Those live in the UI; tell the
user instead of working around it.

## Markdown dialect the editor's parser accepts

```
---
question: "핵심 질문 (violet box at the top)"
summary: "챕터 요약 (grey box under it)"
---

## 절 제목               → h2 block
### 소제목               → h3 block
본문 문단. **굵게** is converted to <b> by the script.

> **조금 더 쉽게**: 초보자용 보충 설명 → green box
> **Basic Study**: 기초 개념 정리 → pink box

```code```               → code block
[이미지 플레이스홀더: 캡션] → empty image block with caption
```

Parser quirks to respect:
- Everything between two structural lines becomes **one** text block, so the
  script joins paragraphs with `<br/><br/>` to keep visible paragraph breaks.
  Pass `--split-paragraphs` to skip that when a section is one paragraph.
- A leading `# ` line is ignored; do not open the body with an H2 repeating
  the chapter title, the editor prints the title itself.
- Tables are not parsed; use a code block or ask the user.
- Lists (`- `, `1. `) are stored as plain text lines; prefer prose.

## Writing guidance for handbooks

Korean, professional but friendly, essay-like flow: few headings, full
paragraphs, one green box per section restating the idea for beginners and a
pink box where a term needs a definition. Every chapter gets its own question
and summary. Put the date next to any price or limit. Page estimate: stripped
characters / page size of the book format (신국판 800, 46배판 1100, B5 1000,
A5 600, A4 1400; an image counts 0.4 page).

## Internals

`callTool` evaluates `document.modelContext.getTools()` then
`executeTool(toolObject, args)` in the page via `Runtime.evaluate`; results are
the app's JSON strings. `call <tool> '<json>'` reaches any tool directly.
Route hooks register their tools on mount, so after any navigation the script
polls `getTools()` (`wait-tools`) before calling page tools.
