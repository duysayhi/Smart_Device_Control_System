-- =====================================================================
-- PHONE COMMANDER — TEACH MODE — CÀI ĐẶT SCHEMA MỚI `teach_mode` (PostgreSQL 13+, đã thử trên Postgres 17 qua PGlite)
-- Một file, một transaction: thành công thì có đủ; lỗi ở đâu thì không để lại gì.
-- AN TOÀN: chỉ TẠO schema mới `teach_mode`. KHÔNG đụng schema phone_commander hay bất kỳ bảng cũ nào.
--          Không có DROP. Nếu schema teach_mode đã tồn tại thì dừng ngay (không ghi đè).
-- Cách chạy (Neon SQL Editor, trên BRANCH thử, không phải primary):
--   1. Mở branch thử, dán toàn bộ file này, bấm Run (một lần).
--   2. Nếu báo lỗi: chạy  ROLLBACK;  rồi gửi nguyên văn dòng lỗi. Đừng sửa file.
--   3. Chạy 12_verify_install.sql, rồi cấp consent (xem GHI CHÚ cuối file).
-- Ứng dụng dùng schema qua biến cấu hình TEACH_DATABASE_SCHEMA (mặc định teach_mode); mọi hàm đã ghim search_path.
-- Nội dung: 9 bảng (devices, executions, skills, skill_versions, teach_sessions, ui_snapshots,
--   recorded_actions, skill_tests, consents), ràng buộc, trigger bảo vệ, hàm retention, view thư viện kỹ năng.
-- =====================================================================
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

CREATE SCHEMA teach_mode;
SET LOCAL search_path TO teach_mode, public;

CREATE TABLE IF NOT EXISTS teach_schema_migrations (
  version    integer PRIMARY KEY,
  name       text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- BẢNG NỀN (cột theo thiết kế ban đầu của chủ dự án; ràng buộc được thêm ở phần sau)
-- ---------------------------------------------------------------------
CREATE TABLE devices (
  id uuid NOT NULL DEFAULT gen_random_uuid(), serial_hash text NOT NULL, physical_identity_hash text,
  model text NOT NULL, manufacturer text, android_version text, status text NOT NULL DEFAULT 'DISCONNECTED',
  first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE executions (
  id uuid NOT NULL DEFAULT gen_random_uuid(), device_id uuid NOT NULL, skill_version_id uuid, command_corpus_id uuid,
  original_command text, engine text NOT NULL, status text NOT NULL DEFAULT 'PLANNED', router_reason text, terminal_reason text,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, analyze_ms integer, execute_ms integer,
  model_calls integer, rpc_count integer, adb_count integer, runtime_digest text);
CREATE TABLE skills (
  id uuid NOT NULL DEFAULT gen_random_uuid(), name text NOT NULL, description text, owner_ref text,
  app_scope jsonb NOT NULL DEFAULT '[]'::jsonb, status text NOT NULL DEFAULT 'DRAFT', current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE skill_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(), skill_id uuid NOT NULL, version_no integer NOT NULL,
  workflow_json jsonb NOT NULL, parameter_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_schema jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'DRAFT',
  schema_version integer NOT NULL DEFAULT 1, compiler_version text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE teach_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(), skill_id uuid, device_id uuid NOT NULL, original_command text,
  status text NOT NULL DEFAULT 'RECORDING', started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
CREATE TABLE ui_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(), teach_session_id uuid NOT NULL, device_id uuid NOT NULL,
  app_package text, activity text, ui_metadata_ref text, screenshot_ref text, content_hash text,
  ui_semantics jsonb NOT NULL DEFAULT '{}'::jsonb, captured_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz);
CREATE TABLE recorded_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid(), session_id uuid NOT NULL, step_order integer NOT NULL,
  action_type text NOT NULL, semantic_target jsonb NOT NULL DEFAULT '{}'::jsonb, input_template text,
  before_snapshot_id uuid, after_snapshot_id uuid, recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE skill_tests (
  id uuid NOT NULL DEFAULT gen_random_uuid(), skill_version_id uuid NOT NULL, device_id uuid NOT NULL, execution_id uuid,
  app_package text, app_version text, test_kind text NOT NULL DEFAULT 'OFFLINE', result text NOT NULL DEFAULT 'UNVERIFIED',
  evidence_ref text, verifier_name text, tested_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE consents (
  id uuid NOT NULL DEFAULT gen_random_uuid(), subject_ref text NOT NULL, device_id uuid,
  consent_type text NOT NULL, granted boolean NOT NULL, scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, revoked_at timestamptz);


-- ---------------------------------------------------------------------
-- 0. Hàm hỗ trợ tạm (biến mất sau phiên)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.teach_ensure_pk(p_tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indrelid = p_tbl AND indisprimary) THEN
    EXECUTE format('ALTER TABLE %s ADD PRIMARY KEY (id)', p_tbl);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.teach_add_check(p_tbl regclass, p_name text, p_expr text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = p_tbl AND conname = p_name) THEN
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (%s) NOT VALID', p_tbl, p_name, p_expr);
  END IF;
END $$;

-- FK: so khớp theo CẤU TRÚC (bảng, cột nguồn, cột đích, ON DELETE). Có FK tương đương thì giữ;
-- có FK cùng cột nhưng KHÁC ngữ nghĩa thì DỪNG (không âm thầm giữ), để xử lý thủ công.
CREATE OR REPLACE FUNCTION pg_temp.teach_ensure_fk(
  p_tbl regclass, p_col text, p_ref regclass, p_refcol text,
  p_name text, p_ondelete text, p_deferrable boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_att smallint; v_ratt smallint; v_row pg_constraint%ROWTYPE; v_want "char";
BEGIN
  SELECT attnum INTO v_att FROM pg_attribute WHERE attrelid = p_tbl AND attname = p_col AND NOT attisdropped;
  IF v_att IS NULL THEN RAISE EXCEPTION 'Không thấy cột %.%', p_tbl, p_col; END IF;
  SELECT attnum INTO v_ratt FROM pg_attribute WHERE attrelid = p_ref AND attname = p_refcol AND NOT attisdropped;
  IF v_ratt IS NULL THEN RAISE EXCEPTION 'Không thấy cột đích %.%', p_ref, p_refcol; END IF;
  v_want := CASE upper(p_ondelete) WHEN 'CASCADE' THEN 'c' WHEN 'SET NULL' THEN 'n' WHEN 'RESTRICT' THEN 'r' ELSE 'a' END;

  SELECT * INTO v_row FROM pg_constraint
   WHERE conrelid = p_tbl AND contype = 'f' AND confrelid = p_ref AND conkey = ARRAY[v_att] LIMIT 1;
  IF FOUND THEN
    IF v_row.confkey <> ARRAY[v_ratt] THEN
      RAISE EXCEPTION 'FK %.% ("%") trỏ tới cột đích khác "%". Xử lý thủ công rồi chạy lại', p_tbl, p_col, v_row.conname, p_refcol;
    END IF;
    IF NOT (v_row.confdeltype = v_want OR (v_row.confdeltype IN ('a','r') AND v_want IN ('a','r'))) THEN
      RAISE EXCEPTION 'FK %.% ("%") có ON DELETE khác (có "%", cần "%"). Xử lý thủ công rồi chạy lại',
        p_tbl, p_col, v_row.conname, v_row.confdeltype, v_want;
    END IF;
    IF p_deferrable AND NOT v_row.condeferrable THEN
      RAISE NOTICE 'FK %.% ("%") giữ nguyên, không DEFERRABLE', p_tbl, p_col, v_row.conname;
    END IF;
    RETURN;
  END IF;
  EXECUTE format(
    'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s (%I) ON DELETE %s%s',
    p_tbl, p_name, p_col, p_ref, p_refcol, p_ondelete,
    CASE WHEN p_deferrable THEN ' DEFERRABLE INITIALLY DEFERRED' ELSE '' END);
END $$;

SELECT pg_temp.teach_ensure_pk(t)
FROM unnest(ARRAY['devices','executions','skills','skill_versions','teach_sessions',
                  'ui_snapshots','recorded_actions','skill_tests']::regclass[]) AS t;

-- ---------------------------------------------------------------------
-- 1. Hàm dùng chung
-- ---------------------------------------------------------------------
CREATE FUNCTION teach_has_forbidden_keys(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NOT NULL AND (
       jsonb_path_exists(p, '$.**.bounds')
    OR jsonb_path_exists(p, '$.**.rawPoint')
    OR jsonb_path_exists(p, '$.**.raw_point')
    OR jsonb_path_exists(p, '$.**.tapPoint')
    OR jsonb_path_exists(p, '$.**.point')
    OR jsonb_path_exists(p, '$.**.coordinates')
    OR jsonb_path_exists(p, '$.**.elementId')
    OR jsonb_path_exists(p, '$.**.candidateId')
    OR jsonb_path_exists(p, '$.**.grant')
    OR jsonb_path_exists(p, '$.**.proof')
    OR jsonb_path_exists(p, '$.**.verified'))
$$;

-- D4: đồng ý ghi dữ liệu Teach lên DB từ xa. Dùng đúng bảng consents hiện có.
--   Hợp lệ khi: có dòng consent_type='TEACH_REMOTE_STORAGE', granted, chưa revoked, chưa hết hạn,
--   đúng chủ (subject_ref), phạm vi thiết bị (device_id NULL = mọi thiết bị) và KHÔNG có dòng từ chối mới hơn.
CREATE FUNCTION teach_has_remote_consent(p_device uuid DEFAULT NULL, p_subject text DEFAULT 'local-owner')
RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT EXISTS (
    SELECT 1 FROM consents c
     WHERE c.subject_ref = p_subject
       AND c.consent_type = 'TEACH_REMOTE_STORAGE'
       AND c.granted AND c.revoked_at IS NULL
       AND (c.expires_at IS NULL OR c.expires_at > now())
       AND (c.device_id IS NULL OR c.device_id = p_device)
       AND NOT EXISTS (
         SELECT 1 FROM consents d
          WHERE d.subject_ref = c.subject_ref AND d.consent_type = c.consent_type
            AND NOT d.granted AND d.created_at > c.created_at
            AND (d.device_id IS NULL OR d.device_id = p_device)))
$$;

-- Chặn INSERT khi chưa có consent. Chỉ chặn GHI MỚI: UPDATE (nhả lock, dọn dẹp) và DELETE
-- (retention/xóa theo yêu cầu) luôn được phép, kể cả sau khi thu hồi consent.
CREATE FUNCTION teach_consent_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE v_device uuid;
BEGIN
  IF TG_TABLE_NAME = 'recorded_actions' THEN
    SELECT device_id INTO v_device FROM teach_sessions WHERE id = NEW.session_id;
  ELSIF TG_TABLE_NAME IN ('teach_sessions','ui_snapshots','skill_tests') THEN
    v_device := NEW.device_id;
  END IF;
  IF NOT teach_has_remote_consent(v_device) THEN
    RAISE EXCEPTION 'TEACH_NO_CONSENT: chưa có đồng ý hợp lệ (consents.consent_type=TEACH_REMOTE_STORAGE) để ghi vào %', TG_TABLE_NAME
      USING ERRCODE = 'TH011';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 2. devices
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_devices_physical_identity
  ON devices (physical_identity_hash) WHERE physical_identity_hash IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. skills
-- ---------------------------------------------------------------------
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
  ALTER COLUMN owner_ref SET DEFAULT 'local-owner';

SELECT pg_temp.teach_add_check('skills', 'ck_skills_status',
  $c$status IN ('DRAFT','PENDING_VALIDATION','VERIFIED','PUBLISHED','REJECTED','DISABLED','DEPRECATED')$c$);
SELECT pg_temp.teach_add_check('skills', 'ck_skills_name_len', $c$length(name) BETWEEN 1 AND 120$c$);
SELECT pg_temp.teach_add_check('skills', 'ck_skills_app_scope_array', $c$jsonb_typeof(app_scope) = 'array'$c$);
SELECT pg_temp.teach_add_check('skills', 'ck_skills_revision_pos', $c$revision >= 1$c$);

-- ---------------------------------------------------------------------
-- 4. teach_sessions  (D3: danh tính vật lý ở phiên; D5: máy trạng thái + revision)
-- ---------------------------------------------------------------------
ALTER TABLE teach_sessions
  ADD COLUMN IF NOT EXISTS created_at           timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS recording_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS raw_expires_at       timestamptz DEFAULT (now() + interval '7 days'),
  ADD COLUMN IF NOT EXISTS interrupted_reason   text,
  ADD COLUMN IF NOT EXISTS ownership_state      text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS device_identity_hash text,
  ADD COLUMN IF NOT EXISTS revision             integer NOT NULL DEFAULT 1,
  ALTER COLUMN status SET DEFAULT 'CREATED';

UPDATE teach_sessions s SET device_identity_hash = d.physical_identity_hash
  FROM devices d WHERE d.id = s.device_id AND s.device_identity_hash IS NULL;

SELECT pg_temp.teach_add_check('teach_sessions', 'ck_teach_sessions_status',
  $c$status IN ('CREATED','RECORDING','REVIEWING','COMPILED','FINISHED','CANCELLED','FAILED','EXPIRED','INTERRUPTED')$c$);
SELECT pg_temp.teach_add_check('teach_sessions', 'ck_teach_sessions_ownership',
  $c$ownership_state IN ('NONE','HELD','RELEASED','RETAINED_PENDING_CLEANUP')$c$);
SELECT pg_temp.teach_add_check('teach_sessions', 'ck_teach_sessions_interrupted_reason',
  $c$status <> 'INTERRUPTED' OR interrupted_reason IS NOT NULL$c$);
SELECT pg_temp.teach_add_check('teach_sessions', 'ck_teach_sessions_time_order',
  $c$finished_at IS NULL OR finished_at >= started_at$c$);
SELECT pg_temp.teach_add_check('teach_sessions', 'ck_teach_sessions_command_len',
  $c$original_command IS NULL OR length(original_command) <= 500$c$);
SELECT pg_temp.teach_add_check('teach_sessions', 'ck_teach_sessions_revision_pos', $c$revision >= 1$c$);

-- D3: khóa theo DANH TÍNH VẬT LÝ (không theo UUID): hai UUID cùng một máy không thể cùng giữ lock.
-- (Phản chiếu trong DB; khóa thiết bị ở runtime vẫn là nguồn quyết định thật.)
CREATE UNIQUE INDEX IF NOT EXISTS ux_teach_sessions_identity_ownership
  ON teach_sessions (device_identity_hash)
  WHERE ownership_state IN ('HELD','RETAINED_PENDING_CLEANUP') AND device_identity_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_teach_sessions_device ON teach_sessions (device_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_teach_sessions_expiry ON teach_sessions (raw_expires_at)
  WHERE raw_expires_at IS NOT NULL;

SELECT pg_temp.teach_ensure_fk('teach_sessions','device_id','devices','id','fk_teach_sessions_device','RESTRICT');
SELECT pg_temp.teach_ensure_fk('teach_sessions','skill_id','skills','id','fk_teach_sessions_skill','SET NULL');

CREATE FUNCTION teach_sessions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_hash text; v_ok boolean;
  v_terminal text[] := ARRAY['FINISHED','CANCELLED','FAILED','EXPIRED'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT physical_identity_hash INTO v_hash FROM devices WHERE id = NEW.device_id;
    IF v_hash IS NULL THEN
      RAISE EXCEPTION 'TEACH_NO_PHYSICAL_IDENTITY: thiết bị % chưa có physical_identity_hash, không được bắt đầu dạy', NEW.device_id
        USING ERRCODE = 'TH008';
    END IF;
    NEW.device_identity_hash := v_hash;
    IF NEW.status <> 'CREATED' THEN
      RAISE EXCEPTION 'TEACH_TRANSITION: phiên mới phải bắt đầu ở CREATED (nhận %)', NEW.status USING ERRCODE = 'TH002';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.device_id             IS DISTINCT FROM OLD.device_id
  OR NEW.device_identity_hash  IS DISTINCT FROM OLD.device_identity_hash
  OR NEW.original_command      IS DISTINCT FROM OLD.original_command
  OR NEW.started_at            IS DISTINCT FROM OLD.started_at
  OR NEW.created_at            IS DISTINCT FROM OLD.created_at
  OR (OLD.skill_id IS NOT NULL AND NEW.skill_id IS NOT NULL AND NEW.skill_id IS DISTINCT FROM OLD.skill_id) THEN
    RAISE EXCEPTION 'TEACH_IMMUTABLE: thiết bị/danh tính/lệnh gốc/thời điểm bắt đầu của phiên % không được đổi', OLD.id
      USING ERRCODE = 'TH001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_ok := CASE OLD.status
      WHEN 'CREATED'     THEN NEW.status IN ('RECORDING','CANCELLED','FAILED','EXPIRED')
      WHEN 'RECORDING'   THEN NEW.status IN ('REVIEWING','CANCELLED','FAILED','INTERRUPTED','EXPIRED')
      WHEN 'REVIEWING'   THEN NEW.status IN ('COMPILED','CANCELLED','FAILED','EXPIRED')
      WHEN 'COMPILED'    THEN NEW.status IN ('FINISHED','REVIEWING','CANCELLED','FAILED','EXPIRED')
      WHEN 'INTERRUPTED' THEN NEW.status IN ('REVIEWING','FAILED','CANCELLED','EXPIRED')
      ELSE false
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'TEACH_TRANSITION: không cho phép chuyển trạng thái phiên % -> %', OLD.status, NEW.status
        USING ERRCODE = 'TH002';
    END IF;
  END IF;

  IF NEW.ownership_state IS DISTINCT FROM OLD.ownership_state THEN
    v_ok := CASE OLD.ownership_state
      WHEN 'NONE'                     THEN NEW.ownership_state = 'HELD'
      WHEN 'HELD'                     THEN NEW.ownership_state IN ('RELEASED','RETAINED_PENDING_CLEANUP')
      WHEN 'RETAINED_PENDING_CLEANUP' THEN NEW.ownership_state = 'RELEASED'
      ELSE false
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'TEACH_TRANSITION: không cho phép chuyển ownership % -> %', OLD.ownership_state, NEW.ownership_state
        USING ERRCODE = 'TH002';
    END IF;
  END IF;

  -- Mất kết nối: phải GIỮ ownership cho tới khi chứng minh cleanup, không được nhả ngay.
  IF NEW.status = 'INTERRUPTED' AND OLD.ownership_state = 'HELD'
     AND NEW.ownership_state <> 'RETAINED_PENDING_CLEANUP' THEN
    RAISE EXCEPTION 'TEACH_TRANSITION: INTERRUPTED phải chuyển ownership sang RETAINED_PENDING_CLEANUP' USING ERRCODE = 'TH002';
  END IF;

  IF NEW.status = 'RECORDING' AND OLD.status <> 'RECORDING' AND NEW.recording_started_at IS NULL THEN
    NEW.recording_started_at := now();
  END IF;
  IF NEW.status = ANY (v_terminal) AND NEW.finished_at IS NULL THEN
    NEW.finished_at := now();
  END IF;
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_teach_sessions_guard
  BEFORE INSERT OR UPDATE ON teach_sessions
  FOR EACH ROW EXECUTE FUNCTION teach_sessions_guard();

-- ---------------------------------------------------------------------
-- 5. ui_snapshots  (mặc định FAIL-CLOSED: phải khai báo REDACTED rõ ràng)
-- ---------------------------------------------------------------------
ALTER TABLE ui_snapshots
  ADD COLUMN IF NOT EXISTS locale            text,
  ADD COLUMN IF NOT EXISTS orientation       text,
  ADD COLUMN IF NOT EXISTS screen_size       jsonb,
  ADD COLUMN IF NOT EXISTS redaction_status  text NOT NULL DEFAULT 'CAPTURE_SAFETY_UNKNOWN',
  ADD COLUMN IF NOT EXISTS no_capture_reason text,
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');

SELECT pg_temp.teach_add_check('ui_snapshots', 'ck_ui_snapshots_redaction',
  $c$redaction_status IN ('REDACTED','CAPTURE_SAFETY_UNKNOWN','SENSITIVE_CONTENT_OMITTED')$c$);
SELECT pg_temp.teach_add_check('ui_snapshots', 'ck_ui_snapshots_screenshot_needs_redaction',
  $c$screenshot_ref IS NULL OR redaction_status = 'REDACTED'$c$);
SELECT pg_temp.teach_add_check('ui_snapshots', 'ck_ui_snapshots_unsafe_has_reason',
  $c$redaction_status = 'REDACTED' OR no_capture_reason IS NOT NULL$c$);

CREATE INDEX IF NOT EXISTS ix_ui_snapshots_session ON ui_snapshots (teach_session_id, captured_at);
CREATE INDEX IF NOT EXISTS ix_ui_snapshots_expiry  ON ui_snapshots (expires_at) WHERE expires_at IS NOT NULL;

SELECT pg_temp.teach_ensure_fk('ui_snapshots','teach_session_id','teach_sessions','id','fk_ui_snapshots_session','CASCADE');
SELECT pg_temp.teach_ensure_fk('ui_snapshots','device_id','devices','id','fk_ui_snapshots_device','RESTRICT');

-- D3: snapshot phải cùng thiết bị với phiên; chỉ ghi khi phiên đang RECORDING.
CREATE FUNCTION teach_ui_snapshots_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE v_dev uuid; v_status text;
BEGIN
  SELECT device_id, status INTO v_dev, v_status FROM teach_sessions WHERE id = NEW.teach_session_id;
  IF NOT FOUND THEN RETURN NEW; END IF;  -- để FK báo lỗi
  IF NEW.device_id IS DISTINCT FROM v_dev THEN
    RAISE EXCEPTION 'TEACH_DEVICE_MISMATCH: snapshot thuộc thiết bị khác phiên dạy' USING ERRCODE = 'TH009';
  END IF;
  IF TG_OP = 'INSERT' AND v_status <> 'RECORDING' THEN
    RAISE EXCEPTION 'TEACH_NOT_RECORDING: chỉ ghi snapshot khi phiên đang RECORDING (hiện %)', v_status USING ERRCODE = 'TH012';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_ui_snapshots_guard
  BEFORE INSERT OR UPDATE ON ui_snapshots
  FOR EACH ROW EXECUTE FUNCTION teach_ui_snapshots_guard();

-- ---------------------------------------------------------------------
-- 6. recorded_actions
-- ---------------------------------------------------------------------
ALTER TABLE recorded_actions
  ADD COLUMN IF NOT EXISTS receipt_status     text    NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS safe_args          jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS diagnostic         jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS no_snapshot_reason text,
  ADD COLUMN IF NOT EXISTS skipped            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS input_redacted     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS execution_id       uuid;

SELECT pg_temp.teach_add_check('recorded_actions', 'ck_recorded_actions_type',
  $c$action_type IN ('OPEN_APP','PRESS_KEY','TAP_ELEMENT','TAP_POINT','INPUT_TEXT','CLEAR_TEXT',
                     'SWIPE','SCROLL_ELEMENT','WAIT_FOR_STATE','MARK_CHECKPOINT','MARK_RESULT')$c$);
SELECT pg_temp.teach_add_check('recorded_actions', 'ck_recorded_actions_receipt',
  $c$receipt_status IN ('ACK','NOT_SENT','UNKNOWN')$c$);
SELECT pg_temp.teach_add_check('recorded_actions', 'ck_recorded_actions_step_pos', $c$step_order >= 1$c$);
SELECT pg_temp.teach_add_check('recorded_actions', 'ck_recorded_actions_no_coords_in_target',
  $c$NOT teach_has_forbidden_keys(semantic_target)$c$);
SELECT pg_temp.teach_add_check('recorded_actions', 'ck_recorded_actions_redacted_input',
  $c$input_redacted = false OR input_template IS NULL$c$);

CREATE UNIQUE INDEX IF NOT EXISTS ux_recorded_actions_session_step ON recorded_actions (session_id, step_order);
CREATE INDEX IF NOT EXISTS ix_recorded_actions_execution ON recorded_actions (execution_id) WHERE execution_id IS NOT NULL;

SELECT pg_temp.teach_ensure_fk('recorded_actions','session_id','teach_sessions','id','fk_recorded_actions_session','CASCADE');
SELECT pg_temp.teach_ensure_fk('recorded_actions','before_snapshot_id','ui_snapshots','id','fk_recorded_actions_before','SET NULL');
SELECT pg_temp.teach_ensure_fk('recorded_actions','after_snapshot_id','ui_snapshots','id','fk_recorded_actions_after','SET NULL');
SELECT pg_temp.teach_ensure_fk('recorded_actions','execution_id','executions','id','fk_recorded_actions_execution','SET NULL');

-- D3: snapshot của action phải thuộc CÙNG phiên (chỉ kiểm khi GÁN giá trị mới, để retention/SET NULL không bị chặn);
--     chỉ ghi action mới khi phiên đang RECORDING.
CREATE FUNCTION teach_recorded_actions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    RAISE EXCEPTION 'TEACH_IMMUTABLE: không được chuyển action sang phiên khác' USING ERRCODE = 'TH001';
  END IF;
  SELECT status INTO v_status FROM teach_sessions WHERE id = NEW.session_id;
  IF TG_OP = 'INSERT' AND FOUND AND v_status <> 'RECORDING' THEN
    RAISE EXCEPTION 'TEACH_NOT_RECORDING: chỉ ghi action khi phiên đang RECORDING (hiện %)', v_status USING ERRCODE = 'TH012';
  END IF;
  IF NEW.before_snapshot_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.before_snapshot_id IS DISTINCT FROM OLD.before_snapshot_id) AND NOT EXISTS (
       SELECT 1 FROM ui_snapshots WHERE id = NEW.before_snapshot_id AND teach_session_id = NEW.session_id) THEN
    RAISE EXCEPTION 'TEACH_SNAPSHOT_SESSION: before_snapshot không thuộc phiên của action' USING ERRCODE = 'TH010';
  END IF;
  IF NEW.after_snapshot_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.after_snapshot_id IS DISTINCT FROM OLD.after_snapshot_id) AND NOT EXISTS (
       SELECT 1 FROM ui_snapshots WHERE id = NEW.after_snapshot_id AND teach_session_id = NEW.session_id) THEN
    RAISE EXCEPTION 'TEACH_SNAPSHOT_SESSION: after_snapshot không thuộc phiên của action' USING ERRCODE = 'TH010';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_recorded_actions_guard
  BEFORE INSERT OR UPDATE ON recorded_actions
  FOR EACH ROW EXECUTE FUNCTION teach_recorded_actions_guard();

-- Mỗi action phải có snapshot trước/sau HOẶC lý do không có (kiểm tra lúc COMMIT).
CREATE FUNCTION teach_recorded_actions_snapshot_rule() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE r recorded_actions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM recorded_actions WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF (r.before_snapshot_id IS NULL OR r.after_snapshot_id IS NULL) AND r.no_snapshot_reason IS NULL THEN
    RAISE EXCEPTION 'TEACH_SNAPSHOT_REQUIRED: action % thiếu snapshot trước/sau và không có no_snapshot_reason', r.id
      USING ERRCODE = 'TH006';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_recorded_actions_snapshot_rule
  AFTER INSERT OR UPDATE ON recorded_actions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION teach_recorded_actions_snapshot_rule();

-- ---------------------------------------------------------------------
-- 7. skill_versions  (D1: ngoại lệ retention; D2: bằng chứng gắn với hash nội dung)
-- ---------------------------------------------------------------------
ALTER TABLE skill_versions
  ADD COLUMN IF NOT EXISTS evidence_level     text NOT NULL DEFAULT 'COMPILED',
  ADD COLUMN IF NOT EXISTS content_hash       text,
  ADD COLUMN IF NOT EXISTS source_session_id  uuid,
  ADD COLUMN IF NOT EXISTS published_at       timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revision           integer NOT NULL DEFAULT 1;

UPDATE skill_versions
   SET content_hash = encode(sha256(convert_to(
         workflow_json::text || E'\n' || parameter_schema::text || E'\n' || verification_schema::text,
         'UTF8')), 'hex')
 WHERE content_hash IS NULL;
UPDATE skill_versions SET published_at = created_at WHERE status = 'PUBLISHED' AND published_at IS NULL;
ALTER TABLE skill_versions ALTER COLUMN content_hash SET NOT NULL;

SELECT pg_temp.teach_add_check('skill_versions', 'ck_skill_versions_status',
  $c$status IN ('DRAFT','PENDING_VALIDATION','VERIFIED','PUBLISHED','REJECTED','DISABLED','DEPRECATED')$c$);
SELECT pg_temp.teach_add_check('skill_versions', 'ck_skill_versions_evidence',
  $c$evidence_level IN ('RECORDED','COMPILED','OFFLINE_TESTED','REAL_DEVICE_TESTED','REAL_DEVICE_VERIFIED','CROSS_DEVICE_VERIFIED')$c$);
SELECT pg_temp.teach_add_check('skill_versions', 'ck_skill_versions_numbers',
  $c$version_no >= 1 AND schema_version >= 1 AND revision >= 1$c$);
SELECT pg_temp.teach_add_check('skill_versions', 'ck_skill_versions_verified_needs_evidence',
  $c$status NOT IN ('VERIFIED','PUBLISHED') OR evidence_level IN ('REAL_DEVICE_VERIFIED','CROSS_DEVICE_VERIFIED')$c$);
SELECT pg_temp.teach_add_check('skill_versions', 'ck_skill_versions_no_forbidden_keys',
  $c$NOT teach_has_forbidden_keys(workflow_json)$c$);
SELECT pg_temp.teach_add_check('skill_versions', 'ck_skill_versions_json_types',
  $c$jsonb_typeof(workflow_json) = 'object' AND jsonb_typeof(parameter_schema) = 'object'
     AND jsonb_typeof(verification_schema) = 'object'$c$);

CREATE UNIQUE INDEX IF NOT EXISTS ux_skill_versions_skill_version ON skill_versions (skill_id, version_no);
CREATE INDEX IF NOT EXISTS ix_skill_versions_skill ON skill_versions (skill_id);

SELECT pg_temp.teach_ensure_fk('skill_versions','skill_id','skills','id','fk_skill_versions_skill','RESTRICT');
SELECT pg_temp.teach_ensure_fk('skill_versions','source_session_id','teach_sessions','id','fk_skill_versions_session','SET NULL');

CREATE FUNCTION teach_skill_versions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE v_ok boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'TEACH_IMMUTABLE: phiên bản % đã từng PUBLISHED, không được xóa', OLD.id USING ERRCODE = 'TH001';
    END IF;
    RETURN OLD;
  END IF;

  NEW.content_hash := encode(sha256(convert_to(
    NEW.workflow_json::text || E'\n' || NEW.parameter_schema::text || E'\n' || NEW.verification_schema::text,
    'UTF8')), 'hex');

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('DRAFT','PENDING_VALIDATION','REJECTED') THEN
      RAISE EXCEPTION 'TEACH_TRANSITION: phiên bản mới chỉ được tạo ở DRAFT/PENDING_VALIDATION/REJECTED (nhận %)', NEW.status
        USING ERRCODE = 'TH002';
    END IF;
    IF NEW.evidence_level NOT IN ('RECORDED','COMPILED') THEN
      RAISE EXCEPTION 'TEACH_EVIDENCE: evidence_level do skill_tests quyết định, không được khai khi tạo (nhận %)', NEW.evidence_level
        USING ERRCODE = 'TH003';
    END IF;
    NEW.published_at := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE. D1: source_session_id chỉ được về NULL khi phiên nguồn ĐÃ BỊ XÓA (retention); mọi thay đổi khác bị khóa.
  IF OLD.published_at IS NOT NULL AND (
        NEW.workflow_json        IS DISTINCT FROM OLD.workflow_json
     OR NEW.parameter_schema     IS DISTINCT FROM OLD.parameter_schema
     OR NEW.verification_schema  IS DISTINCT FROM OLD.verification_schema
     OR NEW.schema_version       IS DISTINCT FROM OLD.schema_version
     OR NEW.version_no           IS DISTINCT FROM OLD.version_no
     OR NEW.skill_id             IS DISTINCT FROM OLD.skill_id
     OR NEW.compiler_version     IS DISTINCT FROM OLD.compiler_version
     OR (NEW.source_session_id IS DISTINCT FROM OLD.source_session_id
         AND NOT (NEW.source_session_id IS NULL
                  AND NOT EXISTS (SELECT 1 FROM teach_sessions s WHERE s.id = OLD.source_session_id)))) THEN
    RAISE EXCEPTION 'TEACH_IMMUTABLE: nội dung phiên bản % đã PUBLISHED, hãy tạo phiên bản mới', OLD.id USING ERRCODE = 'TH001';
  END IF;

  IF NEW.evidence_level IS DISTINCT FROM OLD.evidence_level AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'TEACH_EVIDENCE: evidence_level chỉ được cập nhật tự động từ skill_tests' USING ERRCODE = 'TH003';
  END IF;

  -- D2: bằng chứng gắn với hash nội dung. Nội dung đổi thì bằng chứng cũ không còn hiệu lực.
  IF NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    IF OLD.status = 'VERIFIED' AND NEW.status = 'VERIFIED' THEN
      RAISE EXCEPTION 'TEACH_EVIDENCE: nội dung đã đổi sau khi VERIFIED; hãy đưa về PENDING_VALIDATION hoặc tạo phiên bản mới'
        USING ERRCODE = 'TH003';
    END IF;
    NEW.evidence_level := teach_compute_evidence_level(NEW.id, NEW.content_hash);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_ok := CASE OLD.status
      WHEN 'DRAFT'              THEN NEW.status IN ('PENDING_VALIDATION','REJECTED')
      WHEN 'PENDING_VALIDATION' THEN NEW.status IN ('DRAFT','VERIFIED','REJECTED')
      WHEN 'VERIFIED'           THEN NEW.status IN ('PENDING_VALIDATION','PUBLISHED','REJECTED')
      WHEN 'PUBLISHED'          THEN NEW.status IN ('DISABLED','DEPRECATED')
      WHEN 'DISABLED'           THEN NEW.status IN ('PUBLISHED','DEPRECATED')
      ELSE false
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'TEACH_TRANSITION: không cho phép chuyển % -> %', OLD.status, NEW.status USING ERRCODE = 'TH002';
    END IF;
    IF NEW.status = 'PUBLISHED' AND NEW.published_at IS NULL THEN NEW.published_at := now(); END IF;
  END IF;
  NEW.published_at := COALESCE(OLD.published_at, NEW.published_at);
  NEW.updated_at := now();
  NEW.revision   := OLD.revision + 1;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_skill_versions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON skill_versions
  FOR EACH ROW EXECUTE FUNCTION teach_skill_versions_guard();

-- ---------------------------------------------------------------------
-- 8. skills
-- ---------------------------------------------------------------------
SELECT pg_temp.teach_ensure_fk('skills','current_version_id','skill_versions','id','fk_skills_current_version','SET NULL', true);

CREATE FUNCTION teach_skills_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM skill_versions v WHERE v.id = NEW.current_version_id AND v.skill_id = NEW.id) THEN
    RAISE EXCEPTION 'TEACH_CURRENT_VERSION: current_version_id phải thuộc đúng skill này' USING ERRCODE = 'TH004';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    NEW.revision   := OLD.revision + 1;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_skills_guard
  BEFORE INSERT OR UPDATE ON skills
  FOR EACH ROW EXECUTE FUNCTION teach_skills_guard();

-- ---------------------------------------------------------------------
-- 9. skill_tests  (D2/D3/D7: gắn hash nội dung, chụp danh tính + hồ sơ thiết bị lúc test)
-- ---------------------------------------------------------------------
ALTER TABLE skill_tests
  ADD COLUMN IF NOT EXISTS parameter_fingerprint  text,
  ADD COLUMN IF NOT EXISTS duration_ms            integer,
  ADD COLUMN IF NOT EXISTS verifier_result        jsonb,
  ADD COLUMN IF NOT EXISTS independently_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS content_hash           text,
  ADD COLUMN IF NOT EXISTS device_physical_hash   text,
  ADD COLUMN IF NOT EXISTS device_profile         text;

-- Backfill dữ liệu cũ (trước khi trigger append-only được tạo)
UPDATE skill_tests t SET content_hash = v.content_hash
  FROM skill_versions v WHERE v.id = t.skill_version_id AND t.content_hash IS NULL;
UPDATE skill_tests t SET device_physical_hash = d.physical_identity_hash,
       device_profile = coalesce(d.manufacturer,'') || '|' || d.model || '|' || coalesce(d.android_version,'')
  FROM devices d WHERE d.id = t.device_id AND t.device_profile IS NULL;
ALTER TABLE skill_tests ALTER COLUMN content_hash SET NOT NULL;

SELECT pg_temp.teach_add_check('skill_tests', 'ck_skill_tests_kind',   $c$test_kind IN ('OFFLINE','REAL_DEVICE')$c$);
SELECT pg_temp.teach_add_check('skill_tests', 'ck_skill_tests_result', $c$result IN ('PASSED','FAILED','BLOCKED','UNVERIFIED')$c$);
SELECT pg_temp.teach_add_check('skill_tests', 'ck_skill_tests_duration', $c$duration_ms IS NULL OR duration_ms >= 0$c$);
SELECT pg_temp.teach_add_check('skill_tests', 'ck_skill_tests_verified_needs_proof',
  $c$independently_verified = false OR
     (test_kind = 'REAL_DEVICE' AND result = 'PASSED' AND verifier_name IS NOT NULL AND execution_id IS NOT NULL)$c$);

-- Mức bằng chứng được TÍNH từ skill_tests, chỉ tính test khớp hash nội dung hiện tại.
-- CROSS_DEVICE: >= 2 danh tính vật lý KHÁC NHAU và >= 2 hồ sơ phần cứng khác nhau (hãng|model|Android).
CREATE FUNCTION teach_compute_evidence_level(p_version uuid, p_hash text) RETURNS text
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT CASE
    WHEN (SELECT count(DISTINCT t.device_physical_hash) FROM skill_tests t
           WHERE t.skill_version_id = p_version AND t.content_hash = p_hash AND t.independently_verified) >= 2
     AND (SELECT count(DISTINCT t.device_profile) FROM skill_tests t
           WHERE t.skill_version_id = p_version AND t.content_hash = p_hash AND t.independently_verified) >= 2
      THEN 'CROSS_DEVICE_VERIFIED'
    WHEN EXISTS (SELECT 1 FROM skill_tests t
                  WHERE t.skill_version_id = p_version AND t.content_hash = p_hash AND t.independently_verified)
      THEN 'REAL_DEVICE_VERIFIED'
    WHEN EXISTS (SELECT 1 FROM skill_tests t
                  WHERE t.skill_version_id = p_version AND t.content_hash = p_hash
                    AND t.test_kind = 'REAL_DEVICE' AND t.result = 'PASSED')
      THEN 'REAL_DEVICE_TESTED'
    WHEN EXISTS (SELECT 1 FROM skill_tests t
                  WHERE t.skill_version_id = p_version AND t.content_hash = p_hash
                    AND t.test_kind = 'OFFLINE' AND t.result = 'PASSED')
      THEN 'OFFLINE_TESTED'
    ELSE 'COMPILED'
  END
$$;

CREATE INDEX IF NOT EXISTS ix_skill_tests_version_device ON skill_tests (skill_version_id, device_id, tested_at DESC);

SELECT pg_temp.teach_ensure_fk('skill_tests','skill_version_id','skill_versions','id','fk_skill_tests_version','RESTRICT');
SELECT pg_temp.teach_ensure_fk('skill_tests','device_id','devices','id','fk_skill_tests_device','RESTRICT');
SELECT pg_temp.teach_ensure_fk('skill_tests','execution_id','executions','id','fk_skill_tests_execution','SET NULL');

-- Điền dữ liệu do DB quyết định (client không khai được) + kiểm tra execution khớp thiết bị/phiên bản.
CREATE FUNCTION teach_skill_tests_fill() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE v_hash text; v_phys text; v_prof text; v_ex executions%ROWTYPE;
BEGIN
  SELECT content_hash INTO v_hash FROM skill_versions WHERE id = NEW.skill_version_id;
  IF NOT FOUND THEN RETURN NEW; END IF;  -- FK báo lỗi
  NEW.content_hash := v_hash;
  SELECT physical_identity_hash, coalesce(manufacturer,'') || '|' || model || '|' || coalesce(android_version,'')
    INTO v_phys, v_prof FROM devices WHERE id = NEW.device_id;
  NEW.device_physical_hash := v_phys;
  NEW.device_profile := v_prof;
  IF NEW.independently_verified AND v_phys IS NULL THEN
    RAISE EXCEPTION 'TEACH_NO_PHYSICAL_IDENTITY: thiết bị chưa có physical_identity_hash, không thể làm bằng chứng độc lập'
      USING ERRCODE = 'TH008';
  END IF;
  IF NEW.execution_id IS NOT NULL THEN
    SELECT * INTO v_ex FROM executions WHERE id = NEW.execution_id;
    IF FOUND AND (v_ex.device_id IS DISTINCT FROM NEW.device_id
               OR v_ex.skill_version_id IS DISTINCT FROM NEW.skill_version_id) THEN
      RAISE EXCEPTION 'TEACH_EXECUTION_MISMATCH: execution % không thuộc đúng thiết bị/phiên bản skill của bài test', NEW.execution_id
        USING ERRCODE = 'TH007';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_skill_tests_fill
  BEFORE INSERT ON skill_tests
  FOR EACH ROW EXECUTE FUNCTION teach_skill_tests_fill();

CREATE FUNCTION teach_skill_tests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TEACH_APPEND_ONLY: skill_tests là bằng chứng, chỉ được thêm mới' USING ERRCODE = 'TH005';
END $$;

CREATE TRIGGER trg_skill_tests_append_only
  BEFORE UPDATE OR DELETE ON skill_tests
  FOR EACH ROW EXECUTE FUNCTION teach_skill_tests_guard();

CREATE FUNCTION teach_skill_tests_after_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE skill_versions
     SET evidence_level = teach_compute_evidence_level(NEW.skill_version_id, NEW.content_hash)
   WHERE id = NEW.skill_version_id
     AND content_hash = NEW.content_hash
     AND evidence_level IS DISTINCT FROM teach_compute_evidence_level(NEW.skill_version_id, NEW.content_hash);
  RETURN NULL;
END $$;

CREATE TRIGGER trg_skill_tests_evidence
  AFTER INSERT ON skill_tests
  FOR EACH ROW EXECUTE FUNCTION teach_skill_tests_after_insert();

-- ---------------------------------------------------------------------
-- 10. executions: execution cũ luôn trỏ về đúng phiên bản skill đã chạy
-- ---------------------------------------------------------------------
SELECT pg_temp.teach_ensure_fk('executions','skill_version_id','skill_versions','id','fk_executions_skill_version','RESTRICT');
CREATE INDEX IF NOT EXISTS ix_executions_skill_version ON executions (skill_version_id)
  WHERE skill_version_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 11. Retention: xóa dữ liệu dạy thô quá hạn; trả về danh sách file cần xóa ở storage.
--     Không cần consent (xóa dữ liệu luôn được phép). Không chạm skills/skill_versions/skill_tests/executions.
-- ---------------------------------------------------------------------
CREATE FUNCTION teach_purge_expired(p_now timestamptz DEFAULT now())
RETURNS TABLE (asset_ref text)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE v_sessions uuid[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_sessions
    FROM teach_sessions
   WHERE raw_expires_at IS NOT NULL AND raw_expires_at < p_now
     AND status NOT IN ('CREATED','RECORDING')
     AND ownership_state NOT IN ('HELD','RETAINED_PENDING_CLEANUP');

  RETURN QUERY
    SELECT DISTINCT r FROM (
      SELECT screenshot_ref AS r FROM ui_snapshots
       WHERE (teach_session_id = ANY (v_sessions) OR expires_at < p_now) AND screenshot_ref IS NOT NULL
      UNION ALL
      SELECT ui_metadata_ref FROM ui_snapshots
       WHERE (teach_session_id = ANY (v_sessions) OR expires_at < p_now) AND ui_metadata_ref IS NOT NULL
    ) x;

  UPDATE recorded_actions ra
     SET no_snapshot_reason = coalesce(ra.no_snapshot_reason, 'RETENTION_EXPIRED')
   WHERE ra.session_id <> ALL (v_sessions)
     AND (ra.before_snapshot_id IN (SELECT id FROM ui_snapshots WHERE expires_at < p_now)
       OR ra.after_snapshot_id  IN (SELECT id FROM ui_snapshots WHERE expires_at < p_now));

  DELETE FROM ui_snapshots WHERE teach_session_id = ANY (v_sessions) OR expires_at < p_now;
  DELETE FROM teach_sessions WHERE id = ANY (v_sessions);
END $$;

-- ---------------------------------------------------------------------
-- 12. Consent guard cho mọi bảng Teach (chỉ INSERT). Tên trg_00_* để chạy trước các trigger khác.
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_00_consent BEFORE INSERT ON teach_sessions     FOR EACH ROW EXECUTE FUNCTION teach_consent_guard();
CREATE TRIGGER trg_00_consent BEFORE INSERT ON ui_snapshots       FOR EACH ROW EXECUTE FUNCTION teach_consent_guard();
CREATE TRIGGER trg_00_consent BEFORE INSERT ON recorded_actions   FOR EACH ROW EXECUTE FUNCTION teach_consent_guard();
CREATE TRIGGER trg_00_consent BEFORE INSERT ON skills             FOR EACH ROW EXECUTE FUNCTION teach_consent_guard();
CREATE TRIGGER trg_00_consent BEFORE INSERT ON skill_versions     FOR EACH ROW EXECUTE FUNCTION teach_consent_guard();
CREATE TRIGGER trg_00_consent BEFORE INSERT ON skill_tests        FOR EACH ROW EXECUTE FUNCTION teach_consent_guard();

-- ---------------------------------------------------------------------
-- 13. View thư viện kỹ năng
-- ---------------------------------------------------------------------
CREATE VIEW v_skill_library AS
SELECT s.id AS skill_id, s.name, s.app_scope, s.status AS skill_status,
       sv.id AS version_id, sv.version_no, sv.status AS version_status, sv.evidence_level, sv.content_hash,
       coalesce(t.test_runs, 0)        AS test_runs,
       coalesce(t.verified_runs, 0)    AS verified_runs,
       coalesce(t.blocked_runs, 0)     AS blocked_runs,
       coalesce(t.verified_devices, 0) AS verified_devices,
       t.last_tested_at, s.updated_at
FROM skills s
LEFT JOIN skill_versions sv ON sv.id = s.current_version_id
LEFT JOIN LATERAL (
  SELECT count(*)                                                       AS test_runs,
         count(*) FILTER (WHERE independently_verified)                 AS verified_runs,
         count(*) FILTER (WHERE result = 'BLOCKED')                     AS blocked_runs,
         count(DISTINCT device_physical_hash) FILTER (WHERE independently_verified) AS verified_devices,
         max(tested_at)                                                 AS last_tested_at
    FROM skill_tests WHERE skill_version_id = sv.id AND content_hash = sv.content_hash) t ON true;

INSERT INTO teach_schema_migrations (version, name) VALUES (1, 'teach_mode_v1');




COMMIT;

-- =====================================================================
-- GHI CHÚ SAU KHI CHẠY
-- 1) CONSENT (bắt buộc, do CHỦ DỰ ÁN tự chạy; ứng dụng không được tự cấp). Chưa có dòng này thì mọi
--    INSERT vào bảng Teach đều bị chặn (TH011). Ví dụ đồng ý cho mọi thiết bị:
--      INSERT INTO consents (subject_ref, consent_type, granted, scope)
--      VALUES ('local-owner', 'TEACH_REMOTE_STORAGE', true,
--              '{"data":["sanitized_ui_semantics","recorded_actions","skills","skill_tests"],"screenshots":false}');
--    Thu hồi: UPDATE consents SET revoked_at = now() WHERE consent_type='TEACH_REMOTE_STORAGE';
--    (sau khi thu hồi: chặn ghi mới, vẫn cho phép nhả lock và xóa dữ liệu).
--    Nếu subject_ref trong hệ thống của bạn dùng quy ước khác 'local-owner', báo để chỉnh hàm.
-- 2) Bảng cũ đã có dữ liệu: có thể chạy thêm  ALTER TABLE <bảng> VALIDATE CONSTRAINT <ck_...>.
-- 3) Nếu không có physical_identity_hash trùng (Q6 của 00_introspect), có thể nâng index lên UNIQUE:
--      CREATE UNIQUE INDEX ux_devices_physical_identity ON devices (physical_identity_hash)
--        WHERE physical_identity_hash IS NOT NULL;
-- 4) Mã lỗi: TH001 bất biến | TH002 chuyển trạng thái | TH003 bằng chứng | TH004 current_version |
--    TH005 skill_tests append-only | TH006 thiếu snapshot/lý do | TH007 execution không khớp |
--    TH008 thiếu physical identity | TH009 snapshot khác thiết bị | TH010 snapshot khác phiên |
--    TH011 chưa có consent | TH012 phiên không ở RECORDING.
-- =====================================================================
