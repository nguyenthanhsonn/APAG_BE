import {
  Global,
  Module,
  Injectable,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { StructuredLogger } from './structured-logger';
import { MetricsController } from './metrics.controller';
import { RequestTelemetryMiddleware } from './request-telemetry.middleware';
import { TelemetryContextInterceptor } from './telemetry-context.interceptor';
import { getMetrics } from './metrics';

@Injectable()
class ObservabilityLifecycle implements OnApplicationShutdown {
  async onApplicationShutdown() {
    getMetrics().destroy();
    const { shutdownTelemetry } = await import('./initialize');
    await shutdownTelemetry();
  }
}
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    StructuredLogger,
    RequestTelemetryMiddleware,
    TelemetryContextInterceptor,
    ObservabilityLifecycle,
  ],
  exports: [
    StructuredLogger,
    RequestTelemetryMiddleware,
    TelemetryContextInterceptor,
  ],
})
export class ObservabilityModule {}
