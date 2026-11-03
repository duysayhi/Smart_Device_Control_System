-- =====================================================================
-- GỠ CÀI ĐẶT Teach Mode: xóa DUY NHẤT schema `teach_mode` (và mọi thứ bên trong, gồm dữ liệu Teach).
-- KHÔNG đụng schema phone_commander hay bảng cũ. Chỉ chạy khi muốn bỏ hẳn/cài lại từ đầu.
-- =====================================================================
DROP SCHEMA IF EXISTS teach_mode CASCADE;
