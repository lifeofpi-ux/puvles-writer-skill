# puvles-writer

퍼블리스(Puvles, https://puvles.lopapps.com) 편집기가 브라우저에 노출하는 WebMCP 도구를 통해, AI 에이전트(Claude Code)가 책 한 권을 처음부터 끝까지 집필하고 발행하게 하는 Claude Code 스킬입니다.

에이전트는 사용자가 로그인해 둔 Chrome 탭 안에서 퍼블리스 앱의 도구를 호출합니다. 프로젝트 생성, 파트와 챕터 생성, 마크다운을 블록으로 변환, 글자 수 통계 기록, 블록 생성 애니메이션, 화면 이동까지 모두 앱 자신이 수행합니다. 데이터베이스에 직접 접근하지 않습니다.

## 두 가지 진행 방식

| 방식 | 흐름 | 어울리는 경우 |
|---|---|---|
| 웹에 바로 작성 | 챕터를 하나씩 초안 작성 → 열린 편집기에 즉시 기록 | 시연, 녹화, 짧은 책 |
| 로컬에 작성 후 배포 | `book.json`과 챕터별 마크다운을 로컬에 작성 → `publish` 한 번으로 프로젝트 생성부터 완료 처리까지 | 긴 책, 원고 사본을 리포에 보관 |

스킬을 호출하면 에이전트가 먼저 이 둘 중 하나를 고르도록 묻습니다. 요청에 방식이 이미 담겨 있으면 묻지 않습니다.

## 요구 사항

- Claude Code
- Node.js 22 이상 (내장 `fetch`, `WebSocket` 사용)
- 원격 디버깅 포트를 연 Chrome. 예: `--remote-debugging-port=9222`
- 퍼블리스에 로그인된 탭. 로그인은 사용자가 직접 하며, 스킬은 비밀번호를 다루지 않습니다.
- 퍼블리스 앱이 WebMCP 도구를 등록하는 버전일 것. Chrome에 WebMCP 플래그가 없어도 앱이 폴리필을 제공하므로 동작합니다.

## 설치

```bash
git clone https://github.com/lifeofpi-ux/puvles-writer-skill.git ~/.claude/skills/puvles-writer
```

Claude Code를 다시 열면 `/puvles-writer`로 호출할 수 있습니다. 로컬 개발 서버를 쓸 때는 다음 환경변수를 설정합니다.

```bash
export PUVLES_HOME=http://localhost:5174/
export CDP_PORT=9222   # 기본값
```

## 빠른 시작

```bash
S=~/.claude/skills/puvles-writer/scripts/puvles.mjs

node $S status                      # 로그인 여부, 현재 페이지, 열린 프로젝트
node $S create-project "새 책 제목"  # 빈 프로젝트를 만들고 편집기를 엶
node $S create-part "1부 시작하기" "1부"
node $S create-chapter <partId> "첫 챕터" "01"
node $S write-chapter <chapterId> chapter.md --complete
```

로컬 우선 방식은 다음과 같습니다.

```bash
node $S init-book ./my-book --title "새 책 제목"   # book.json + chapters/ 생성
# book.json과 chapters/*.md 작성
node $S validate ./my-book
node $S publish ./my-book --dry-run               # 계획만 확인
node $S publish ./my-book --complete              # 프로젝트 생성 → 파트/챕터 → 본문 → 완료 처리
```

`publish`는 생성한 프로젝트 ID를 `book.json`에 되돌려 씁니다. 다시 실행하면 같은 프로젝트에서 제목이나 코드가 같은 파트와 챕터를 찾아 본문만 갱신합니다.

## 명령 목록

| 명령 | 설명 |
|---|---|
| `status` | 로그인 상태와 현재 페이지 (모든 페이지에서 동작) |
| `dashboard` | 프로젝트 목록 페이지로 이동 |
| `projects` | 내 프로젝트 목록 |
| `create-project "<title>" [--description ..] [--book-size ..] [--sample] [--no-open]` | 프로젝트 생성 |
| `open-project <id>` | 편집기 열기 후 도구 등록 대기 |
| `context`, `toc` | 프로젝트 정보, 목차 |
| `images <chapterId>` | 챕터의 이미지 블록 목록 (순번, 캡션, 이미지 유무) |
| `set-image <chapterId> --image <n> (--file x.svg \| --url ..)` | 플레이스홀더에 이미지 삽입 (파일은 편집기와 같은 저장소에 업로드) |
| `generate-image <chapterId> --image <n> [--prompt ..]` | 편집기의 AI 이미지 생성과 동일 (편집기에 저장된 Google API 키 필요) |
| `remove-image <chapterId> --image <n> [--delete-block] [--keep-file]` | 이미지 비우기(캡션 유지) 또는 블록 삭제. 저장소 파일도 함께 삭제. 되돌릴 수 없음 |
| `image-prompt [--set ".."]` | 프로젝트의 AI 이미지 생성 지침 조회·설정 |
| `plan-images <chapterId> (--image <n> \| --all-empty \| --all) [--prompt ..] --book <dir>` | 프로젝트 지침 + 캡션으로 조립한 프롬프트와 저장 경로를 반환. 에이전트가 직접 SVG를 그려 `set-image --file --book`으로 삽입 (외부 이미지 API 호출 없음) |
| `create-part`, `create-chapter`, `write-chapter`, `read-chapter`, `navigate` | 집필 |
| `save-chapter [--complete]` | 편집기 저장 버튼과 동일한 확정 저장 |
| `complete-all` | 모든 챕터 완료 처리 |
| `delete-chapter <id>`, `delete-part <id>` | 되돌릴 수 없는 삭제. 사용자가 명시적으로 요청할 때만 |
| `settings '<json>'` | 판형, 블록 라벨, 가중치, 제목, 설명, AI 지시문 변경 |
| `init-book`, `validate`, `publish` | 로컬 우선 발행 |
| `tools`, `call <tool> '<json>'` | 등록된 도구 확인, 임의 도구 호출 |
| `screenshot <out.png>` | 현재 탭 캡처 |

## book.json 형식

```json
{
  "title": "책 제목",
  "description": "책 설명",
  "bookSize": "신국판",
  "projectId": null,
  "parts": [
    {
      "title": "1부 시작하기",
      "code": "1부",
      "introduction": "",
      "chapters": [
        { "file": "chapters/01-01.md", "title": "첫 챕터", "code": "01", "complete": true }
      ]
    }
  ]
}
```

판형은 신국판, 46배판, B5, A5, A4 중 하나입니다. 챕터 파일은 프런트매터에 `question`과 `summary`가 있어야 하고, 제목과 코드는 매니페스트가 가집니다.

## 마크다운 규칙

퍼블리스 파서가 인식하는 형태입니다.

```markdown
---
question: "핵심 질문 (상단 보라색 박스)"
summary: "챕터 요약 (그 아래 회색 박스)"
---

## 절 제목                → h2 블록
### 소제목                → h3 블록
본문 문단. **굵게**는 스크립트가 <b>로 바꿉니다.

> **조금 더 쉽게**: 초보자용 보충 설명 → 초록 박스
> **Basic Study**: 개념 정리 → 분홍 박스

```code```                → 코드 블록
[이미지 플레이스홀더: 캡션] → 캡션만 있는 이미지 블록
```

구조 줄 사이의 문단은 하나의 텍스트 블록이 되므로 스크립트가 문단 사이를 `<br/><br/>`로 잇습니다. `--split-paragraphs`로 끌 수 있습니다. 표와 목록은 파서가 처리하지 않습니다.

## 퍼블리스가 제공하는 WebMCP 도구

| 페이지 | 도구 |
|---|---|
| 모든 페이지 | get_auth_status, navigate_to |
| 대시보드 | list_projects, create_project, open_project |
| 편집기 | get_project_context, get_book_toc, create_part, create_chapter, get_chapter_content, write_chapter_markdown, navigate_to_chapter, update_toc_structure, save_chapter, delete_chapter, delete_part, update_project_settings |

## 동작 원리

스크립트는 Chrome DevTools Protocol로 탭에 접속해 페이지 안에서 `document.modelContext.getTools()`로 도구 객체를 찾고 `executeTool(tool, args)`를 호출합니다. 페이지를 이동하면 해당 페이지의 훅이 마운트될 때 도구가 등록되므로, 이동 뒤에는 도구가 나타날 때까지 폴링한 다음 진행합니다.

## 주의

- 삭제 도구는 되돌릴 수 없습니다. 에이전트가 정리 목적으로 임의로 쓰지 않도록 SKILL.md에 명시되어 있습니다.
- 원격 디버깅 포트가 열린 Chrome은 같은 컴퓨터의 다른 프로그램도 제어할 수 있습니다. 작업이 끝나면 닫는 것을 권합니다.
- 프로젝트 삭제, 블록 단위 편집, 이미지 업로드, 멤버 관리는 도구로 제공되지 않습니다.
