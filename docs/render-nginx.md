# Triển khai APAG qua Nginx trên Render

```text
Frontend → HTTPS → Nginx Web Service → NestJS Private Service → PostgreSQL
```

Render xử lý HTTPS tại lớp public. Nginx chuyển tiếp HTTP và WebSocket qua mạng nội bộ cùng region. API tiếp tục nhận nguyên đường dẫn, gồm `/api/v1/...` và `/socket.io/`. Render gọi `/api/v1/health` qua Nginx để kiểm tra đường truyền đến NestJS. [Render Web Services](https://render.com/docs/web-services) · [Health checks](https://render.com/docs/health-checks)

## 1. Deploy APAG

1. Commit và push các file cấu hình lên nhánh Git sẽ deploy. Trên Render, chọn **New → Blueprint**, kết nối repo, chọn nhánh đó và đặt **Blueprint Path** là `render.yaml`. Blueprint tạo `apag-nginx` public và `apag-api` private. Cả hai dùng instance `starter` có phí và region `singapore`. [Hướng dẫn Render Blueprints](https://render.com/docs/infrastructure-as-code)
2. Nhập `DATABASE_URL` của PostgreSQL đích và `FRONTEND_URL` là origin của frontend, ví dụ `https://frontend.example.com`. Blueprint tự tạo hai JWT secret riêng. Nếu chuyển một hệ thống đang chạy sang Blueprint này và cần giữ các phiên hiện tại, cấu hình các JWT secret đang dùng trên `apag-api`. Nếu PostgreSQL dùng URL qua pooler, đặt thêm `DIRECT_URL` kết nối trực tiếp trong Environment của API để Prisma chạy migration. Các biến khác như SMTP và URL trong email có trong [hướng dẫn môi trường](environment.md).
3. Kiểm tra database đích và danh sách tài nguyên trên màn hình xác nhận, rồi chọn **Deploy Blueprint**. Render chạy `pnpm db:deploy` trước khi khởi động NestJS. Health check của Nginx sẽ thành công khi API đã listen và nhận request. [Render Blueprint YAML](https://render.com/docs/blueprint-spec)
4. Lấy URL public từ service `apag-nginx`, thay hostname trong lệnh bên dưới và chạy. Sau khi nhận HTTP 200, cập nhật frontend dùng URL Nginx cho HTTP API và Socket.IO. Nếu frontend cấu hình API base URL có prefix, dùng `https://<hostname>/api/v1` cho HTTP và origin `https://<hostname>` cho Socket.IO.

```bash
curl -fsS https://apag-nginx.onrender.com/api/v1/health
```

Nếu gặp `502`, mở **Logs** của cả hai service. Kiểm tra migration, cổng `5050` và hostname nội bộ của `apag-api` trong **Connect → Internal**. Hai service cần ở cùng region và workspace để dùng chung mạng nội bộ. Nginx đặt giới hạn request body 25 MiB và ghi địa chỉ upstream, status, thời gian xử lý trong access log. [Render Private Network](https://render.com/docs/private-network)

## 2. Xem Nginx chia request qua hai backend

Nginx dùng round-robin giữa các IP backend trong DNS. `resolve` cập nhật danh sách IP khi instance thay đổi. Nginx giữ mỗi kết nối WebSocket trên backend đã nhận handshake và tắt tự động gửi lại request sang backend khác nếu upstream lỗi. [NGINX upstream](https://nginx.org/en/docs/http/ngx_http_upstream_module.html) · [NGINX WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)

**Trên Render.** Tạo Blueprint riêng với **Blueprint Path** là `render.demo.yaml`. Blueprint này dùng hai instance API demo và một Nginx, đều thuộc gói `starter` có phí. API demo chỉ trả về ID của instance xử lý `/api/v1/health` và chạy độc lập với PostgreSQL. Nginx dùng `RENDER_DISCOVERY_SERVICE` để lấy IP của cả hai instance. Đợi các service chạy rồi thay hostname bằng URL public của Nginx demo và kiểm tra. [Discovery hostname trên Render](https://render.com/docs/private-network#direct-ip-communication-advanced)

```bash
for i in {1..10}; do
  curl -fsS https://apag-lb-demo-nginx.onrender.com/api/v1/health
done | sort | uniq -c
```

**Trên máy local.** Chạy từ thư mục gốc repo với Docker Compose. Đợi cả hai backend nhận kết nối, sau đó kết quả mong đợi là thấy cả `api-a` và `api-b`. Dòng `upstream=` trong log ghi địa chỉ backend xử lý từng request.

```bash
docker compose -f projects/infra/nginx/compose.demo.yaml up -d --build
docker compose -f projects/infra/nginx/compose.demo.yaml exec nginx nginx -t
for i in {1..10}; do
  curl -fsS http://127.0.0.1:8080/api/v1/health
done | sort | uniq -c
docker compose -f projects/infra/nginx/compose.demo.yaml logs nginx
docker compose -f projects/infra/nginx/compose.demo.yaml down
```

## 3. Khi nào tăng số instance của APAG

`render.yaml` đặt `apag-api` ở một instance. Bản APAG hiện tại giữ danh sách thu hồi JWT, phiên xem trước import và metadata export trong RAM. File export lưu trên đĩa cục bộ và sự kiện Socket.IO phát qua adapter cục bộ. Khi request sang instance khác, token đã thu hồi có thể được chấp nhận, preview hoặc export có thể mất dấu và notification có thể đến thiếu. [Chi tiết runtime hiện tại](infrastructure-rollback.md)

Để tăng instance APAG, cần đưa trạng thái thu hồi, preview và metadata export vào kho dùng chung, chuyển file export sang object storage và cấu hình adapter Socket.IO dùng chung. Kiểm tra logout, import, export và notification khi request đi qua hai instance. Sau khi các luồng đạt kiểm thử, có thể dùng `RENDER_DISCOVERY_SERVICE` cho `apag-api` theo mẫu demo và tăng `numInstances`.
