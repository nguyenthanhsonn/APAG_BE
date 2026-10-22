# Phase 4 — Redis và shared API state

Cập nhật 21/10/2026. Đã triển khai và kiểm thử hai NestJS process độc lập. Redis local 8.10.2 đã hoạt động tại loopback 6379; client dùng `redis` 6.3.0. Không thay schema hoặc dữ liệu nghiệp vụ APAG trong phase này.

## 1. Infrastructure

`projects/src/infrastructure/cache/`:

| File | Trách nhiệm |
|---|---|
| `redis.module.ts` | Global providers, dùng chung Redis connection trong mỗi process |
| `redis.service.ts` | Connection lifecycle, command timeout, namespace, JSON-safe logging, OTel client spans |
| `cache.keys.ts` | Một nơi định nghĩa logical keys và TTL |
| `profile-cache.service.ts` | Cache ba projection theo user, chống stale refill sau invalidation |
| `import-preview-store.service.ts` | Preview dùng chung, AES-256-GCM và atomic consume |

Redis là dependency bắt buộc. Không có RAM fallback cho authentication state. Client không giữ offline command queue; command timeout mặc định 2s, startup timeout hữu hạn. Khi mất Redis, auth check/login trả **503**, không chấp nhận token vì cache cục bộ. Khi kết nối hồi phục client reconnect và dùng state Redis hiện có.

Command Redis có OTel CLIENT span `Redis GET/SET/MGET/EVAL/...`, chỉ chứa system/operation, không chứa key, giá trị, profile hay credential. Logger lọc cả `redis://`/`rediss://` và Redis URL config.

## 2. Key và TTL

| Logical key | Giá trị | TTL |
|---|---|---|
| `auth:revoked:<jti>` | `1` | Thời gian còn lại tới JWT exp, làm tròn lên giây |
| `auth:user-revoked-after:<userId>` | Monotonic millisecond stamp | Max access/refresh lifetime cấu hình + 2s |
| `profile:<userId>` | Revision + các view `auth`, `student`, `personal` | Tối đa 30s |
| `import:students:<id>` | Encrypted preview | 600s |
| `import:classes:<id>` | Encrypted preview | 600s |

`REDIS_KEY_PREFIX` mặc định `apag:` được thêm trước logical key, ví dụ `apag:profile:<userId>`. Hai API cùng môi trường phải dùng cùng URL/database Redis, prefix và JWT secrets. Khác môi trường/test phải tách prefix. Code hiện dùng Redis standalone/managed primary; chưa triển khai Redis Cluster routing/cross-slot support.

### Token revocation

`AuthTokenStoreService` chuyển hoàn toàn sang async Redis. JWT strategy, logout, change/reset password và admin lock/delete đã await các thao tác này. Principal role/isActive/deletedAt vẫn đọc DB hiện tại, không lấy quyền từ profile cache.

User revocation dùng Lua giữ stamp tăng đơn điệu và không giảm TTL của marker đang tồn tại. Access và refresh token mới chứa `revocationStamp` đọc từ Redis khi mint. Hai lần khóa/thu hồi trong cùng giây vẫn khác stamp; sau unlock, token cũ tiếp tục bị từ chối nhưng login mới nhận stamp hiện tại và hoạt động ngay. JWT cũ chưa có claim dùng iat/cutoff tương thích; marker không tồn tại thì JWT vẫn phải qua signature/expiry và current DB principal.

Refresh token có jti ngẫu nhiên, tránh sinh token giống nhau khi mint cùng giây. Rotation dùng DB compare-and-swap theo hash cũ: hai API refresh cùng token chỉ một API được thay hash; request còn lại trả 401. Logout xóa refresh hash trong DB như trước và ghi access-jti revocation vào Redis trước khi báo thành công.

Retention dựa trên lifetime chung giữa các instance. Khi rollout thay đổi lifetime, phải giữ retention đủ dài cho token đã phát hành theo cấu hình cũ; không giảm đột ngột lifetime/retention trong khi các token đó còn sống. Cần drain các binary cũ còn dùng Map; không thể thu hồi lại những entry RAM đã mất khi process cũ dừng. Rollout production cần kế hoạch vô hiệu hóa token cũ (ví dụ rotation secrets đồng bộ) nếu phải đảm bảo các revocation trước chuyển đổi.

### Profile cache

Ba response projection dùng chung một invalidation key. Update profile/contact, admin update/lock/delete, password change/reset, cập nhật phone qua phiếu, enrollment/import đều invalidate sau DB commit. Lock/delete vẫn bị DB principal guard chặn ngay cả khi client giữ token cũ.

Cache miss tạo envelope revision bằng SET NX. Sau DB load, Lua chỉ publish nếu revision còn nguyên. Invalidate DEL key; loader cũ không được ghi lại cache sau DEL hoặc sau khi key hết hạn. Lua merge từng view để hai API không ghi đè view của nhau. Đây là cache-aside có fencing, chưa phải distributed single-flight chống stampede.

TTL 30s được giữ theo target; chưa benchmark lại profile riêng. Các thay đổi tên danh mục khoa/ngành/lớp ngoài mutation user/enrollment có thể cần chờ TTL để phản ánh trong profile; authorization vẫn dùng DB. Metadata cache và cache semester-ID còn ở RAM vì là dữ liệu dẫn xuất có TTL, không dùng làm nguồn revocation hoặc quyền truy cập. Các Map chỉ để group/lookup trong một request cũng không phải session state.

### Import preview

Hai preview trước đây là Map của process, nên confirm trên API khác không thấy token. Nay lưu Redis TTL 10 phút, mã hóa AES-256-GCM với AAD gắn key/prefix; khóa dẫn xuất riêng từ shared JWT refresh secret. Plaintext password tạm không nằm trong Redis value. Giữ cùng secret giữa các instance; đổi secret sẽ làm preview đang chờ không giải mã được và người dùng phải preview lại.

Student preview kiểm tra actor/role trước atomic GETDEL để actor khác không tiêu hủy preview của chủ. Catalog preview giữ phân quyền admin của endpoint. Hai request confirm chỉ một request claim được. Date từ worksheet được chuẩn hóa date-only trước serialization. Giữ semantics hiện tại: đã claim thì không replay preview khi commit thất bại; muốn retry cần preview mới. Đây chưa phải job queue hay import idempotency receipt.

## 3. Vận hành

Env mới trong `projects/.env.example`:

```dotenv
REDIS_URL=redis://127.0.0.1:6379
REDIS_KEY_PREFIX=apag:
REDIS_COMMAND_TIMEOUT_MS=2000
```

Redis URL hỗ trợ `rediss://` và authentication; không đưa URL chứa credential vào log/Git. Redis chứa cả revocation nên phải có persistence và **noeviction**; không dùng cache LRU có thể làm mất key revocation trước TTL.

Standalone local Docker:

```bash
cd projects
docker compose -f infra/redis/compose.yml up -d
pnpm dev:once
```

Compose backend chính có Redis dependency healthy và `REDIS_URL=redis://redis:6379` mặc định (override bằng `REDIS_DOCKER_URL`, tách khỏi URL localhost khi chạy native), không publish Redis port ra host. Standalone local Compose publish loopback 6379. Cả hai dùng AOF, appendfsync always, noeviction và volume riêng. Các cấu hình này là local trusted-network; production dùng Redis được bảo vệ bằng ACL/auth/TLS, private network và backup/monitoring phù hợp.

Trong phiên làm việc này Docker chưa dùng để chạy Redis; đã biên dịch source chính thức 8.10.2 và chạy native local. Binary/config/state local đều nằm dưới `.local/` của repository và đã Git-ignore:

```bash
cd /Users/nguyenson/APAG_BE
.local/redis-bin/redis-cli ping
# Khởi động lại native Redis local nếu chưa có process nghe 6379:
.local/redis-bin/redis-server .local/redis/redis.conf
```

Native config hiện là cấu hình riêng máy này; không dùng file ignored đó làm deployment artifact. Redis local tiếp tục chạy sau test; test dùng Redis riêng trên port ngẫu nhiên và DB test mới, rồi dọn process/database test.

Không chạy FLUSHALL/FLUSHDB hoặc xóa `auth:*` khi dọn cache profile. Xóa auth state có thể làm token bị thu hồi được chấp nhận lại nếu JWT chưa hết hạn. Mất AOF/volume vẫn là mất security state; hai API không làm Redis thành HA. AOF restart đã được test, chưa mô phỏng mất đĩa/replica failover.

## 4. Kiểm chứng

```bash
cd projects
pnpm test:redis
# Hoặc trỏ server binary khác:
REDIS_SERVER_BIN=/path/to/redis-server pnpm test:redis
```

Harness tạo DB `apag_redis_test_<random>` mới từ schema, hai Nest process độc lập và một Redis riêng với AOF. Đăng nhập dùng username/password qua HTTP. Không ghi record vào DB APAG, không gửi email.

13 kiểm tra đã đạt: refresh CAS; revocation giữ nguyên sau restart API; logout A/reject B gồm refresh; jti TTL; profile invalidation xuyên node; unlock không hồi sinh token; user-stamp tăng đơn điệu; fencing cache refill; encrypted preview/single claim; expiry revocation; Redis outage 503; AOF restart; delete/revoke xuyên node. Log không chứa password, JWT hoặc shared secret kiểm thử.

Build/typecheck/lint đạt. 299 unit tests, 29 concurrency/workflow tests, 12 DB invariant tests, 2 HTTP observability tests và tracing probe vẫn đạt sau tích hợp. Compose Redis đã qua `config --quiet`; Docker container runtime chưa được kiểm chứng trong phiên này. Baseline Phase 3 giữ nguyên số đo trước Redis; chưa claim cải thiện throughput/latency sau thay đổi này.

Nguồn: [GETDEL semantics](https://redis.io/docs/latest/commands/getdel/), [Redis eviction policy](https://redis.io/docs/latest/develop/reference/eviction/), [Redis security](https://redis.io/docs/latest/operate/oss_and_stack/management/security/).

Phase 5 thêm hai Redis connections Pub/Sub cho Socket.IO ở mỗi API. Suite `test:redis` hiện bao gồm kiểm thử realtime; xem [report Phase 5](realtime-multi-instance.md).
