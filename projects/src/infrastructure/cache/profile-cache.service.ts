import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from './redis.service';
import { cacheKeys, cacheTtl } from './cache.keys';

type Envelope = {
  revision: string;
  views: Record<string, { expiresAt: number; value: unknown }>;
};
const publish = `
local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
local current=cjson.decode(raw); if current.revision~=ARGV[1] then return 0 end
current.views[ARGV[2]]=cjson.decode(ARGV[3]); redis.call('SET',KEYS[1],cjson.encode(current),'KEEPTTL'); return 1`;
@Injectable()
export class ProfileCacheService {
  constructor(private readonly redis: RedisService) {}
  async getOrLoad<T>(
    userId: string,
    view: 'auth' | 'student' | 'personal',
    loader: () => Promise<T>,
  ): Promise<T> {
    const key = cacheKeys.profile(userId);
    let raw = await this.redis.get(key);
    if (!raw) {
      await this.redis.command([
        'SET',
        this.redis.key(key),
        JSON.stringify({ revision: randomUUID(), views: {} }),
        'NX',
        'EX',
        String(cacheTtl.profile),
      ]);
      raw = await this.redis.get(key);
    }
    const envelope: Envelope | null = raw
      ? (JSON.parse(raw) as Envelope)
      : null;
    const cached = envelope?.views[view];
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;
    const value = await loader();
    // DEL on invalidation changes/removes the revision. An older DB read can never refill that cache.
    if (envelope)
      await this.redis.eval(
        publish,
        [key],
        [
          envelope.revision,
          view,
          JSON.stringify({
            value,
            expiresAt: Date.now() + cacheTtl.profile * 1000,
          }),
        ],
      );
    return value;
  }
  async invalidate(...userIds: string[]) {
    await this.redis.del(...[...new Set(userIds)].map(cacheKeys.profile));
  }
}
