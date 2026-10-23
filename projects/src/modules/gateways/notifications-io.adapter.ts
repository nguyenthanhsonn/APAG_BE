import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import type { Server, ServerOptions } from 'socket.io';

export class NotificationsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  createIOServer(port: number, options: Partial<ServerOptions> = {}): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
    }) as Server;
    return server;
  }
}
