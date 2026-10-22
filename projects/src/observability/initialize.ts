// This module MUST be loaded before Nest, HTTP, pg and generated Prisma imports (including in watch/prod).
import { config } from 'dotenv';
import { join } from 'node:path';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { currentRequestContext } from './request-context';
import type { ClientRequest } from 'node:http';
import { SafeSpanExporter } from './safe-span-exporter';

config({ path: join(__dirname, '..', '..', '.env'), quiet: true });
let sdk: NodeSDK | undefined;
export function initializeTelemetry(
  exporter?: import('@opentelemetry/sdk-trace-base').SpanExporter,
) {
  if (sdk || (process.env.OTEL_ENABLED !== 'true' && !exporter)) return sdk;
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    'http://127.0.0.1:4318/v1/traces';
  const ratio = Number(process.env.OTEL_TRACES_SAMPLER_ARG ?? 0.1);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)
    throw new Error('OTEL_TRACES_SAMPLER_ARG must be between 0 and 1');
  sdk = new NodeSDK({
    autoDetectResources: false,
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME || 'apag-backend',
      'service.version': '0.1.0',
      'deployment.environment.name': process.env.NODE_ENV || 'development',
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(exporter ? 1 : ratio),
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new SafeSpanExporter(
          exporter ??
            new OTLPTraceExporter({ url: endpoint, timeoutMillis: 3000 }),
        ),
        {
          maxQueueSize: 2048,
          maxExportBatchSize: 256,
          scheduledDelayMillis: 1000,
          exportTimeoutMillis: 5000,
        },
      ),
    ],
    instrumentations: [
      new HttpInstrumentation({
        requestHook: (_span, req) => {
          const ids = currentRequestContext();
          if (ids && 'setHeader' in req) {
            (req as ClientRequest).setHeader('X-Request-ID', ids.requestId);
            (req as ClientRequest).setHeader(
              'X-Correlation-ID',
              ids.correlationId,
            );
          }
        },
        ignoreIncomingRequestHook: (req) =>
          req.url?.split('?')[0] === '/metrics',
        headersToSpanAttributes: {
          client: { requestHeaders: [], responseHeaders: [] },
          server: { requestHeaders: [], responseHeaders: [] },
        },
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PrismaInstrumentation(),
      new PgInstrumentation({
        enhancedDatabaseReporting: false,
        addSqlCommenterCommentToQueries: false,
        enableTraceContextPropagation: false,
      }),
      new UndiciInstrumentation({
        requireParentforSpans: true,
        requestHook: (_span, req) => {
          const ids = currentRequestContext();
          if (ids) {
            req.addHeader('X-Request-ID', ids.requestId);
            req.addHeader('X-Correlation-ID', ids.correlationId);
          }
        },
      }),
    ],
  });
  sdk.start();
  return sdk;
}
export async function shutdownTelemetry() {
  await sdk?.shutdown();
  sdk = undefined;
}
initializeTelemetry();
