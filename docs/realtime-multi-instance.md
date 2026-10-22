# Phase 5 — Realtime trên nhiều API instance

Cập nhật 21/10/2026. Đã kiểm thử **hai NestJS process độc lập**, PostgreSQL test riêng và Redis test riêng. Không thay dữ liệu nghiệp vụ APAG.

## Xác thực và phân quyền

Namespace `/notifications` dùng Socket.IO middleware trong `afterInit()`. Middleware chạy trước connection callback và các message handler:

1. Client gửi access JWT qua `handshake.auth.token`; không gửi JWT qua query string.
2. `JwtService.verifyAsync()` kiểm tra signature HS256 và expiry, yêu cầu `sub` và `exp` hợp lệ.
3. `JwtStrategy.validate()` kiểm tra jti/revocation trên Redis và principal hiện tại trong DB. Tài khoản bị khóa, bị xóa hoặc không tồn tại bị từ chối; role lấy từ DB.
4. Server ghi `socket.data.userId`, `role`, claims đã xác thực và tự join `user:<userId>`.
5. Chỉ kết nối thành công mới tăng `active_websocket_connections` và nhận `notifications:connected`.

Handshake không hợp lệ nhận `connect_error`, message `Unauthorized`, `data.status=401`. Không trả nội dung JWT, lỗi driver hay thông tin tài khoản trong lỗi handshake. Không tin `handshake.auth.userId`, query userId hoặc role do client tự khai báo.

Event cũ `notifications:join` giữ tương thích nhưng chỉ cho rejoin room của chính principal; yêu cầu userId khác trả `notifications:error` với status 403. Room được dựng từ `socket.data.userId`, không từ payload. Event join kiểm tra lại quyền hiện tại. Không có event client được phép broadcast, emit notification cho người khác hoặc tham gia room tùy ý.

Socket đóng tại thời điểm JWT hết hạn. Ngoài ra mỗi socket kiểm tra DB principal/revocation mỗi 15 giây; lỗi dependency cũng đóng socket. **Logout/lock/delete của kết nối đang mở có cửa sổ tối đa khoảng 15 giây cộng thời gian truy vấn trước khi disconnect**. Handshake mới và rejoin kiểm tra ngay. Đây chưa phải cơ chế disconnect đồng bộ ngay thời điểm HTTP mutation commit. Timer được hủy khi socket disconnect hoặc ứng dụng shutdown.

HTTP notifications đã kiểm tra quyền sở hữu: list/unread dùng current user; mark-as-read tìm notification theo cả id và userId; mark-all giới hạn userId. Emit chỉ được gọi từ service phía server, dùng recipient của notification. Gateway không cho admin chọn room của người khác qua WebSocket.

## Redis adapter

`SocketRedisService` giữ hai connection riêng cho publish và subscribe, dùng cùng `REDIS_URL` như cache. Không dùng command connection làm subscriber. Startup chờ cả hai connection sẵn sàng, timeout 5 giây, rồi mới gắn adapter và mở API listener. Shutdown đóng các connection.

`NotificationsIoAdapter` gắn `@socket.io/redis-adapter` vào Socket.IO server; namespace kế thừa adapter. Channel prefix là `${REDIS_KEY_PREFIX}socket.io`. Các instance phải dùng cùng Redis, prefix và JWT secrets. Redis Pub/Sub không tách theo logical database: **môi trường khác nhau phải dùng prefix khác nhau**, kể cả khi Redis DB index khác nhau.

`NotificationsService.emitCreated()` trên A → room broadcast → Redis Pub/Sub → socket cùng user đang kết nối B. `notifications:refresh` cũng đi qua adapter. Mỗi API có thêm hai Redis connections ngoài command connection; `db_pool_*` vẫn chỉ đo PostgreSQL pool.

Redis adapter không biến realtime thành durable queue: khi Redis gián đoạn, cross-instance delivery có thể mất và local delivery có thể vẫn tiếp tục. Redis client reconnect tự động; lỗi ghi log `socket.redis_error` không kèm URL/credential. Notification đã lưu DB là nguồn dữ liệu bền vững; FE reload danh sách khi kết nối/reconnect. Chưa có acknowledgement/replay/outbox để đảm bảo mỗi realtime event được giao.

## Frontend

Hook `/Users/nguyenson/APAG_FE/src/hooks/useNotificationSocket.ts`:

- Bỏ gửi `notifications:join` với userId.
- `auth` callback đọc access token hiện tại từ storage cho mỗi handshake/reconnect.
- Dùng transport `websocket`.
- Khi server đóng socket vì phiên hết hiệu lực, gọi HTTP `/auth/me`; API layer refresh token theo cơ chế single-flight hiện có rồi reconnect nếu phiên vẫn hợp lệ. Không tạo vòng lặp retry liên tục khi refresh thất bại.

Contract tối thiểu cho client khác:

```ts
const socket = io(`${apiOrigin}/notifications`, {
  transports: ['websocket'],
  auth: (done) => done({ token: currentAccessToken() }),
});
socket.on('notifications:new', reloadNotifications);
socket.on('notifications:refresh', reloadNotifications);
socket.on('connect', reloadNotifications);
```

## Triển khai

Không thêm env bắt buộc mới. Giữ `REDIS_URL`, `REDIS_KEY_PREFIX`, JWT secrets và `FRONTEND_URL` đồng bộ giữa API instances.

Load balancer phải forward WebSocket upgrade tới `/socket.io/`, giữ timeout kết nối phù hợp. Với FE websocket-only, không cần sticky session cho long-polling. Nếu client khác bật polling fallback, phải dùng sticky sessions; Redis adapter không thay thế yêu cầu này. Không sửa cấu hình reverse proxy production chưa có trong repository.

Metric `active_websocket_connections` là số socket local của từng process; Grafana/Prometheus sum theo instance khi cần tổng toàn hệ thống.

## Kiểm chứng

```bash
cd /Users/nguyenson/APAG_BE/projects
pnpm test:realtime
# Cũng nằm trong suite Redis:
pnpm test:redis
```

Harness tạo database mới `apag_redis_test_<random>`, Redis AOF riêng và hai Nest process dùng production adapter. IPC phát notification chỉ tồn tại trong fixture test; không có debug endpoint ở production. Harness dọn process/database test khi kết thúc.

25 kiểm tra tích hợp gồm 13 kiểm tra Redis trước đó và 12 kiểm tra realtime:

- Từ chối userId không có JWT, JWT malformed, sai signature, hết hạn, đã thu hồi, principal không tồn tại.
- Handshake xác định đúng user ở cả WebSocket và polling trực tiếp vào từng node.
- Client khác bị chặn join room của student với 403.
- Notification từ A đến cả socket A và B của student, không rò sang socket admin.
- Refresh từ B đến socket A.
- Socket tự đóng khi token hết hạn.
- Socket đang idle ở cả hai instance đóng sau shared revocation.

Backend build/typecheck/lint, 299 unit tests và FE TypeScript check đạt. Chưa benchmark tải WebSocket hoặc kiểm thử load balancer production; đây là kiểm chứng chức năng trên hai process local.

Tham khảo: [Nest gateway middleware](https://docs.nestjs.com/websockets/gateways), [Socket.IO Redis adapter và sticky sessions](https://socket.io/docs/v4/redis-adapter/).

### FE lifecycle sau refactor

FE đã tách connection manager và browser singleton khỏi React hook, đồng bộ auth/storage events, cleanup khi logout và chống promise refresh/import cũ reconnect sau đổi phiên. 17 socket tests, 19 API tests và 8 profile tests kiểm chứng các race này. Xem `APAG_FE/docs/realtime-socket.md` trong frontend repository.
