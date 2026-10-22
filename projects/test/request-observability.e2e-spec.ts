import {
  Controller,
  Get,
  ForbiddenException,
  Param,
  RequestMethod,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RequestTelemetryMiddleware } from '../src/observability/request-telemetry.middleware';
import { requestContext } from '../src/observability/request-context';
import { MetricsController } from '../src/observability/metrics.controller';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { getMetrics } from '../src/observability/metrics';

@Controller('test')
class TestController {
  @Get(':id')
  async read(@Param('id') id: string) {
    const before = requestContext.getStore()?.requestId;
    await new Promise((resolve) => setTimeout(resolve, id === 'a' ? 5 : 1));
    if (id === 'forbidden') throw new ForbiddenException();
    return { before, after: requestContext.getStore()?.requestId };
  }
}
describe('request observability over HTTP', () => {
  let app: INestApplication;
  const token = process.env.METRICS_TOKEN;
  beforeAll(async () => {
    delete process.env.METRICS_TOKEN;
    const module = await Test.createTestingModule({
      controllers: [TestController, MetricsController],
    }).compile();
    app = module.createNestApplication();
    const middleware = new RequestTelemetryMiddleware();
    app.use(middleware.use.bind(middleware));
    app.setGlobalPrefix('api/v1', {
      exclude: [{ path: 'metrics', method: RequestMethod.GET }],
    });
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    getMetrics().destroy();
    if (token !== undefined) process.env.METRICS_TOKEN = token;
  });
  it('returns IDs for success, 403, 404 and malformed JSON while preserving async isolation', async () => {
    const [a, b, forbidden, missing, invalid] = await Promise.all([
      request(app.getHttpServer()).get('/api/v1/test/a?password=QUERY_CANARY'),
      request(app.getHttpServer()).get('/api/v1/test/b'),
      request(app.getHttpServer()).get('/api/v1/test/forbidden'),
      request(app.getHttpServer()).get('/no-such-route/SENSITIVE_ID'),
      request(app.getHttpServer())
        .post('/api/v1/test/a')
        .set('Content-Type', 'application/json')
        .send('{invalid'),
    ]);
    expect(a.body.data.before).toBe(a.headers['x-request-id']);
    expect(a.body.data.after).toBe(a.headers['x-request-id']);
    expect(b.body.data.after).not.toBe(a.body.data.after);
    expect(forbidden.status).toBe(403);
    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(400);
    for (const response of [a, b, forbidden, missing, invalid])
      expect(response.headers['x-request-id']).toMatch(/^[a-f\d-]{36}$/);
  });
  it('serves raw metrics outside the global prefix and excludes private URLs/query parameters from labels', async () => {
    const response = await request(app.getHttpServer()).get('/metrics');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/openmetrics-text',
    );
    expect(response.text).toContain('http_requests_total');
    expect(response.text).toContain('/api/v1/test/:id');
    expect(response.text).not.toContain('SENSITIVE_ID');
    expect(response.text).not.toContain('QUERY_CANARY');
    expect(response.text).not.toContain('"success":');
  });
});
