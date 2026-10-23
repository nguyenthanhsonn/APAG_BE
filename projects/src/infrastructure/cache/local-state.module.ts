import { Global, Module } from '@nestjs/common';
import { ProfileCacheService } from './profile-cache.service';
import { ImportPreviewStore } from './import-preview-store.service';

/** Single-instance services; startup does not connect to an external cache. */
@Global()
@Module({
  providers: [ProfileCacheService, ImportPreviewStore],
  exports: [ProfileCacheService, ImportPreviewStore],
})
export class LocalStateModule {}
