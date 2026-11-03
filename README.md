# ss-fe

SayScene의 영어 회화 연습 웹 앱입니다. 10개 장소·상황 중 하나를 골라 음성으로 대화하고, 번역·답변 추천·단어장·교정 리포트를 사용합니다. React 19·TypeScript·Vite 기반 SPA이며 API는 [ss-be](https://github.com/say-scene/ss-be)가 담당합니다.

```text
브라우저 녹음 → BE → CPU Whisper STT → 대화 API → vLLM
                                           ↓
                          완성된 AI 문장 → 브라우저 TTS
```

응답은 완성된 JSON으로 받으며 SSE를 사용하지 않습니다. TTS는 브라우저 `speechSynthesis`를 사용하고, 사용자 음성 원본은 브라우저 저장소에 보관하지 않습니다.

## 구성

| 파일 | 역할 |
|---|---|
| [`src/App.tsx`](src/App.tsx), [`src/Home.tsx`](src/Home.tsx) | 화면 전환, 새 대화·이어하기·종료·리포트 흐름 |
| [`src/scenarios.ts`](src/scenarios.ts) | 10개 고정 상황 목록 |
| [`src/ChatRoom.tsx`](src/ChatRoom.tsx) | 말풍선, 원문 공개, 번역, 단계별 추천, 마지막 발화 수정 |
| [`src/conversation.ts`](src/conversation.ts), [`src/useConversation.ts`](src/useConversation.ts) | 서버 대화 동기화, 복원·재시도, 탭 간 입력 소유권 |
| [`src/useRecorder.ts`](src/useRecorder.ts), [`src/useSpeech.ts`](src/useSpeech.ts) | 마이크 녹음·STT 요청, 브라우저 TTS |
| [`src/reports.ts`](src/reports.ts), [`src/vocabulary.ts`](src/vocabulary.ts) | 리포트·단어장 저장 |
| [`src/telemetry.ts`](src/telemetry.ts) | 사용자 동작 span, API CLIENT span, trace 전송 |
| [`.github/workflows/build.yml`](.github/workflows/build.yml) | 테스트·빌드·S3 배포 |

## 로컬 실행

**Node.js 22.12.0 이상**과 npm이 필요합니다. 먼저 BE를 `http://localhost:8080`에서 실행합니다.

```bash
npm ci
npm run dev
```

Vite가 안내하는 로컬 주소로 접속합니다. 개발 서버는 `127.0.0.1`에 바인딩하며 [`vite.config.ts`](vite.config.ts)가 `/api` 요청을 BE로 프록시합니다. FE 전용 `.env`나 `VITE_*` 설정은 사용하지 않습니다.

녹음에는 마이크 권한과 `MediaRecorder`, Web Locks를 지원하는 브라우저가 필요합니다. 운영에서는 HTTPS를 사용합니다. 녹음은 최소 500ms·최대 30초·2MiB 이하이며, 지원 형식은 WebM/Opus·MP4·Ogg/Opus 순으로 선택합니다.

### 테스트·빌드

```bash
npm test
npm run build
npm run preview
```

`npm test`는 Vitest를 실행합니다. 빌드는 TypeScript 검사 후 정적 파일을 `dist/`에 생성합니다. `preview`는 빌드 결과 확인용 서버입니다.

## 대화·저장

- 대화는 `GET /api/v1/conversation`과 `POST /api/v1/conversation/{start,restore,turn,end}`로 관리합니다. 서버 상태를 우선하고, 복원 가능한 로컬 스냅샷이 있으면 이어갑니다.
- 마지막 사용자 발화만 수정할 수 있습니다. 수정하면 revision을 높여 후속 AI 답변을 다시 생성하고 이전 응답을 폐기합니다.
- 추천은 `POST /api/v1/demo/cafe/suggestion`으로 한 번 생성합니다. 키워드를 먼저 보여 주고, “문장 보기”는 같은 예문을 공개합니다. 추천을 실제 사용자 발화로 제출하지 않습니다.
- Web Locks·BroadcastChannel·`storage` 이벤트로 탭을 동기화하며 입력 가능한 탭은 하나입니다. 다른 탭에서 사용권을 가져오면 이전 탭의 요청·녹음·TTS를 정리합니다.

| localStorage 키 | 저장 내용 |
|---|---|
| `sayscene:v1:activeConversation` | 진행 중 대화·미완료 요청·화면 상태 |
| `sayscene:v1:reports` | 사용자가 저장한 리포트 |
| `sayscene:v1:vocabulary` | 저장한 표현·뜻·예문 |

리포트는 종료 후 생성되지만 **저장 버튼을 눌러야** 보관됩니다. 로그인·계정별 서버 영구 저장은 없으므로 같은 브라우저 프로필을 쓰는 사람은 저장 내용을 볼 수 있습니다. 브라우저 데이터를 지우면 로컬 기록도 사라집니다.

## 사용자 동작 tracing

OpenTelemetry는 [`src/main.tsx`](src/main.tsx)에서 초기화하며 `service.name=ss-fe`를 사용합니다. 알려진 same-origin API만 `tracedFetch`로 계측하고, 비동기 호출에는 `TraceAction`을 명시적으로 전달합니다. 전역 fetch를 패치하지 않습니다.

- `speech.turn`은 STT 요청부터 후속 대화 응답 처리까지를 같은 trace로 연결합니다. 녹음 시간이나 TTS 재생 완료 시간은 포함하지 않습니다. 번역·추천·조회는 독립 동작입니다.
- `session.id`는 페이지 메모리의 임의 UUID입니다. 새로고침하면 바뀌며 실제 사용자·대화·재시도 식별자와 별개입니다.
- payload·오디오·URL query·임의 헤더·예외 원문은 기록하지 않습니다. 초기화·전송 실패가 업무 요청을 막지 않는 best-effort 수집입니다.
- OTLP/JSON은 same-origin `POST /api/telemetry/traces`로 전송합니다. BE의 `BROWSER_TELEMETRY_OTLP_ENDPOINT`를 설정해야 수집기로 전달됩니다. Collector 주소나 비밀 키를 FE에 넣지 않습니다.

API를 추가하면 FE `telemetry.ts`와 BE relay의 허용 경로를 함께 갱신합니다. 수집 경로와 Tempo 조회는 [BE README](https://github.com/say-scene/ss-be)와 [tracing 문서](https://github.com/say-scene/ss-docs/blob/main/user-action-tracing.md)를 참고합니다. 운영에서는 이 경로로 수집한 FE→BE trace를 Grafana·Tempo에서 조회합니다.

## 배포

GitHub Actions는 main push·PR·수동 실행에서 `npm ci` → 테스트 → 빌드를 수행합니다. main ref에서는 AWS OIDC Role `gha-ss-fe-deploy`로 `ap-northeast-2`의 S3에 배포합니다. 저장소 변수 `AWS_ACCOUNT_ID`, `S3_BUCKET`이 필요합니다.

- 해시가 붙은 assets: `public,max-age=31536000,immutable`
- `index.html`: `no-cache`
- 업로드 객체에 commit SHA·workflow run ID 메타데이터 기록
- CloudFront invalidation 단계 없음

운영 정적 파일은 CloudFront·S3에서 제공하고 `/api`는 BE로 라우팅합니다. 전체 구성은 [PRD·아키텍처](https://github.com/say-scene/ss-docs/blob/main/english-speaking-prd-architecture-v1.md), 인프라는 [ss-k8s](https://github.com/say-scene/ss-k8s), 배포 절차는 [FE CI/CD 문서](https://github.com/say-scene/ss-docs/blob/main/cicd/ss-fe/ss-fe-cicd-runbook-v1.md)를 참고합니다.
