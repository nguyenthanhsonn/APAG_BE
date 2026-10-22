import pino, { type DestinationStream, type Logger } from 'pino';
import { Injectable, type LoggerService } from '@nestjs/common';
import { logContext } from './request-context';
import { sanitizeLog } from './safe-log';

export function createStructuredLogger(
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      level:
        process.env.LOG_LEVEL === 'verbose'
          ? 'trace'
          : process.env.LOG_LEVEL || 'info',
      base: { service: process.env.OTEL_SERVICE_NAME || 'apag-backend' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          'password',
          'accessToken',
          'refreshToken',
          'authorization',
          'cookie',
          'smtp.pass',
        ],
        censor: '[REDACTED]',
      },
      mixin: logContext,
      hooks: {
        logMethod(args, method) {
          // Sanitize before formatting strings or serializing errors; no req/res/body serializers.
          Reflect.apply(
            method,
            this,
            args.map((value) => sanitizeLog(value)),
          );
        },
      },
    },
    destination,
  );
}
let rootLogger: Logger | undefined;
export function getLogger(): Logger {
  return (rootLogger ??= createStructuredLogger());
}

/** Tất cả Nest Logger hiện có đi vào cùng JSON logger và cùng async request context. */
@Injectable()
export class StructuredLogger implements LoggerService {
  log(message: unknown, ...params: unknown[]) {
    this.write('info', message, params);
  }
  error(message: unknown, ...params: unknown[]) {
    this.write('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]) {
    this.write('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]) {
    this.write('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]) {
    this.write('trace', message, params);
  }
  fatal(message: unknown, ...params: unknown[]) {
    this.write('fatal', message, params);
  }
  private write(
    level: 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal',
    message: unknown,
    params: unknown[],
  ) {
    const candidate = params.at(-1);
    const source =
      typeof candidate === 'string' &&
      /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(candidate)
        ? candidate
        : undefined;
    // Nest's stack argument is deliberately excluded: raw driver stacks can contain secrets.
    const fields = {
      source,
      ...(message && typeof message === 'object' ? message : {}),
    };
    getLogger()[level](
      fields,
      typeof message === 'string' ? message : 'application.event',
    );
  }
}
