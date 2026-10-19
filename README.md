# CSMTS - Comprehensive Student Management and Training System

CSMTS là hệ thống quản lý sinh viên và đánh giá kết quả rèn luyện. Dự án gồm backend NestJS/Prisma và frontend Next.js, phục vụ quy trình sinh viên tự đánh giá, ban cán sự/CVHT chấm duyệt cấp lớp, và admin phê duyệt kết quả cuối.


## Tech Stack

Backend:
- NestJS 11
- Prisma 7
- PostgreSQL / Supabase
- JWT authentication
- Socket.IO notifications
- Jest, TypeScript

Frontend:
- Next.js 16
- React 19
- Tailwind CSS
- Zustand
- Axios
- Socket.IO client

## Role Chính

Hệ thống hiện có 3 role:

| Role | Mô tả |
|---|---|
| `student` | Sinh viên tự tạo, lưu nháp, cập nhật và nộp phiếu đánh giá rèn luyện. |
| `class_council` | Ban cán sự lớp/CVHT xem lớp được phân công, chấm điểm lớp và gửi phiếu lên admin. |
| `admin` | Quản trị hệ thống, quản lý danh mục/sinh viên/lớp và phê duyệt kết quả cuối. |

## Quy Trình Đánh Giá Rèn Luyện

```text
draft
  -> submitted
  -> class_approved
  -> finalized
```

Ý nghĩa:
- `draft`: sinh viên đang điền hoặc lưu nháp.
- `submitted`: sinh viên đã nộp, chờ ban cán sự/CVHT duyệt.
- `class_approved`: lớp/CVHT đã chấm xong, gửi lên admin.
- `finalized`: admin đã phê duyệt kết quả cuối.
- `rejected`: phiếu bị trả về/chưa hợp lệ.

Điểm chính thức admin dùng để duyệt cuối là `classScore`. `studentScore` vẫn được lưu để sinh viên xem lại phần tự chấm, nhưng không dùng để tính "chênh lệch điểm" ở màn hình admin.

## Chạy Backend

```bash
cd projects
pnpm install
pnpm db:generate
pnpm dev
```

Backend mặc định chạy tại:

```text
http://localhost:5050/api/v1
```

Health check:

```http
GET /api/v1/health
```

## Cấu Hình Backen

## Scripts Backend

Chạy trong `projects/`:

| Lệnh | Mục đích |
|---|---|
| `pnpm dev` | Chạy backend dev watch. |
| `pnpm dev:once` | Chạy backend bằng ts-node, tiện đo/debug nhanh. |
| `pnpm build` | Build backend ra `dist`. |
| `pnpm start:prod` | Chạy bản build production. |
| `pnpm typecheck` | Kiểm tra TypeScript. |
| `pnpm test` | Chạy unit test. |
| `pnpm test:e2e` | Chạy e2e test. |
| `pnpm lint` | Kiểm tra lint. |
| `pnpm db:generate` | Generate Prisma client. |
| `pnpm db:migrate` | Tạo/chạy migration dev. |
| `pnpm db:deploy` | Deploy migration. |
| `pnpm db:seed` | Seed dữ liệu demo. |
| `pnpm db:studio` | Mở Prisma Studio. |


## API Chính

Base URL:

```text
http://localhost:5050/api/v1
```

Auth:

```http
POST /auth/login
GET  /auth/me
POST /auth/refresh-token
POST /auth/logout
POST /auth/change-password
```

Đăng nhập qua `POST /auth/login` chỉ cần `username` và `password`.

Sinh viên:

```http
GET   /students/me
PATCH /students/me
GET   /students/me/evaluations

POST  /training-evaluations
GET   /training-evaluations/me
GET   /training-evaluations/:id
PATCH /training-evaluations/:id
POST  /training-evaluations/:id/submit
```

Ban cán sự/CVHT:

```http
GET   /class-council/classes/:id
GET   /training-evaluations?classId=...
GET   /training-evaluations/:id
PATCH /training-evaluations/:id/review-scores
POST  /training-evaluations/:id/review
```

Admin:

```http
GET   /admin/evaluations
PATCH /admin/evaluations/:id/finalize
PATCH /admin/evaluations/bulk-finalize
POST  /admin/evaluations/finalize-by-filter

GET   /admin/classes
GET   /admin/students
GET   /admin/faculties
GET   /admin/majors
GET   /admin/users
GET   /admin/reports/overview
```
```

Response này không có `stats`, `diff`, `studentScore`.

## Kiểm Tra Nhanh

Backend:

```bash
cd projects
pnpm typecheck
pnpm test
```
