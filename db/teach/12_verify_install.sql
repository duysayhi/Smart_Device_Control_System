-- =====================================================================
-- 12_verify_install.sql — CHỈ ĐỌC. Chạy SAU khi cài. Mọi truy vấn ghi rõ schema, không phụ thuộc search_path.
-- =====================================================================
-- V1. Đã cài xong?                 KỲ VỌNG: 1 dòng (1, teach_mode_v1)
SELECT version, name, applied_at FROM teach_mode.teach_schema_migrations;

-- V2. Số bảng thật trong schema    KỲ VỌNG: 10 (9 bảng nghiệp vụ + teach_schema_migrations)
SELECT count(*) AS so_bang FROM pg_class c
WHERE c.relnamespace = 'teach_mode'::regnamespace AND c.relkind = 'r';

-- V3. Số trigger                   KỲ VỌNG: 15
SELECT count(*) AS so_trigger FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal AND c.relnamespace = 'teach_mode'::regnamespace;

-- V4. Hàm teach_* đã ghim search_path   KỲ VỌNG: 14 hàm, các hàm đọc bảng có proconfig chứa search_path
SELECT p.proname, p.proconfig FROM pg_proc p
WHERE p.pronamespace = 'teach_mode'::regnamespace AND p.proname LIKE 'teach\_%' ORDER BY 1;

-- V5. Consent                       KỲ VỌNG: false cho tới khi chủ dự án INSERT dòng consent
SELECT teach_mode.teach_has_remote_consent() AS co_consent_toan_cuc;

-- V6. Số CHECK còn NOT VALID        KỲ VỌNG: 28 (bình thường, bảng đang rỗng)
SELECT count(*) AS so_check_not_valid FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid
WHERE cl.relnamespace = 'teach_mode'::regnamespace AND co.contype = 'c' AND NOT co.convalidated;

-- V7. Schema cũ có còn nguyên không?  KỲ VỌNG: số bảng của phone_commander giống trước khi cài (không đổi)
SELECT count(*) AS so_bang_phone_commander FROM pg_class c
WHERE c.relnamespace = to_regnamespace('phone_commander') AND c.relkind = 'r';
