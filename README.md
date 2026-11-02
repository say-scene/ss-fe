# ss_fe

## 사용자 동작 tracing

OpenTelemetry는 `src/main.tsx`에서 초기화한다. 알려진 same-origin API만 `tracedFetch`로 계측하며, 비동기 호출은 명시적인 `TraceAction`을 전달한다. 전역 fetch를 패치하지 않는다.

- 발화 한 번의 STT → 대화 생성은 `speech.turn` 하나의 trace로 연결한다. 번역·추천·조회 등 별도 동작은 독립된 trace다.
- `session.id`는 페이지 메모리의 별도 임의 UUID다. 새로고침하면 회전하며 실제 사용자/대화/재시도 식별자를 기록하거나 재사용하지 않는다.
- payload, 오디오, URL query, 임의 헤더, 예외 원문은 수집하지 않는다. 수집 실패는 업무 요청을 막지 않는다.
- OTLP/JSON은 same-origin `/api/telemetry/traces`로 전송한다. BE의 `BROWSER_TELEMETRY_OTLP_ENDPOINT`를 설정해야 수집기로 전달된다. Collector 주소나 비밀 키를 FE에 넣지 않는다.

API를 추가할 때는 `telemetry.ts`의 허용 경로와 BE relay의 허용 경로를 함께 갱신한다. 세부 수집 경로와 Tempo 조회 예시는 BE README를 참고한다.

```sh
npm ci
npm test
npm run build
```
