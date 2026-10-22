import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { currentRequestContext } from './request-context';

@Injectable()
export class TelemetryContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() === 'http') {
      const request = context
        .switchToHttp()
        .getRequest<{ user?: { id: string; role: string } }>();
      const current = currentRequestContext();
      if (current && request.user) {
        current.userId = request.user.id;
        current.role = request.user.role;
      }
    }
    return next.handle();
  }
}
