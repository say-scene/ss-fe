import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Context, type Span, type Tracer } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, WebTracerProvider, type SpanExporter } from '@opentelemetry/sdk-trace-web';

type TraceError = 'request_failed' | 'aborted' | 'invalid_response';
export type TraceAction = {
  readonly context: Context;
  setError(type?: TraceError): void;
  end(): void;
};

const actions = new Set(['speech.turn', 'conversation.start', 'conversation.resume', 'conversation.sync',
  'conversation.turn', 'conversation.end', 'conversation.reply', 'translation', 'suggestion', 'lookup',
  'report', 'demo.cafe', 'demo.echo', 'api.request']);
const routes = new Map([
  ['/api/v1/conversation', 'GET'], ['/api/v1/conversation/start', 'POST'],
  ['/api/v1/conversation/restore', 'POST'], ['/api/v1/conversation/turn', 'POST'],
  ['/api/v1/conversation/end', 'POST'], ['/api/v1/stt', 'POST'], ['/api/v1/translate', 'POST'],
  ['/api/v1/lookup', 'POST'], ['/api/v1/report', 'POST'], ['/api/v1/demo/cafe', 'POST'],
  ['/api/v1/demo/cafe/reply', 'POST'], ['/api/v1/demo/cafe/suggestion', 'POST'], ['/api/v1/demo/echo', 'POST'],
]);
const propagator = new W3CTraceContextPropagator();
const noAction: TraceAction = { context: ROOT_CONTEXT, setError() {}, end() {} };
let provider: WebTracerProvider | undefined;
let tracer: Tracer | undefined;
let sessionId: string | undefined;

// This ID is deliberately memory-only: reloads and new pages get a new opaque ID.
function telemetrySession() { return sessionId ??= crypto.randomUUID(); }
function safely(work: () => void) { try { work(); } catch { /* Observability must not alter application behavior. */ } }
function errorType(error: unknown, signal?: AbortSignal | null): TraceError {
  try { if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) return 'aborted'; } catch { /* Use a fixed fallback. */ }
  return 'request_failed';
}
function markError(span: Span, type: TraceError) {
  safely(() => { span.setAttribute('error.type', type); span.setStatus({ code: SpanStatusCode.ERROR }); });
}

/** Explicit initialization keeps component tests and non-browser imports free of network exports. */
export function initializeTracing(exporter?: SpanExporter): WebTracerProvider | undefined {
  if (provider) return provider;
  let next: WebTracerProvider | undefined;
  try {
    const processor = new BatchSpanProcessor(exporter ?? new OTLPTraceExporter({
      url: new URL('/api/telemetry/traces', window.location.origin).href,
      timeoutMillis: 1000,
    }), { maxQueueSize: 256, maxExportBatchSize: 16, scheduledDelayMillis: 5000, exportTimeoutMillis: 1500 });
    next = new WebTracerProvider({ resource: resourceFromAttributes({ 'service.name': 'ss-fe' }), spanProcessors: [processor] });
    tracer = next.getTracer('sayscene.browser');
    provider = next;
    return provider;
  } catch {
    // A blocked exporter or unavailable browser API must not prevent rendering.
    void next?.shutdown().catch(() => {});
    return undefined;
  }
}

export function startAction(name: string): TraceAction {
  if (!tracer) return noAction;
  try {
    const span = tracer.startSpan(actions.has(name) ? name : 'api.request', {
      kind: SpanKind.INTERNAL, attributes: { 'session.id': telemetrySession() },
    }, ROOT_CONTEXT);
    const actionContext = trace.setSpan(ROOT_CONTEXT, span);
    let ended = false;
    return {
      context: actionContext,
      setError(type = 'request_failed') {
        if (!ended) markError(span, ['request_failed', 'aborted', 'invalid_response'].includes(type) ? type : 'request_failed');
      },
      end() { if (!ended) { ended = true; safely(() => span.end()); } },
    };
  } catch { return noAction; }
}

export async function runAction<T>(name: string, work: (action: TraceAction) => Promise<T>, parent?: TraceAction): Promise<T> {
  const action = parent ?? startAction(name);
  try { return await work(action); }
  catch (error) { safely(() => action.setError(errorType(error))); throw error; }
  finally { if (!parent) safely(() => action.end()); }
}

/** Only known same-origin API routes are instrumented; payloads and query strings are never inspected. */
export async function tracedFetch(url: string, init?: RequestInit, action?: TraceAction): Promise<Response> {
  const activeTracer = tracer;
  if (!activeTracer) return fetch(url, init);
  let request: { route: string; method: string } | undefined;
  try {
    const parsed = new URL(url, window.location.href);
    const route = parsed.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (parsed.origin === window.location.origin && !parsed.username && !parsed.password && routes.get(route) === method)
      request = { route, method };
  } catch { /* Invalid input remains the native fetch implementation's responsibility. */ }
  if (!request) return fetch(url, init);
  const { route, method } = request;

  const parent = action ?? startAction('api.request');
  let span: Span | undefined;
  let requestInit = init;
  try {
    span = activeTracer.startSpan(`${method} ${route}`, { kind: SpanKind.CLIENT,
      attributes: { 'session.id': telemetrySession(), 'http.request.method': method, 'http.route': route } }, parent.context);
    const headers = new Headers(init?.headers);
    propagator.inject(trace.setSpan(parent.context, span), headers, { set(carrier, key, value) { carrier.set(key, value); } });
    requestInit = { ...init, headers };
  } catch { safely(() => span?.end()); span = undefined; }
  try {
    const response = await fetch(url, requestInit);
    if (span && Number.isInteger(response.status)) safely(() => span!.setAttribute('http.response.status_code', response.status));
    if (response.status >= 400) {
      if (span) markError(span, 'request_failed');
      if (!action) safely(() => parent.setError());
    }
    return response;
  } catch (error) {
    const type = errorType(error, init?.signal);
    if (span) markError(span, type);
    if (!action) safely(() => parent.setError(type));
    throw error;
  } finally {
    safely(() => span?.end());
    if (!action) safely(() => parent.end());
  }
}
