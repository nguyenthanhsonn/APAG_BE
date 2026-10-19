# Hướng dẫn sử dụng trang Admin

Tài liệu này dành cho tài khoản có quyền `admin` trong hệ thống CSMTS. Nội dung tập trung vào thao tác trên trang quản trị: quản lý danh mục, sinh viên, lớp, tài khoản, học kỳ, phiếu đánh giá rèn luyện và báo cáo.

## 1. Đăng nhập và kiểm tra quyền

1. Mở trang đăng nhập của hệ thống.
2. Nhập tên đăng nhập và mật khẩu tài khoản admin.
3. Sau khi đăng nhập thành công, kiểm tra thanh điều hướng có các mục quản trị như Sinh viên, Lớp, Khoa, Ngành, Học kỳ, Tài khoản, Đánh giá và Báo cáo.

Nếu không thấy menu admin, tài khoản hiện tại không có quyền `admin` hoặc phiên đăng nhập đã hết hạn. Đăng xuất rồi đăng nhập lại bằng tài khoản admin.

## 2. Quy trình quản trị khuyến nghị

Khi thiết lập dữ liệu đầu năm hoặc đầu khóa, nên thao tác theo thứ tự sau:

1. Tạo hoặc kiểm tra danh mục Khoa.
2. Tạo hoặc kiểm tra danh mục Ngành thuộc từng Khoa.
3. Tạo hoặc import danh sách Lớp thuộc từng Ngành.
4. Tạo hoặc import danh sách Sinh viên.
5. Gán sinh viên vào đúng lớp.
6. Tạo tài khoản lớp trưởng, cố vấn học tập, tài khoản khoa nếu cần.
7. Gán lớp trưởng cho lớp.
8. Tạo học kỳ đánh giá và bật học kỳ đang sử dụng.
9. Theo dõi phiếu đánh giá, duyệt cuối và xuất báo cáo.

Thứ tự này giúp tránh lỗi thiếu Khoa, thiếu Ngành hoặc thiếu Lớp khi import sinh viên.

## 3. Quản lý Khoa

Trang Khoa dùng để quản lý đơn vị cấp khoa.

Các thao tác chính:

- Xem danh sách khoa.
- Tìm kiếm hoặc lọc khoa theo trạng thái.
- Tạo khoa mới.
- Cập nhật mã khoa, tên khoa.
- Bật hoặc tắt trạng thái hoạt động.
- Xóa khoa khi không còn dữ liệu phụ thuộc.

Dữ liệu cần nhập khi tạo khoa:

- Mã khoa: viết ngắn gọn, dễ nhận diện, ví dụ `KTE`, `CNTT`.
- Tên khoa: tên đầy đủ hiển thị trên hệ thống.

Lưu ý: Không nên đổi mã khoa sau khi đã dùng trong báo cáo hoặc dữ liệu import, trừ khi chắc chắn các dữ liệu liên quan vẫn khớp.

## 4. Quản lý Ngành

Trang Ngành dùng để quản lý ngành đào tạo thuộc khoa.

Các thao tác chính:

- Xem danh sách ngành.
- Lọc ngành theo khoa.
- Tạo ngành mới.
- Cập nhật mã ngành, tên ngành, khoa trực thuộc.
- Bật hoặc tắt trạng thái hoạt động.
- Xóa ngành khi không còn lớp phụ thuộc.

Dữ liệu cần nhập khi tạo ngành:

- Mã ngành: ví dụ `QTNI`, `QLNI`, `KTPM`.
- Tên ngành: tên đầy đủ của ngành.
- Khoa: chọn khoa quản lý ngành.

Lưu ý: Mỗi lớp phải thuộc một ngành, nên cần tạo Khoa và Ngành trước khi tạo Lớp.

## 5. Quản lý Lớp

Trang Lớp dùng để quản lý danh mục lớp và danh sách sinh viên trong từng lớp.

### 5.1. Tạo lớp thủ công

Khi tạo lớp, nhập:

- Mã lớp: chỉ dùng chữ in hoa, số, dấu gạch dưới hoặc gạch ngang, ví dụ `QLNI-K25-L1`.
- Tên lớp: ví dụ `Quản lý nhân lực K25 - Lớp 1`.
- Ngành: chọn ngành tương ứng.
- Năm nhập học: ví dụ `2025`.

Sau khi tạo lớp, có thể mở chi tiết lớp để xem danh sách sinh viên và gán lớp trưởng.

### 5.2. Import danh sách lớp

Nếu có file Excel danh mục lớp:

1. Tải mẫu import lớp nếu giao diện có nút tải mẫu.
2. Điền đúng các cột trong mẫu.
3. Tải file lên.
4. Kiểm tra màn hình xem trước.
5. Xác nhận import nếu dữ liệu đúng.

Nếu import báo lỗi, đọc dòng lỗi, sửa file Excel rồi import lại. Không nên sửa trực tiếp trong cơ sở dữ liệu.

### 5.3. Gán lớp trưởng

Để gán lớp trưởng cho lớp:

1. Mở chi tiết lớp.
2. Chọn mục Lớp trưởng hoặc Phân quyền lớp.
3. Chọn một hoặc nhiều tài khoản có role lớp trưởng.
4. Lưu thay đổi.

Lưu ý: Tài khoản lớp trưởng cần được tạo trước trong trang Tài khoản hoặc bằng seed. Một tài khoản lớp trưởng chỉ nên phụ trách lớp được phân công.

## 6. Quản lý Sinh viên

Trang Sinh viên dùng để tạo hồ sơ sinh viên, cập nhật thông tin cá nhân và gán sinh viên vào lớp.

### 6.1. Tạo sinh viên thủ công

Thông tin thường cần nhập:

- Tên đăng nhập.
- Email.
- Mật khẩu.
- Họ và tên.
- Số điện thoại, nếu có.
- Ngày sinh, nếu có.
- Lớp và mã sinh viên, nếu muốn gán lớp ngay khi tạo.

Tên đăng nhập chỉ nên dùng chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang. Không nhập khoảng trắng.

### 6.2. Import sinh viên

Quy trình import:

1. Vào trang Sinh viên.
2. Tải mẫu import sinh viên nếu có.
3. Điền dữ liệu theo mẫu. Các cột thường dùng gồm mã sinh viên, họ tên, email, số điện thoại, ngày sinh và lớp.
4. Tải file Excel lên.
5. Kiểm tra màn hình xem trước:
   - Tài khoản tạo mới.
   - Sinh viên đã tồn tại sẽ được ghi danh vào lớp.
   - Dòng bị lỗi hoặc bị bỏ qua.
6. Bấm xác nhận import.

Lưu ý quan trọng:

- Mã sinh viên phải duy nhất.
- Email phải duy nhất.
- Nếu sinh viên đã thuộc lớp khác, cần kiểm tra và chuyển lớp thủ công trước khi import.
- Nếu hệ thống chưa cấu hình gửi email, tài khoản vẫn được tạo nhưng email thông báo tài khoản sẽ chưa được gửi.

### 6.3. Xem lịch sử đánh giá của sinh viên

Trong chi tiết sinh viên, admin có thể xem các phiếu đánh giá theo học kỳ để kiểm tra trạng thái, điểm sinh viên tự chấm, điểm cấp lớp hoặc điểm cuối.

## 7. Quản lý Tài khoản

Trang Tài khoản dùng để quản lý người dùng không chỉ là sinh viên, ví dụ admin, lớp trưởng, cố vấn học tập, khoa và phòng đào tạo.

Các thao tác chính:

- Tạo tài khoản.
- Cập nhật thông tin tài khoản.
- Khóa hoặc mở khóa tài khoản.
- Xóa tài khoản khi không còn dùng.
- Gán vai trò phù hợp.

Các vai trò thường gặp:

- `admin`: quản trị toàn hệ thống.
- `student`: sinh viên.
- `class_leader`: lớp trưởng.
- `advisor`: cố vấn học tập.
- `faculty`: tài khoản khoa.
- `training_department`: phòng đào tạo.

Khi khóa tài khoản, người dùng không thể đăng nhập cho đến khi được mở khóa.

## 8. Quản lý Học kỳ

Trang Học kỳ dùng để tạo đợt đánh giá rèn luyện.

Khi tạo học kỳ, nhập:

- Năm học hoặc năm bắt đầu.
- Học kỳ.
- Ngày bắt đầu.
- Ngày kết thúc.
- Hạn sinh viên nộp phiếu.
- Hạn cấp lớp xử lý.
- Hạn cấp khoa xử lý.

Sau khi tạo, bật trạng thái hoạt động cho học kỳ cần dùng. Khi một học kỳ hoạt động, sinh viên và các cấp duyệt sẽ thao tác trên học kỳ đó.

Lưu ý:

- Không nên tạo các học kỳ có khoảng thời gian chồng lấn.
- Trước khi tắt học kỳ, kiểm tra các phiếu đang xử lý dở.
- Khi thay đổi hạn, nên thông báo lại cho sinh viên và các cấp duyệt.

## 9. Quản lý Phiếu đánh giá rèn luyện

Trang Đánh giá dùng để admin theo dõi và duyệt kết quả cuối.

### 9.1. Lọc và tìm phiếu

Có thể lọc theo:

- Học kỳ.
- Năm học.
- Trạng thái phiếu.
- Lớp.
- Khoa.
- Từ khóa tìm kiếm sinh viên.

Các trạng thái thường gặp:

- `draft`: sinh viên đang làm hoặc lưu nháp.
- `submitted`: sinh viên đã nộp, chờ cấp lớp.
- `class_leader_approved`: lớp trưởng đã chuyển lên cố vấn.
- `class_approved`: cố vấn đã duyệt lớp.
- `faculty_approved`: khoa đã gửi lên phòng đào tạo.
- `finalized`: kết quả đã được duyệt cuối.
- `rejected`: phiếu bị trả về.

### 9.2. Duyệt từng phiếu

1. Mở danh sách phiếu.
2. Lọc đúng học kỳ và lớp hoặc khoa.
3. Mở phiếu cần duyệt.
4. Kiểm tra điểm và xếp loại.
5. Nhập điểm cuối nếu cần điều chỉnh.
6. Bấm duyệt hoặc hoàn tất.

Điểm cuối hợp lệ nằm trong khoảng 0 đến 100.

### 9.3. Duyệt hàng loạt

Khi nhiều phiếu đã sẵn sàng:

1. Lọc danh sách theo học kỳ, khoa, lớp hoặc trạng thái.
2. Chọn các phiếu cần duyệt hoặc dùng chức năng duyệt theo bộ lọc.
3. Kiểm tra lại số lượng phiếu sẽ được xử lý.
4. Xác nhận duyệt hàng loạt.

Chỉ nên duyệt hàng loạt khi dữ liệu đã được cấp lớp và cấp khoa kiểm tra đầy đủ.

### 9.4. Mở lại phiếu đã duyệt

Nếu cần sửa kết quả sau khi đã duyệt cuối, dùng chức năng mở lại phiếu. Sau khi mở lại, kiểm tra lại điểm và thực hiện quy trình duyệt lại theo đúng trạng thái hiện hành.

## 10. Báo cáo và xuất file

Trang Báo cáo dùng để tổng hợp kết quả rèn luyện.

Các báo cáo thường dùng:

- Tổng quan toàn hệ thống.
- Kết quả rèn luyện theo học kỳ.
- Thống kê theo lớp.
- Thống kê theo khoa.
- Xuất danh sách kết quả ra PDF.

Khi xuất báo cáo:

1. Chọn học kỳ hoặc năm học.
2. Chọn khoa hoặc lớp nếu cần lọc hẹp.
3. Kiểm tra số liệu trên màn hình.
4. Bấm xuất file.
5. Mở file tải về để kiểm tra tên lớp, khoa, học kỳ và số lượng sinh viên.

Nếu số liệu báo cáo không đúng, kiểm tra lại trạng thái phiếu. Các phiếu chưa được gửi hoặc chưa duyệt có thể chưa xuất hiện trong nhóm kết quả mong muốn.

## 11. Lỗi thường gặp và cách xử lý

### Không đăng nhập được

- Kiểm tra tên đăng nhập và mật khẩu.
- Kiểm tra tài khoản có bị khóa không.
- Nếu quên mật khẩu, dùng chức năng đặt lại mật khẩu hoặc nhờ admin khác cập nhật.

### Không thấy dữ liệu sau khi import

- Kiểm tra đã bấm xác nhận import chưa.
- Kiểm tra bộ lọc trên màn hình.
- Kiểm tra file import có đúng mã lớp, mã ngành và mã khoa không.

### Import báo trùng mã sinh viên

- Tìm mã sinh viên đó trong trang Sinh viên.
- Nếu sinh viên đã tồn tại, kiểm tra sinh viên đang thuộc lớp nào.
- Nếu thuộc lớp sai, xử lý chuyển lớp trước khi import lại.

### Không gán được lớp trưởng

- Kiểm tra tài khoản lớp trưởng đã tồn tại chưa.
- Kiểm tra tài khoản có role `class_leader` chưa.
- Kiểm tra lớp đã được tạo và đang hoạt động.

### Không duyệt được phiếu

- Kiểm tra trạng thái phiếu đã đến bước admin hoặc phòng đào tạo chưa.
- Kiểm tra điểm cuối có nằm trong khoảng 0 đến 100 không.
- Kiểm tra học kỳ còn đang hoạt động không.

## 12. Checklist trước khi mở đợt đánh giá

- Khoa đã đủ và đang hoạt động.
- Ngành đã đủ và gắn đúng khoa.
- Lớp đã đủ và gắn đúng ngành.
- Sinh viên đã được import và gán đúng lớp.
- Lớp trưởng, cố vấn học tập và tài khoản khoa đã được tạo.
- Lớp trưởng đã được gán vào lớp.
- Học kỳ đánh giá đã được tạo.
- Hạn nộp và hạn duyệt đã đúng.
- Tài khoản admin có thể xem danh sách phiếu và báo cáo.

## 13. Checklist trước khi chốt kết quả

- Lọc đúng học kỳ và năm học.
- Kiểm tra các phiếu chưa nộp hoặc chưa được cấp lớp xử lý.
- Kiểm tra các lớp chưa gửi lên khoa hoặc phòng đào tạo.
- Kiểm tra các phiếu có điểm bất thường.
- Xuất báo cáo thử và đối chiếu số lượng sinh viên.
- Chỉ duyệt cuối khi dữ liệu đã được xác nhận.
