// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import { InMemorySpanExporter, WebTracerProvider, type SpanExporter } from '@opentelemetry/sdk-trace-web';

type Telemetry = typeof import('./telemetry');
let telemetry: Telemetry;
let provider: ReturnType<Telemetry['initializeTracing']>;
let exporter: InMemorySpanExporter;
const response = () => new Response('{}', { status: 200 });
function initialize() {
  exporter = new InMemorySpanExporter();
  provider = telemetry.initializeTracing(exporter);
  expect(provider).toBeDefined();
  return provider!;
}
async function spans() { await provider!.forceFlush(); return exporter.getFinishedSpans(); }

beforeEach(async () => { vi.resetModules(); telemetry = await import('./telemetry'); });
afterEach(async () => {
  vi.restoreAllMocks();
  await provider?.shutdown().catch(() => {});
  provider = undefined;
  vi.unstubAllGlobals();
});

describe('explicit browser tracing', () => {
  it('keeps uninitialized telemetry completely transparent to fetch', async () => {
    const result = response();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(result);
    vi.stubGlobal('fetch', fetcher);
    const init = { method: 'POST', body: 'private content' };
    await expect(telemetry.runAction('speech.turn', action => telemetry.tracedFetch('/api/v1/stt', init, action))).resolves.toBe(result);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/v1/stt', init);
  });

  it('exports one parent and distinct HTTP children across awaits, with matching W3C headers', async () => {
    initialize();
    const result = response();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(result);
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const originalHeaders = { 'Content-Type': 'application/json', Authorization: 'do-not-record' };
    const body = JSON.stringify({ text: 'utterance-do-not-record', sessionId: 'business-session-do-not-record' });
    await telemetry.runAction('speech.turn', async action => {
      expect(await telemetry.tracedFetch('/api/v1/stt', { method: 'POST', body: new FormData() }, action)).toBe(result);
      await Promise.resolve();
      await telemetry.tracedFetch('/api/v1/conversation/turn?private=query-do-not-record', {
        method: 'POST', body, headers: originalHeaders, signal: controller.signal, credentials: 'same-origin',
      }, action);
    });
    const all = await spans();
    const parent = all.find(span => span.name === 'speech.turn')!;
    const children = all.filter(span => span.kind === SpanKind.CLIENT);
    expect(all).toHaveLength(3);
    expect(children).toHaveLength(2);
    expect(new Set(all.map(span => span.spanContext().traceId)).size).toBe(1);
    expect(new Set(all.map(span => span.spanContext().spanId)).size).toBe(3);
    children.forEach((child, index) => {
      expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
      const [version, traceId, spanId, flags] = new Headers(fetcher.mock.calls[index][1]?.headers).get('traceparent')!.split('-');
      expect([version, traceId, spanId, flags]).toEqual(['00', child.spanContext().traceId, child.spanContext().spanId, '01']);
    });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ body, signal: controller.signal, credentials: 'same-origin' });
    expect(originalHeaders).not.toHaveProperty('traceparent');
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Authorization')).toBe('do-not-record');
    for (const span of all) {
      expect(span.resource.attributes).toEqual({ 'service.name': 'ss-fe' });
      expect(span.instrumentationScope.name).toBe('sayscene.browser');
      expect(span.events).toEqual([]);
      expect(span.attributes['session.id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(Object.keys(span.attributes).every(key => ['session.id', 'http.request.method', 'http.route', 'http.response.status_code'].includes(key))).toBe(true);
    }
    const serialized = JSON.stringify(all.map(span => ({ name: span.name, attributes: span.attributes, events: span.events, status: span.status })));
    expect(serialized).not.toMatch(/do-not-record|private|Authorization|Content-Type/);
    expect(children[1].attributes['http.route']).toBe('/api/v1/conversation/turn');
  });

  it('isolates concurrent actions but correlates their page with one separate anonymous ID', async () => {
    initialize();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetcher);
    const first = telemetry.runAction('speech.turn', async action => {
      await waiting;
      await telemetry.tracedFetch('/api/v1/stt', { method: 'POST' }, action);
    });
    await telemetry.runAction('translation', async action => {
      await telemetry.tracedFetch('/api/v1/translate', { method: 'POST' }, action);
    });
    release(); await first;
    const all = await spans();
    expect(new Set(all.map(span => span.spanContext().traceId)).size).toBe(2);
    expect(new Set(all.map(span => span.attributes['session.id'])).size).toBe(1);
    expect(all.filter(span => !span.parentSpanContext).map(span => span.name).sort()).toEqual(['speech.turn', 'translation']);
  });

  it('reuses a supplied parent without ending it, and ends the owner idempotently', async () => {
    initialize();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response()));
    const action = telemetry.startAction('speech.turn');
    await telemetry.runAction('conversation.turn', async parent => {
      expect(parent).toBe(action);
      await telemetry.tracedFetch('/api/v1/conversation/turn', { method: 'POST' }, parent);
    }, action);
    expect((await spans()).map(span => span.name)).toEqual(['POST /api/v1/conversation/turn']);
    action.end(); action.end();
    expect((await spans()).filter(span => span.name === 'speech.turn')).toHaveLength(1);
  });

  it('does not turn a recovered conflict into an action-level failure', async () => {
    initialize();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(response()).mockResolvedValueOnce(response()));
    await telemetry.runAction('conversation.turn', async action => {
      await telemetry.tracedFetch('/api/v1/conversation/turn', { method: 'POST' }, action);
      await telemetry.tracedFetch('/api/v1/conversation', undefined, action);
      await telemetry.tracedFetch('/api/v1/conversation/turn', { method: 'POST' }, action);
    });
    const all = await spans();
    expect(all.find(span => span.name === 'conversation.turn')!.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(all.filter(span => span.status.code === SpanStatusCode.ERROR)).toHaveLength(1);
    expect(all.find(span => span.attributes['http.response.status_code'] === 409)!.kind).toBe(SpanKind.CLIENT);
  });

  it('preserves HTTP error responses and marks standalone fallback traces', async () => {
    initialize();
    const result = new Response('{}', { status: 422 });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(result));
    await expect(telemetry.tracedFetch('/api/v1/stt', { method: 'POST' })).resolves.toBe(result);
    const all = await spans();
    expect(all.map(span => span.name)).toEqual(['POST /api/v1/stt', 'api.request']);
    expect(all.every(span => span.status.code === SpanStatusCode.ERROR)).toBe(true);
    expect(all.every(span => span.attributes['error.type'] === 'request_failed')).toBe(true);
  });

  it('preserves the original cancellation error and signal without recording its message', async () => {
    initialize();
    const controller = new AbortController(); controller.abort();
    const failure = new DOMException('private utterance must not be recorded', 'AbortError');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(failure);
    vi.stubGlobal('fetch', fetcher);
    await expect(telemetry.runAction('speech.turn', action => telemetry.tracedFetch('/api/v1/stt', {
      method: 'POST', signal: controller.signal,
    }, action))).rejects.toBe(failure);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal).toBe(controller.signal);
    const all = await spans();
    expect(all.every(span => span.attributes['error.type'] === 'aborted')).toBe(true);
    expect(all.every(span => !span.events.length && !span.status.message)).toBe(true);
  });

  it('never adds trace headers or spans to collection, unknown, wrong-method, or cross-origin calls', async () => {
    initialize();
    const failure = new Error('network failure');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(failure);
    vi.stubGlobal('fetch', fetcher);
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'unchanged' };
    for (const url of ['/api/telemetry/traces', '/api/v1/unknown', '/actuator/health',
      'https://untrusted.invalid/api/v1/stt', '/api/v1/conversation']) {
      await expect(telemetry.tracedFetch(url, init)).rejects.toBe(failure);
    }
    expect(fetcher).toHaveBeenCalledTimes(5);
    fetcher.mock.calls.forEach(call => expect(call[1]).toBe(init));
    expect(await spans()).toEqual([]);
  });

  it('falls back to the original request once when SDK span creation fails', async () => {
    const active = initialize();
    vi.spyOn(active.getTracer('sayscene.browser'), 'startSpan').mockImplementation(() => { throw new Error('SDK unavailable'); });
    const result = response();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(result);
    vi.stubGlobal('fetch', fetcher);
    const init = { method: 'POST', body: 'unchanged' };
    await expect(telemetry.tracedFetch('/api/v1/stt', init)).resolves.toBe(result);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/v1/stt', init);
    expect(await spans()).toEqual([]);
  });

  it('keeps action error/end methods fail-open and restricts caller-provided action names', async () => {
    initialize();
    const action = telemetry.startAction('private utterance must not be recorded');
    action.setError('invalid_response'); action.end();
    const exported = await spans();
    expect(exported[0].name).toBe('api.request');
    expect(exported[0].attributes['error.type']).toBe('invalid_response');
    const broken = telemetry.startAction('translation');
    const span = trace.getSpan(broken.context)!;
    vi.spyOn(span, 'setAttribute').mockImplementation(() => { throw new Error('SDK unavailable'); });
    vi.spyOn(span, 'end').mockImplementation(() => { throw new Error('SDK unavailable'); });
    expect(() => { broken.setError(); broken.end(); broken.end(); }).not.toThrow();
  });

  it('does not await or propagate exporter failures into business requests', async () => {
    const failing: SpanExporter = {
      export: vi.fn((_spans, callback) => callback({ code: ExportResultCode.FAILED, error: new Error('collector unavailable') })),
      shutdown: async () => {},
    };
    provider = telemetry.initializeTracing(failing);
    const result = response();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(result));
    await expect(telemetry.runAction('translation', action => telemetry.tracedFetch('/api/v1/translate', { method: 'POST' }, action))).resolves.toBe(result);
    expect(failing.export).not.toHaveBeenCalled();
    await provider!.forceFlush().catch(() => {});
    expect(failing.export).toHaveBeenCalledOnce();
  });

  it('fails open when initialization cannot obtain a tracer', async () => {
    vi.spyOn(WebTracerProvider.prototype, 'getTracer').mockImplementationOnce(() => { throw new Error('SDK unavailable'); });
    expect(() => { provider = telemetry.initializeTracing(new InMemorySpanExporter()); }).not.toThrow();
    expect(provider).toBeUndefined();
    const result = response();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(result);
    vi.stubGlobal('fetch', fetcher);
    const init = { method: 'POST' };
    await expect(telemetry.tracedFetch('/api/v1/stt', init)).resolves.toBe(result);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/v1/stt', init);
  });
});
