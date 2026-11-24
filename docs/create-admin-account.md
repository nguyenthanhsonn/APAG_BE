# Hướng dẫn tạo tài khoản quản trị viên APAG

Dùng tài khoản có vai trò `admin` để tạo thêm quản trị viên trong cùng môi trường. Nếu đang kiểm thử, mở frontend local tại `http://localhost:3000` và kiểm tra frontend đang trỏ đúng backend local. Khi tạo tài khoản trên hệ thống triển khai, thao tác trên website của môi trường đó.

## Tạo trên giao diện

1. Đăng nhập bằng tài khoản quản trị viên hiện có.
2. Mở **Quản lý người dùng** (`/admin/users`) → **Thêm người dùng**.
3. Nhập họ tên, tên đăng nhập, email và mật khẩu ban đầu. Chọn vai trò **Quản trị viên** (`admin`).
4. Bấm **Thêm người dùng**. Tìm lại tài khoản theo tên đăng nhập và kiểm tra vai trò **Quản trị viên** cùng trạng thái **Hoạt động**.
5. Đăng nhập bằng tài khoản mới trong cửa sổ riêng, trên cùng môi trường. Sau khi đăng nhập, hệ thống chuyển đến `/admin`.

| Trường | Yêu cầu khi nhập trên giao diện |
| --- | --- |
| Họ tên | Từ 2 đến 100 ký tự. |
| Tên đăng nhập | Duy nhất, từ 3 đến 50 ký tự. Dùng chữ thường không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang. |
| Email | Hợp lệ, duy nhất và thuộc người được cấp tài khoản. |
| Mật khẩu | Dùng mật khẩu riêng, từ 8 đến 50 ký tự. |
| Số điện thoại và ngày sinh | Tùy chọn. Số điện thoại gồm 9 đến 11 chữ số nếu có. |

Vai trò `admin` quản trị toàn hệ thống và không cần gán lớp hoặc khoa. Nếu giao diện báo đã tạo tài khoản nhưng gửi email thất bại, kiểm tra danh sách người dùng trước khi thử lại. Hệ thống lưu tài khoản trước khi gửi email.

## Tạo qua API

Gửi `POST /api/v1/admin/users` với header `Authorization: Bearer <accessToken>` của quản trị viên hiện có và `Content-Type: application/json`. Có thể thực hiện trong Swagger tại `/api/docs` trên backend nếu Swagger được bật. Ví dụ nội dung yêu cầu dưới đây dùng dữ liệu minh họa. Thay tên đăng nhập, email và mật khẩu trước khi gửi.

```json
{
  "fullName": "Nguyễn Văn An",
  "username": "admin.an",
  "email": "admin.an@example.com",
  "password": "<MAT_KHAU_RIENG>",
  "role": "admin"
}
```

Thành công trả về HTTP `201`. Kiểm tra `data.role` là `admin` và `data.isActive` là `true`. Mã `401` thường là phiên không hợp lệ hoặc đã hết hạn, `403` là thiếu quyền quản trị và `409` là tên đăng nhập hoặc email đã được dùng.

## Khi chưa có tài khoản admin

Với database **local dùng cho demo**, cấu hình `projects/.env`, khởi tạo schema theo [hướng dẫn backend](../README.md), rồi chạy `pnpm db:seed` từ thư mục `projects`. Seed tạo tài khoản mẫu `admin` cùng dữ liệu demo. Chạy lại seed có thể ghi đè mật khẩu của tài khoản admin mẫu và thu hồi phiên hiện tại.

Với database triển khai thực tế, liên hệ người vận hành hệ thống để thiết lập tài khoản quản trị đầu tiên. Chỉ dùng `pnpm db:seed` trên database demo vì lệnh này còn tạo hoặc cập nhật nhiều dữ liệu mẫu.

Tham khảo [quản lý tài khoản](admin-user-guide.md#7-quản-lý-tài-khoản), [cấu hình môi trường](environment.md) và [API quản trị người dùng](../projects/src/modules/admin-users/admin-users.controller.ts).
