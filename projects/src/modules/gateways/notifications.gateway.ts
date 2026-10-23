import { type OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import type { NotificationResponse } from '../notifications/types/notification.types';
import { getMetrics } from '../../observability/metrics';

type NotificationSocket = Socket & {
  data: { userId: string; role: string; claims: JwtPayload };
};

@WebSocketGateway({ namespace: 'notifications' })
export class NotificationsGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer()
  private readonly server!: Namespace;
  private readonly timers = new Map<
    string,
    { expiry: NodeJS.Timeout; check: NodeJS.Timeout }
  >();

  constructor(
    private readonly jwt: JwtService,
    private readonly strategy: JwtStrategy,
  ) {}

  afterInit(server: Namespace) {
    // Namespace middleware runs BEFORE connection events or application message handlers.
    server.use((client, next) => {
      void this.authenticate(client as NotificationSocket).then(
        () => next(),
        () => {
          // Do not expose verification errors, tokens or database details to clients/logs.
          const error = new Error('Unauthorized') as Error & {
            data: { status: number };
          };
          error.data = { status: 401 };
          next(error);
        },
      );
    });
  }

  private async authenticate(client: NotificationSocket) {
    const auth = client.handshake.auth as Record<string, unknown>;
    const token = auth?.token;
    if (typeof token !== 'string' || !token || token.length > 8192)
      throw new Error('Invalid token');
    const claims = await this.jwt.verifyAsync<JwtPayload>(token, {
      algorithms: ['HS256'],
    });
    if (
      typeof claims.sub !== 'string' ||
      !Number.isFinite(claims.exp) ||
      claims.exp! <= Date.now() / 1000
    )
      throw new Error('Invalid claims');
    // Reuse HTTP's local revocation checks and current DB principal (role/lock/delete).
    const user = await this.strategy.validate(claims);
    client.data = { userId: user.id, role: user.role, claims };
    await client.join(this.getUserRoom(user.id));
  }

  handleConnection(client: NotificationSocket) {
    getMetrics().socketOpened(client.id);
    // Expiry closes the connection even if it sends no events. Re-check lock/revocation
    // every 15s; any auth/DB failure closes the connection instead of using stale identity.
    const expiry = setTimeout(
      () => client.disconnect(true),
      Math.min(
        2147483647,
        Math.max(1, client.data.claims.exp! * 1000 - Date.now()),
      ),
    );
    let checking = false;
    const check = setInterval(() => {
      if (checking) return;
      checking = true;
      void this.strategy
        .validate(client.data.claims)
        .catch(() => client.disconnect(true))
        .finally(() => {
          checking = false;
        });
    }, 15000);
    expiry.unref();
    check.unref();
    this.timers.set(client.id, { expiry, check });
    client.emit('notifications:connected', {
      socketId: client.id,
      userId: client.data.userId,
    });
  }

  handleDisconnect(client: Socket) {
    getMetrics().socketClosed(client.id);
    this.clearTimers(client.id);
  }

  @SubscribeMessage('notifications:join')
  async joinUserRoom(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: NotificationSocket,
  ) {
    // Compatibility event: clients may only re-join their own server-derived identity.
    const requested =
      payload && typeof payload === 'object'
        ? (payload as { userId?: unknown }).userId
        : undefined;
    if (requested !== undefined && requested !== client.data.userId) {
      client.emit('notifications:error', {
        status: 403,
        message: 'Không có quyền tham gia phòng này',
      });
      return;
    }
    try {
      if (client.data.claims.exp! <= Date.now() / 1000)
        throw new Error('Expired');
      await this.strategy.validate(client.data.claims);
      await client.join(this.getUserRoom(client.data.userId));
      client.emit('notifications:joined', { userId: client.data.userId });
    } catch {
      client.disconnect(true);
    }
  }

  emitNotification(userId: string, notification: NotificationResponse) {
    this.server
      .to(this.getUserRoom(userId))
      .emit('notifications:new', notification);
  }
  emitRefresh(userId: string) {
    this.server.to(this.getUserRoom(userId)).emit('notifications:refresh');
  }
  private getUserRoom(userId: string) {
    return `user:${userId}`;
  }
  private clearTimers(id: string) {
    const timers = this.timers.get(id);
    if (timers) {
      clearTimeout(timers.expiry);
      clearInterval(timers.check);
      this.timers.delete(id);
    }
  }
  onModuleDestroy() {
    for (const id of this.timers.keys()) this.clearTimers(id);
  }
}
