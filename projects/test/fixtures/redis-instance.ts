import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { NotificationsGateway } from '../../src/modules/gateways/notifications.gateway';
import { AuthTokenStoreService } from '../../src/modules/auth/jwt/auth-token-store';
import type { NotificationResponse } from '../../src/modules/notifications/types/notification.types';
import { ConfigService } from '@nestjs/config';
import { SocketRedisService } from '../../src/infrastructure/cache/socket-redis.service';
import { NotificationsIoAdapter } from '../../src/modules/gateways/notifications-io.adapter';
// Test-only process entrypoint for cross-instance Redis checks.
import '../../src/observability/initialize';
import { Test } from '@nestjs/testing';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { StructuredLogger } from '../../src/observability/structured-logger';
import { RequestTelemetryMiddleware } from '../../src/observability/request-telemetry.middleware';
import { TelemetryContextInterceptor } from '../../src/observability/telemetry-context.interceptor';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
async function main() {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication({ bufferLogs: true });
  const socketRedis = app.get(SocketRedisService);
  await socketRedis.connect();
  app.useWebSocketAdapter(
    new NotificationsIoAdapter(
      app,
      app.get(ConfigService).getOrThrow<string[]>('app.frontendUrls'),
      socketRedis,
    ),
  );
  app.useLogger(app.get(StructuredLogger));
  const middleware = app.get(RequestTelemetryMiddleware);
  app.use(middleware.use.bind(middleware));
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'metrics', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    app.get(TelemetryContextInterceptor),
    new ResponseInterceptor(),
  );
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer() as import('node:http').Server;
  process.send?.({
    ready: true,
    port: (server.address() as import('node:net').AddressInfo).port,
  });
  // IPC belongs only to this test process; no debug/emit endpoint is exposed by production.
  process.on('message', (message: unknown) => {
    if (message === 'stop') void app.close().then(() => process.exit(0));
    else if (message && typeof message === 'object' && 'requestId' in message) {
      const command = message as {
        requestId: string;
        kind: string;
        notification: NotificationResponse;
      };
      void (async () => {
        if (command.kind === 'revoke')
          await app
            .get(AuthTokenStoreService)
            .revokeUserTokensIssuedBefore(command.notification.userId);
        else if (command.kind === 'refresh')
          app
            .get(NotificationsGateway)
            .emitRefresh(command.notification.userId);
        else app.get(NotificationsService).emitCreated(command.notification);
        process.send?.({ requestId: command.requestId });
      })().catch(() =>
        process.send?.({ requestId: command.requestId, failed: true }),
      );
    }
  });
}
void main().catch(() => {
  process.send?.({ failed: true });
  process.exit(1);
});
