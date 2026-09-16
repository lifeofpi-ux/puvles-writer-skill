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
  `generate_chapter_image`, `remove_chapter_image`, `navigate_to_chapter`, `update_toc_structure`,
  `save_chapter`, `delete_chapter`, `delete_part`, `update_project_settings`

Run every command as `node ~/.claude/skills/puvles-writer/scripts/puvles.mjs <cmd> ...`.
The header of that file lists all commands.

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

## Images (after the text is in place)

Every `[이미지 플레이스홀더: 캡션]` line becomes an empty image block. Fill
them once the chapter is written:

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
