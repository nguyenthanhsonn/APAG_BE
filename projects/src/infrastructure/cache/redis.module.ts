import { SocketRedisService } from './socket-redis.service';
import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { ProfileCacheService } from './profile-cache.service';
import { ImportPreviewStore } from './import-preview-store.service';
@Global()
@Module({
  providers: [
    RedisService,
    ProfileCacheService,
    ImportPreviewStore,
    SocketRedisService,
  ],
  exports: [
    RedisService,
    ProfileCacheService,
    ImportPreviewStore,
    SocketRedisService,
  ],
})
export class RedisModule {}
