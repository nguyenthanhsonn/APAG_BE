import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { performance } from 'node:perf_hooks';
import { trace } from '@opentelemetry/api';
import { getMetrics } from './metrics';
import { getLogger } from './structured-logger';
import { correlationContext, runRequestContext } from './request-context';

type AuthRequest = Request & { user?: { id?: string; role?: string } };
export function routeTemplate(req: Request): string {
  const route = (req.route as { path?: unknown } | undefined)?.path;
  // No raw URL, query string or dynamic IDs become metric labels; unknown URLs all share one series.
  return typeof route === 'string'
    ? `${req.baseUrl || ''}${route}`
    : 'unmatched';
}
@Injectable()
export class RequestTelemetryMiddleware {
  use(req: AuthRequest, res: Response, next: NextFunction) {
    const current = correlationContext(
      req.headers['x-request-id'],
      req.headers['x-correlation-id'],
    );
    const started = performance.now();
    const serverSpan = trace.getActiveSpan();
    const spanContext = serverSpan?.spanContext();
    res.setHeader('X-Request-ID', current.requestId);
    res.setHeader('X-Correlation-ID', current.correlationId);
    serverSpan?.setAttributes({
      'app.request_id': current.requestId,
      'app.correlation_id': current.correlationId,
    });
    let finished = false;
    const finish = (aborted = false) => {
      if (finished) return;
      finished = true;
      if (req.path === '/metrics') return;
      runRequestContext(current, () => {
        const durationMs = performance.now() - started;
        const status = aborted ? 499 : res.statusCode;
        const path = routeTemplate(req);
        const fields = {
          event: 'http.request',
          method: req.method,
          path,
          status,
          durationMs,
          requestId: current.requestId,
          correlationId: current.correlationId,
          ...(req.user?.id ? { userId: req.user.id, role: req.user.role } : {}),
          ...(spanContext
            ? {
                traceId: spanContext.traceId,
                spanId: spanContext.spanId,
                traceSampled: Boolean(spanContext.traceFlags & 1),
              }
            : {}),
          aborted,
        };
        getMetrics().recordHttp(
          req.method,
          path,
          status,
          durationMs / 1000,
          spanContext?.traceFlags ? spanContext.traceId : undefined,
        );
        serverSpan?.setAttribute('http.route', path);
        if (status >= 500) getLogger().error(fields, 'HTTP request completed');
        else if (status >= 400)
          getLogger().warn(fields, 'HTTP request completed');
        else getLogger().info(fields, 'HTTP request completed');
      });
    };
    res.once('finish', () => finish());
    res.once('close', () => {
      if (!res.writableFinished) finish(true);
    });
    runRequestContext(current, next);
  }
}
