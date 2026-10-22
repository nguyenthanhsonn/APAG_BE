import './observability/initialize';

async function bootstrap() {
  const [
    { ValidationPipe, Logger, RequestMethod },
    { ConfigService },
    { NestFactory },
  ] = await Promise.all([
    import('@nestjs/common'),
    import('@nestjs/config'),
    import('@nestjs/core'),
  ]);

  const [{ HttpExceptionFilter }, { ResponseInterceptor }] = await Promise.all([
    import('./common/filters/http-exception.filter'),
    import('./common/interceptors/response.interceptor'),
  ]);

  const { AppModule } = await import('./app.module');

  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const { StructuredLogger } =
    await import('./observability/structured-logger');
  const { RequestTelemetryMiddleware } =
    await import('./observability/request-telemetry.middleware');
  const { TelemetryContextInterceptor } =
    await import('./observability/telemetry-context.interceptor');
  app.useLogger(app.get(StructuredLogger));
  const telemetry = app.get(RequestTelemetryMiddleware);
  app.use(telemetry.use.bind(telemetry));
  app.enableShutdownHooks();
  const { NotificationsIoAdapter } =
    await import('./modules/gateways/notifications-io.adapter');
  const { SocketRedisService } =
    await import('./infrastructure/cache/socket-redis.service');
  const socketRedis = app.get(SocketRedisService);
  await socketRedis.connect();
  app.useWebSocketAdapter(
    new NotificationsIoAdapter(
      app,
      configService.getOrThrow<string[]>('app.frontendUrls'),
      socketRedis,
    ),
  );

  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'metrics', method: RequestMethod.GET }],
  });
  app.enableCors({
    origin: configService.get<string[]>('app.frontendUrls'),
    credentials: true,
    exposedHeaders: ['X-Request-ID', 'X-Correlation-ID'],
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

  const swaggerEnabled =
    configService.getOrThrow<boolean>('app.swaggerEnabled');
  if (swaggerEnabled) {
    const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CSMTS API')
      .setDescription(
        'Comprehensive Student Management and Training System API documentation',
      )
      .setVersion('1.0.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Nhập accessToken nhận được từ POST /api/v1/auth/login',
        },
        'access-token',
      )
      .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig, {
      ignoreGlobalPrefix: false,
    });

    SwaggerModule.setup('api/docs', app, swaggerDocument, {
      jsonDocumentUrl: 'api/docs-json',
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
      customSiteTitle: 'CSMTS API Docs',
    });
  }

  const port = Number(configService.get('app.port') ?? 5050);

  const host = configService.getOrThrow<string>('app.host');
  await app.listen(port, host);
  const logger = new Logger('Bootstrap');
  logger.log(`Backend listening on ${host}:${port}/api/v1`);
  if (swaggerEnabled) logger.log('Swagger available at /api/docs');
}

void bootstrap().catch(async (error: unknown) => {
  const { getLogger } = await import('./observability/structured-logger');
  const { safeError } = await import('./observability/safe-log');
  getLogger().fatal(
    { event: 'application.startup_failed', error: safeError(error) },
    'Startup failed; check configuration and dependency availability',
  );
  const { shutdownTelemetry } = await import('./observability/initialize');
  await shutdownTelemetry();
  process.exitCode = 1;
});
