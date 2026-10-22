import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getMetrics } from './metrics';

export function canScrapeMetrics(
  req: Pick<Request, 'headers' | 'socket'>,
): boolean {
  const token = process.env.METRICS_TOKEN;
  if (!token)
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
      req.socket.remoteAddress ?? '',
    );
  const actual = req.headers.authorization || '';
  // Hash first so length/timing do not disclose the configured bearer credential.
  return timingSafeEqual(
    createHash('sha256').update(actual).digest(),
    createHash('sha256').update(`Bearer ${token}`).digest(),
  );
}
@Controller('metrics')
export class MetricsController {
  @Get()
  async metrics(@Req() req: Request, @Res() res: Response) {
    if (process.env.METRICS_ENABLED === 'false') {
      res.status(404).send('Not Found');
      return;
    }
    if (!canScrapeMetrics(req)) {
      res.status(403).send('Forbidden');
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res
      .type(getMetrics().registry.contentType)
      .send(await getMetrics().render());
  }
}
