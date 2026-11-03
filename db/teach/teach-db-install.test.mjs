// Kiểm thử migration Teach Mode v1.1 trên Postgres thật (PGlite). Chạy: node teach-db-migration.test.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const here = (f) => new URL(f, import.meta.url);
const db = new PGlite();
const install = fs.readFileSync(here('10_install_teach_schema.sql'), 'utf8');
const uninstall = fs.readFileSync(here('11_uninstall_teach_schema.sql'), 'utf8');
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('PASS', n); };
const bad = (n, e) => { fail++; console.log('FAIL', n, '=>', e); };
const q = async (sql, params) => (await db.query(sql, params)).rows;
async function expectOk(n, sql, params) { try { const r = await db.query(sql, params); ok(n); return r; } catch (e) { bad(n, e.message); return null; } }
async function expectErr(n, sql, code, params) {
  try { await db.query(sql, params); bad(n, 'đáng lẽ phải lỗi'); }
  catch (e) { const c = e.code || ''; if (!code || c === code) ok(`${n} (chặn đúng: ${c})`); else bad(n, `sai mã lỗi ${c}: ${e.message.slice(0, 90)}`); }
}
const check = (n, cond, info = '') => cond ? ok(n) : bad(n, info);
const finish = () => { console.log(`\nKẾT QUẢ: ${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0); };
const run = async (n, sql) => { try { await db.exec(sql); ok(n); } catch (e) { bad(n, e.message); finish(); } };

await run('CÀI schema teach_mode (một file, một transaction)', install);
await db.exec('SET search_path TO teach_mode, public');
try { await db.exec(install); bad('cài lần 2 bị từ chối', 'đáng lẽ phải lỗi'); }
catch (e) { check('cài lần 2 bị từ chối (schema đã tồn tại, không ghi đè)', /already exists/.test(e.message), e.message); }
await db.exec('ROLLBACK');
await db.exec('SET search_path TO teach_mode, public');

// ---------- thiết bị ----------
const dev = async (model, phys, manuf = 'Samsung', ver = '11') =>
  (await q(`insert into devices(serial_hash,physical_identity_hash,model,manufacturer,android_version) values ($1,$2,$3,$4,$5) returning id`,
    ['s-' + model + phys, phys, model, manuf, ver]))[0].id;
const A = await dev('A50s', 'android:A'), B = await dev('Honor9', 'android:B', 'Honor', '10'), C = await dev('A50s', 'android:C');
const N = (await q(`insert into devices(serial_hash,model) values ('s-nohash','Old') returning id`))[0].id;

// ---------- D4: consent ----------
await expectErr('D4 chưa có consent: không ghi được skill', `insert into skills(name) values ('x')`, 'TH011');
await expectErr('D4 chưa có consent: không tạo được phiên', `insert into teach_sessions(device_id) values ('${A}')`, 'TH011');
await expectOk('chủ dự án cấp consent toàn cục', `insert into consents(subject_ref,consent_type,granted,scope) values ('local-owner','TEACH_REMOTE_STORAGE',true,'{"screenshots":false}')`);
const skill = (await q(`insert into skills(name,app_scope) values ('yt search','["youtube"]') returning id,owner_ref`))[0];
check('owner_ref mặc định local-owner', skill.owner_ref === 'local-owner', skill.owner_ref);
await expectOk('D4 thu hồi consent', `update consents set revoked_at = now()`);
await expectErr('D4 sau thu hồi: không ghi mới được', `insert into skills(name) values ('y')`, 'TH011');
await expectOk('D4 sau thu hồi: vẫn sửa/dọn dẹp bản ghi cũ', `update skills set description='dọn dẹp' where id='${skill.id}'`);
await expectOk('D4 cấp lại consent (dòng mới)', `insert into consents(subject_ref,consent_type,granted) values ('local-owner','TEACH_REMOTE_STORAGE',true)`);
await expectOk('D4 ghi lại được', `insert into skills(name) values ('z') returning id`);
await expectOk('D4 dòng từ chối mới hơn', `insert into consents(subject_ref,consent_type,granted) values ('local-owner','TEACH_REMOTE_STORAGE',false)`);
await expectErr('D4 dòng từ chối mới nhất thắng', `insert into skills(name) values ('w')`, 'TH011');
await expectOk('D4 cấp lại sau khi từ chối', `insert into consents(subject_ref,consent_type,granted) values ('local-owner','TEACH_REMOTE_STORAGE',true)`);
await expectOk('D4 consent hết hạn không còn hiệu lực (chuẩn bị)', `update consents set expires_at = now() - interval '1 second'`);
await expectErr('D4 consent hết hạn bị chặn', `insert into skills(name) values ('v')`, 'TH011');
await expectOk('D4 consent riêng thiết bị A', `insert into consents(subject_ref,device_id,consent_type,granted) values ('local-owner','${A}','TEACH_REMOTE_STORAGE',true)`);
await expectErr('D4 consent riêng A: thiết bị B vẫn bị chặn', `insert into teach_sessions(device_id) values ('${B}')`, 'TH011');
await expectErr('D4 consent riêng A: skill (không gắn thiết bị) vẫn bị chặn', `insert into skills(name) values ('u')`, 'TH011');
await expectOk('D4 cấp consent toàn cục cho phần còn lại', `insert into consents(subject_ref,consent_type,granted) values ('local-owner','TEACH_REMOTE_STORAGE',true)`);

// ---------- phiên bản kỹ năng ----------
const sessD1 = (await q(`insert into teach_sessions(device_id) values ($1) returning id`, [A]))[0].id;
const wf = { steps: [{ id: 's1', operation: 'OPEN_APPLICATION', arguments: { appRef: 'youtube' } }] };
const mkver = async (no, w = wf, src = null) => (await q(`insert into skill_versions(skill_id,version_no,workflow_json,source_session_id) values ($1,$2,$3,$4) returning id,content_hash`, [skill.id, no, JSON.stringify(w), src]))[0];
const v1 = await mkver(1, wf, sessD1);
check('content_hash do DB tính (64 hex)', /^[0-9a-f]{64}$/.test(v1.content_hash), v1.content_hash);
await expectErr('chèn thẳng PUBLISHED bị chặn', `insert into skill_versions(skill_id,version_no,workflow_json,status) values ('${skill.id}',9,'{}','PUBLISHED')`, 'TH002');
await expectErr('trùng (skill, version_no)', `insert into skill_versions(skill_id,version_no,workflow_json) values ('${skill.id}',1,'{}')`, '23505');
await expectErr('workflow chứa bounds bị chặn', `insert into skill_versions(skill_id,version_no,workflow_json) values ('${skill.id}',2,'{"steps":[{"target":{"bounds":[1,2,3,4]}}]}')`, '23514');
await expectErr('workflow chứa elementId lồng trong mảng bị chặn', `insert into skill_versions(skill_id,version_no,workflow_json) values ('${skill.id}',2,'{"steps":[{"a":[{"elementId":"x"}]}]}')`, '23514');
await expectErr('workflow chứa verified bị chặn', `insert into skill_versions(skill_id,version_no,workflow_json) values ('${skill.id}',2,'{"verified":true}')`, '23514');
await expectOk('workflow có "verify" hợp lệ vẫn qua', `insert into skill_versions(skill_id,version_no,workflow_json) values ('${skill.id}',2,'{"steps":[{"verify":{"type":"FOREGROUND_APP_MATCH"}}]}')`);
await expectErr('khai evidence_level khi tạo bị chặn', `insert into skill_versions(skill_id,version_no,workflow_json,evidence_level) values ('${skill.id}',3,'{}','REAL_DEVICE_VERIFIED')`, 'TH003');

const exec = async (d, v) => (await q(`insert into executions(device_id,skill_version_id,engine) values ($1,$2,'UNIFIED_V2') returning id`, [d, v]))[0].id;
const evl = async (v) => (await q(`select evidence_level from skill_versions where id=$1`, [v]))[0].evidence_level;
const offline = (v, d) => db.query(`insert into skill_tests(skill_version_id,device_id,test_kind,result,verifier_name) values ($1,$2,'OFFLINE','PASSED','fixture')`, [v, d]);
const real = (v, d, e) => db.query(`insert into skill_tests(skill_version_id,device_id,test_kind,result,verifier_name,independently_verified,execution_id) values ($1,$2,'REAL_DEVICE','PASSED','search-verifier',true,$3)`, [v, d, e]);

await expectOk('DRAFT -> PENDING_VALIDATION', `update skill_versions set status='PENDING_VALIDATION' where id='${v1.id}'`);
await expectErr('DRAFT/PENDING -> VERIFIED khi chưa có bằng chứng thật bị chặn', `update skill_versions set status='VERIFIED' where id='${v1.id}'`, '23514');
await expectErr('khai tay evidence_level bị chặn', `update skill_versions set evidence_level='REAL_DEVICE_VERIFIED' where id='${v1.id}'`, 'TH003');
await offline(v1.id, A); check('evidence -> OFFLINE_TESTED', await evl(v1.id) === 'OFFLINE_TESTED', await evl(v1.id));
await expectErr('verified thiếu execution bị chặn', `insert into skill_tests(skill_version_id,device_id,test_kind,result,verifier_name,independently_verified) values ('${v1.id}','${A}','REAL_DEVICE','PASSED','v',true)`, '23514');
await expectErr('verified kiểu OFFLINE bị chặn', `insert into skill_tests(skill_version_id,device_id,test_kind,result,verifier_name,independently_verified) values ('${v1.id}','${A}','OFFLINE','PASSED','v',true)`, '23514');
// D3: execution phải khớp thiết bị + phiên bản
const exWrongDev = await exec(B, v1.id);
await expectErr('D3 execution của thiết bị KHÁC không làm bằng chứng được', `insert into skill_tests(skill_version_id,device_id,test_kind,result,verifier_name,independently_verified,execution_id) values ('${v1.id}','${A}','REAL_DEVICE','PASSED','v',true,'${exWrongDev}')`, 'TH007');
const vOther = await mkver(30);
const exWrongVer = await exec(A, vOther.id);
await expectErr('D3 execution của phiên bản KHÁC không làm bằng chứng được', `insert into skill_tests(skill_version_id,device_id,test_kind,result,verifier_name,independently_verified,execution_id) values ('${v1.id}','${A}','REAL_DEVICE','PASSED','v',true,'${exWrongVer}')`, 'TH007');
await expectErr('D3 thiết bị không có physical identity không làm bằng chứng độc lập', `insert into skill_tests(skill_version_id,device_id,test_kind,result,verifier_name,independently_verified,execution_id) values ('${v1.id}','${N}','REAL_DEVICE','PASSED','v',true,'${await exec(N, v1.id)}')`, 'TH008');
await db.query(`insert into skill_tests(skill_version_id,device_id,test_kind,result,verifier_name) values ($1,$2,'REAL_DEVICE','PASSED','x')`, [v1.id, A]);
check('evidence -> REAL_DEVICE_TESTED', await evl(v1.id) === 'REAL_DEVICE_TESTED', await evl(v1.id));
await expectErr('REAL_DEVICE_TESTED chưa đủ để VERIFIED', `update skill_versions set status='VERIFIED' where id='${v1.id}'`, '23514');
await real(v1.id, A, await exec(A, v1.id)); check('evidence -> REAL_DEVICE_VERIFIED', await evl(v1.id) === 'REAL_DEVICE_VERIFIED', await evl(v1.id));
await expectErr('skill_tests không được sửa', `update skill_tests set result='FAILED'`, 'TH005');
await expectErr('skill_tests không được xóa', `delete from skill_tests`, 'TH005');
await expectOk('PENDING -> VERIFIED', `update skill_versions set status='VERIFIED' where id='${v1.id}'`);
await expectErr('VERIFIED: sửa nội dung bị chặn (D2)', `update skill_versions set workflow_json='{"steps":[]}' where id='${v1.id}'`, 'TH003');
await expectOk('VERIFIED -> PUBLISHED', `update skill_versions set status='PUBLISHED' where id='${v1.id}'`);
check('published_at được đặt', (await q(`select published_at from skill_versions where id=$1`, [v1.id]))[0].published_at !== null);
await expectErr('sửa workflow đã PUBLISHED bị chặn', `update skill_versions set workflow_json='{"steps":[]}' where id='${v1.id}'`, 'TH001');
await expectErr('xóa version đã PUBLISHED bị chặn', `delete from skill_versions where id='${v1.id}'`, 'TH001');
await expectErr('D1 không được tự gỡ source_session khi phiên còn tồn tại', `update skill_versions set source_session_id=null where id='${v1.id}'`, 'TH001');
await expectOk('PUBLISHED -> DISABLED', `update skill_versions set status='DISABLED' where id='${v1.id}'`);
await expectErr('sửa workflow sau DISABLED vẫn bị chặn', `update skill_versions set workflow_json='{"a":1}' where id='${v1.id}'`, 'TH001');
await expectErr('DISABLED -> DRAFT bị chặn', `update skill_versions set status='DRAFT' where id='${v1.id}'`, 'TH002');
await expectErr('xóa version đang có test/execution tham chiếu (FK)', `delete from skill_versions where id='${vOther.id}'`, '23503');

// ---------- D2: bằng chứng gắn với nội dung ----------
const vD = await mkver(40);
await offline(vD.id, A); check('D2 vD OFFLINE_TESTED', await evl(vD.id) === 'OFFLINE_TESTED');
await expectOk('D2 sửa nội dung khi còn DRAFT', `update skill_versions set workflow_json='{"steps":[{"id":"s9"}]}' where id='${vD.id}'`);
check('D2 sửa nội dung -> bằng chứng cũ mất hiệu lực (COMPILED)', await evl(vD.id) === 'COMPILED', await evl(vD.id));
await db.query(`update skill_versions set status='PENDING_VALIDATION' where id=$1`, [vD.id]);
await real(vD.id, A, await exec(A, vD.id));
check('D2 test mới trên nội dung mới -> REAL_DEVICE_VERIFIED', await evl(vD.id) === 'REAL_DEVICE_VERIFIED');
await expectOk('D2 sửa nội dung khi PENDING (bằng chứng reset)', `update skill_versions set workflow_json='{"steps":[{"id":"s10"}]}' where id='${vD.id}'`);
await expectErr('D2 nội dung đã sửa sau test KHÔNG lên được VERIFIED bằng bằng chứng cũ', `update skill_versions set status='VERIFIED' where id='${vD.id}'`, '23514');

// ---------- D7: cross-device theo danh tính vật lý + hồ sơ phần cứng ----------
const vB = await mkver(50);
await real(vB.id, A, await exec(A, vB.id)); await real(vB.id, A, await exec(A, vB.id));
check('D7 hai lần trên CÙNG một máy -> chỉ REAL_DEVICE_VERIFIED', await evl(vB.id) === 'REAL_DEVICE_VERIFIED', await evl(vB.id));
await real(vB.id, C, await exec(C, vB.id));
check('D7 hai máy vật lý khác nhau nhưng CÙNG model -> chưa phải CROSS_DEVICE', await evl(vB.id) === 'REAL_DEVICE_VERIFIED', await evl(vB.id));
await expectOk('D7 sửa metadata model của máy C SAU khi test', `update devices set model='Fake', manufacturer='Fake' where id='${C}'`);
check('D7 đổi metadata thiết bị không làm tăng bằng chứng', await evl(vB.id) === 'REAL_DEVICE_VERIFIED', await evl(vB.id));
await real(vB.id, B, await exec(B, vB.id));
check('D7 máy khác danh tính + khác hồ sơ phần cứng -> CROSS_DEVICE_VERIFIED', await evl(vB.id) === 'CROSS_DEVICE_VERIFIED', await evl(vB.id));
const vw = (await q(`select * from v_skill_library where skill_id=$1`, [skill.id]))[0];
check('v_skill_library chạy được', !!vw);

// ---------- skills guard ----------
const skill2 = (await q(`insert into skills(name) values ('other') returning id`))[0].id;
await expectErr('current_version_id không thuộc skill', `update skills set current_version_id='${vB.id}' where id='${skill2}'`, 'TH004');
await expectOk('current_version_id đúng skill', `update skills set current_version_id='${vB.id}' where id='${skill.id}'`);
check('revision skills tăng khi update', (await q(`select revision from skills where id=$1`, [skill.id]))[0].revision >= 2);

// ---------- D5 + D3: máy trạng thái phiên, ownership theo danh tính vật lý ----------
const ses = async (d) => (await q(`insert into teach_sessions(device_id) values ($1) returning id,status,device_identity_hash`, [d]))[0];
const s1 = await ses(A);
check('phiên mới mặc định CREATED, danh tính lấy từ devices', s1.status === 'CREATED' && s1.device_identity_hash === 'android:A', JSON.stringify(s1));
await expectErr('D3 thiết bị không có physical identity không được bắt đầu dạy', `insert into teach_sessions(device_id) values ('${N}')`, 'TH008');
await expectErr('chèn phiên ở trạng thái khác CREATED', `insert into teach_sessions(device_id,status) values ('${A}','FINISHED')`, 'TH002');
await expectErr('D5 CREATED -> FINISHED bị chặn', `update teach_sessions set status='FINISHED' where id='${s1.id}'`, 'TH002');
await expectErr('D5 trạng thái lạ bị chặn', `update teach_sessions set status='WHATEVER' where id='${s1.id}'`, 'TH002');
await expectErr('D5 không được đổi thiết bị của phiên', `update teach_sessions set device_id='${B}' where id='${s1.id}'`, 'TH001');
await expectOk('CREATED -> RECORDING + giữ lock', `update teach_sessions set status='RECORDING', ownership_state='HELD' where id='${s1.id}'`);
check('recording_started_at được đặt', (await q(`select recording_started_at from teach_sessions where id=$1`, [s1.id]))[0].recording_started_at !== null);
const sC = await ses(C);  // máy C là máy vật lý android:C (khác A)
const sA2 = await ses(A);
await db.query(`update teach_sessions set status='RECORDING' where id=$1`, [sA2.id]);
await expectErr('phiên thứ 2 cùng máy vật lý không được giữ lock', `update teach_sessions set ownership_state='HELD' where id='${sA2.id}'`, '23505');
// D3b: hai UUID cùng physical identity
const A2 = await dev('A50s', 'android:A');  // UUID khác, cùng danh tính vật lý với A
const sA3 = await ses(A2);
await expectErr('D3 UUID khác nhưng CÙNG danh tính vật lý cũng không giữ lock song song', `update teach_sessions set ownership_state='HELD' where id='${sA3.id}'`, '23505');
await expectOk('máy vật lý khác giữ lock độc lập', `update teach_sessions set ownership_state='HELD' where id='${sC.id}'`);
await expectErr('INTERRUPTED phải kèm lý do', `update teach_sessions set status='INTERRUPTED' where id='${sA2.id}'`, '23514');
await expectErr('INTERRUPTED không được nhả ownership ngay', `update teach_sessions set status='INTERRUPTED', interrupted_reason='ADB_LOST', ownership_state='RELEASED' where id='${s1.id}'`, 'TH002');
await expectOk('INTERRUPTED giữ ownership kèm lý do', `update teach_sessions set status='INTERRUPTED', interrupted_reason='ADB_LOST', ownership_state='RETAINED_PENDING_CLEANUP' where id='${s1.id}'`);
await expectErr('RETAINED vẫn chặn phiên khác trên cùng máy', `update teach_sessions set ownership_state='HELD' where id='${sA2.id}'`, '23505');
await expectOk('chứng minh cleanup rồi mới RELEASED', `update teach_sessions set ownership_state='RELEASED' where id='${s1.id}'`);
await expectOk('sau RELEASED phiên khác giữ được lock', `update teach_sessions set ownership_state='HELD' where id='${sA2.id}'`);
check('revision phiên tăng', (await q(`select revision from teach_sessions where id=$1`, [s1.id]))[0].revision >= 4);

// ---------- snapshots + actions ----------
const sess2 = sA2.id;  // đang RECORDING trên máy A
const snap = async (sid, d, extra = `'REDACTED'`) => (await q(`insert into ui_snapshots(teach_session_id,device_id,app_package,redaction_status,screenshot_ref,ui_metadata_ref) values ($1,$2,'com.google.android.youtube',${extra},'img/'||gen_random_uuid(),'ui/'||gen_random_uuid()) returning id`, [sid, d]))[0].id;
await expectErr('snapshot mặc định FAIL-CLOSED (không khai REDACTED thì bị chặn)', `insert into ui_snapshots(teach_session_id,device_id) values ('${sess2}','${A}')`, '23514');
await expectErr('D3 snapshot của THIẾT BỊ KHÁC phiên bị chặn', `insert into ui_snapshots(teach_session_id,device_id,redaction_status) values ('${sess2}','${B}','REDACTED')`, 'TH009');
await expectErr('snapshot khi phiên không RECORDING bị chặn', `insert into ui_snapshots(teach_session_id,device_id,redaction_status) values ('${sD1Id()}','${A}','REDACTED')`, 'TH012');
function sD1Id() { return sessD1; }
const sn1 = await snap(sess2, A), sn2 = await snap(sess2, A);
await expectOk('action đủ snapshot', `insert into recorded_actions(session_id,step_order,action_type,semantic_target,receipt_status,before_snapshot_id,after_snapshot_id) values ('${sess2}',1,'TAP_ELEMENT','{"role":"search_action"}','ACK','${sn1}','${sn2}')`);
await expectErr('action trùng step_order', `insert into recorded_actions(session_id,step_order,action_type,before_snapshot_id,after_snapshot_id) values ('${sess2}',1,'TAP_ELEMENT','${sn1}','${sn2}')`, '23505');
await expectErr('semantic_target chứa bounds bị chặn', `insert into recorded_actions(session_id,step_order,action_type,semantic_target,before_snapshot_id,after_snapshot_id) values ('${sess2}',2,'TAP_ELEMENT','{"bounds":[0,0,1,1]}','${sn1}','${sn2}')`, '23514');
await expectOk('bounds được phép ở cột diagnostic', `insert into recorded_actions(session_id,step_order,action_type,diagnostic,before_snapshot_id,after_snapshot_id) values ('${sess2}',2,'TAP_ELEMENT','{"bounds":[0,0,1,1]}','${sn1}','${sn2}')`);
await expectErr('action_type lạ', `insert into recorded_actions(session_id,step_order,action_type,before_snapshot_id,after_snapshot_id) values ('${sess2}',3,'RM_RF','${sn1}','${sn2}')`, '23514');
await expectErr('input_redacted nhưng vẫn có nội dung', `insert into recorded_actions(session_id,step_order,action_type,input_template,input_redacted,before_snapshot_id,after_snapshot_id) values ('${sess2}',3,'INPUT_TEXT','hunter2',true,'${sn1}','${sn2}')`, '23514');
await expectErr('thiếu snapshot và không lý do (kiểm tra lúc COMMIT)', `insert into recorded_actions(session_id,step_order,action_type) values ('${sess2}',3,'OPEN_APP')`, 'TH006');
await expectOk('thiếu snapshot nhưng có lý do', `insert into recorded_actions(session_id,step_order,action_type,no_snapshot_reason) values ('${sess2}',3,'OPEN_APP','CAPTURE_SAFETY_UNKNOWN')`);
const sessOther = (await q(`select id from teach_sessions where id=$1`, [sC.id]))[0].id;
await db.query(`update teach_sessions set status='RECORDING' where id=$1`, [sC.id]);
const snOther = await snap(sessOther, C);
await expectErr('D3 snapshot thuộc PHIÊN KHÁC không gắn được vào action', `insert into recorded_actions(session_id,step_order,action_type,before_snapshot_id,after_snapshot_id) values ('${sess2}',4,'TAP_ELEMENT','${snOther}','${sn2}')`, 'TH010');
await expectErr('snapshot không an toàn phải có lý do', `insert into ui_snapshots(teach_session_id,device_id,redaction_status) values ('${sess2}','${A}','CAPTURE_SAFETY_UNKNOWN')`, '23514');
await expectErr('có ảnh nhưng chưa che', `insert into ui_snapshots(teach_session_id,device_id,redaction_status,no_capture_reason,screenshot_ref) values ('${sess2}','${A}','SENSITIVE_CONTENT_OMITTED','secure window','x')`, '23514');
await expectErr('action không được chuyển sang phiên khác', `update recorded_actions set session_id='${sessOther}' where session_id='${sess2}' and step_order=1`, 'TH001');

// ---------- retention + D1 ----------
await db.query(`update teach_sessions set status='REVIEWING' where id=$1`, [sess2]);
await db.query(`update teach_sessions set status='COMPILED' where id=$1`, [sess2]);
await db.query(`update teach_sessions set status='CANCELLED', ownership_state='RELEASED', raw_expires_at=now()-interval '1 day' where id=$1`, [sess2]);
await expectErr('phiên đã kết thúc không đổi trạng thái được nữa', `update teach_sessions set status='RECORDING' where id='${sess2}'`, 'TH002');
// D1: phiên nguồn của version PUBLISHED hết hạn
await db.query(`update teach_sessions set status='CANCELLED' where id=$1`, [sessD1]);
await expectOk('đặt hạn xóa cho phiên nguồn của version PUBLISHED', `update teach_sessions set raw_expires_at=now()-interval '1 day' where id='${sessD1}'`);
const refs = (await q(`select * from teach_purge_expired()`)).map(r => r.asset_ref);
check('purge trả danh sách file cần xóa (2 ảnh + 2 ui của phiên sess2)', refs.length === 4, String(refs.length));
const left = (await q(`select (select count(*) from teach_sessions where id='${sess2}') s,(select count(*) from recorded_actions where session_id='${sess2}') a,(select count(*) from ui_snapshots where teach_session_id='${sess2}') n,(select count(*) from teach_sessions where id='${sessD1}') d1`))[0];
check('purge xóa phiên + action + snapshot (cascade)', +left.s === 0 && +left.a === 0 && +left.n === 0, JSON.stringify(left));
check('D1 purge phiên nguồn của version PUBLISHED KHÔNG bị chặn', +left.d1 === 0, JSON.stringify(left));
const src = (await q(`select source_session_id from skill_versions where id=$1`, [v1.id]))[0].source_session_id;
check('D1 source_session_id về NULL, nội dung version vẫn nguyên', src === null);
check('purge không đụng skill_versions', +(await q(`select count(*) c from skill_versions`))[0].c >= 5);
// snapshot hết hạn trên phiên còn sống
const o1 = await snap(sessOther, C), o2 = await snap(sessOther, C);
await db.query(`insert into recorded_actions(session_id,step_order,action_type,before_snapshot_id,after_snapshot_id) values ($1,1,'TAP_ELEMENT',$2,$3)`, [sessOther, o1, o2]);
await db.query(`update ui_snapshots set expires_at=now()-interval '1 hour' where id=$1`, [o1]);
await expectOk('purge snapshot hết hạn trên phiên còn sống', `select * from teach_purge_expired()`);
const act = (await q(`select before_snapshot_id, no_snapshot_reason from recorded_actions where session_id=$1 and step_order=1`, [sessOther]))[0];
check('action còn lại ghi RETENTION_EXPIRED', act.before_snapshot_id === null && act.no_snapshot_reason === 'RETENTION_EXPIRED', JSON.stringify(act));
await expectOk('D4 xóa dữ liệu vẫn được phép khi đã thu hồi consent', `select * from teach_purge_expired()`);

// ---------- schema teach_mode: hàm/trigger nằm đúng schema, không phụ thuộc search_path của người gọi ----------
check('hàm teach_* nằm trong schema teach_mode', (await q(`select to_regprocedure('teach_mode.teach_skills_guard()') is not null as ok`))[0].ok);
check('không có hàm teach_* rơi vào schema public', (await q(`select count(*)::int c from pg_proc where pronamespace='public'::regnamespace and proname like 'teach\\_%'`))[0].c === 0);
check('đúng 15 trigger của Teach', (await q(`select count(*)::int c from pg_trigger where not tgisinternal`))[0].c === 15, String((await q(`select count(*)::int c from pg_trigger where not tgisinternal`))[0].c));
check('hàm đọc bảng đã ghim search_path', (await q(`select count(*)::int c from pg_proc where pronamespace='teach_mode'::regnamespace and proname like 'teach\\_%' and proconfig::text like '%search_path%'`))[0].c >= 12);
await db.exec(`SET search_path TO public`);
await expectOk('người gọi dùng search_path KHÁC + tên có schema: trigger vẫn tìm đúng bảng', `insert into teach_mode.skills(name) values ('path-independent') returning id`);
await expectOk('người gọi dùng search_path KHÁC: thu hồi consent', `update teach_mode.consents set revoked_at = now() where revoked_at is null`);
await expectErr('người gọi dùng search_path KHÁC: consent guard vẫn chặn sau thu hồi', `insert into teach_mode.skills(name) values ('blocked')`, 'TH011');
await db.exec(`SET search_path TO teach_mode, public`);

// ---------- gỡ cài đặt + cài lại ----------
await db.exec('SET search_path TO public');
await run('GỠ schema teach_mode', uninstall);
check('schema teach_mode đã biến mất', (await q(`select to_regnamespace('teach_mode') is null as gone`))[0].gone);
await run('CÀI LẠI sau khi gỡ', install);
finish();
