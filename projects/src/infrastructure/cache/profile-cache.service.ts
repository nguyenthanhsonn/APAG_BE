import { Injectable } from '@nestjs/common';

@Injectable()
export class ProfileCacheService {
  /** Đọc DB trực tiếp để update/lock/delete luôn thấy dữ liệu hiện tại. */
  async getOrLoad<T>(
    _userId: string,
    _view: 'auth' | 'student' | 'personal',
    loader: () => Promise<T>,
  ): Promise<T> {
    return loader();
  }

  // Giữ contract cho các caller; không còn cache cần invalidate.
  async invalidate(...userIds: string[]): Promise<void> {
    void userIds;
  }
}
