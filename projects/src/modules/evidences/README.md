# Evidence gắn với phiếu chỉ định

`POST /api/v1/evidences/link-url` yêu cầu đủ bốn trường:

```json
{
  "evaluationFormId": "a2b07928-d685-4530-a6c1-01bd1a5aab15",
  "criteriaCode": "I.1",
  "imageUrl": "https://res.cloudinary.com/demo/image/upload/proof.jpg",
  "publicId": "evidences/proof"
}
```

Frontend gửi ID của phiếu đang mở, cùng URL và public ID nhận từ Cloudinary. Thiếu ID hoặc publicId trả 400; không còn fallback sang phiếu mới nhất. `publicId` bắt buộc cho request mới; record cũ có publicId null vẫn đọc/xóa được, không cần migration dữ liệu.

Backend nhận principal từ JWT, kiểm tra role và `EvaluationAccessPolicy.canEdit`, rồi tìm đúng `id + studentId` của người đăng nhập. ID không tồn tại hoặc phiếu người khác cùng trả 404. Phiếu phải ở `draft` hoặc `rejected`, `isLocked = false`; vi phạm trả 409. Tiêu chí phải có đúng `criteriaCode` và đang hoạt động, nếu không trả 404.

Kiểm tra và tạo evidence chạy trong một transaction. Trước khi ghi bảng con, CAS `id + version` của phiếu và tăng version: nếu submit/khóa hoặc thao tác ghi khác vừa thay đổi phiếu, request dừng với 409. Khóa row được giữ đến commit, nên không có khoảng hở giữa kiểm tra editable và lưu ảnh. Tạo evidence lỗi cũng rollback version. Xóa evidence kiểm tra chủ của cả evidence và phiếu cha, rồi áp dụng cùng CAS/transaction.

`GET /api/v1/evidences/my` tiếp tục trả evidence của sinh viên trên các phiếu; `createdAt` ở đây chỉ sắp xếp danh sách, không chọn phiếu để ghi.

Test: `pnpm test --runInBand` kiểm tra DTO, quyền, trạng thái và khóa; `pnpm test:concurrency` kiểm tra HTTP chọn phiếu cũ rõ ID, không fallback, đồng thời submit/khóa và rollback khi lưu evidence lỗi trong schema PostgreSQL riêng.

Client gửi thêm `expectedVersion` khi link; DELETE nhận query `expectedVersion`. Backend kiểm tra snapshot client trước CAS. Response thêm/xóa trả `evaluationVersion` của phiếu cha sau transaction để FE tiếp tục hàng đợi ghi bằng đúng version, không cần GET lại để đoán.
