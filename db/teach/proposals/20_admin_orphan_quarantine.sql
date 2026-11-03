-- PROPOSAL ONLY. Not installed on Neon; not loaded by application startup.
-- Extended candidate: administrative retirement + one scoped fresh admission.
-- NEVER a verified native cleanup or replay grant. Apply only after exact owner approval.
BEGIN;
ALTER TABLE teach_mode.teach_sessions ADD COLUMN administrative_audit jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE teach_mode.teach_sessions ADD COLUMN administrative_clearance jsonb;
ALTER TABLE teach_mode.teach_sessions DROP CONSTRAINT ck_teach_sessions_ownership;
ALTER TABLE teach_mode.teach_sessions ADD CONSTRAINT ck_teach_sessions_ownership CHECK
 (ownership_state IN ('NONE','HELD','RELEASED','RETAINED_PENDING_CLEANUP','ADMIN_DISPOSED_UNVERIFIED'));
ALTER TABLE teach_mode.teach_sessions ADD CONSTRAINT ck_teach_admin_audit CHECK
 (jsonb_typeof(administrative_audit)='array' AND jsonb_array_length(administrative_audit)<=32);
-- ADMIN stays quarantined until one successor is created atomically by the scoped function.
DROP INDEX teach_mode.ux_teach_sessions_identity_ownership;
CREATE UNIQUE INDEX ux_teach_sessions_identity_ownership ON teach_mode.teach_sessions(device_identity_hash)
 WHERE (ownership_state IN ('HELD','RETAINED_PENDING_CLEANUP') OR
 (ownership_state='ADMIN_DISPOSED_UNVERIFIED' AND administrative_clearance->>'successorSessionId' IS NULL)) AND device_identity_hash IS NOT NULL;

CREATE FUNCTION teach_mode.teach_admin_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,teach_mode AS $$
DECLARE a jsonb; n integer; k text;
BEGIN
 IF TG_OP='DELETE' THEN
  IF jsonb_array_length(OLD.administrative_audit)>0 THEN RAISE EXCEPTION 'Administrative audit retention requires operator review' USING ERRCODE='TH001'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.ownership_state='ADMIN_DISPOSED_UNVERIFIED' OR NEW.administrative_audit<>'[]'::jsonb THEN RAISE EXCEPTION 'Administrative state requires original retained session' USING ERRCODE='TH002'; END IF;
  IF EXISTS(SELECT 1 FROM teach_mode.teach_sessions s JOIN teach_mode.devices d ON d.id=NEW.device_id
      WHERE s.device_identity_hash=d.physical_identity_hash AND s.ownership_state='ADMIN_DISPOSED_UNVERIFIED'
      AND (s.administrative_clearance->>'successorSessionId' IS DISTINCT FROM NEW.id::text)) THEN
   RAISE EXCEPTION 'Administrative quarantine blocks admission' USING ERRCODE='TH002';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.ownership_state='ADMIN_DISPOSED_UNVERIFIED' AND NEW.ownership_state='ADMIN_DISPOSED_UNVERIFIED' THEN
  IF (to_jsonb(NEW)-ARRAY['administrative_clearance','revision']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['administrative_clearance','revision'])
   OR NEW.revision<>OLD.revision OR OLD.administrative_clearance IS NULL OR OLD.administrative_clearance->>'successorSessionId' IS NOT NULL
   OR coalesce(NEW.administrative_clearance->>'successorSessionId','')!~'^[0-9a-f-]{36}$'
   OR coalesce(NEW.administrative_clearance->>'consumptionAuthSha256','')!~'^[a-f0-9]{64}$'
   OR (NEW.administrative_clearance-ARRAY['successorSessionId','consumptionAuthSha256','consumedAt']) IS DISTINCT FROM OLD.administrative_clearance THEN
    RAISE EXCEPTION 'Clearance cannot be replayed or rebound' USING ERRCODE='TH002';
  END IF;
  NEW.revision:=OLD.revision+1; RETURN NEW;
 END IF;
 IF OLD.ownership_state<>'ADMIN_DISPOSED_UNVERIFIED' AND NEW.ownership_state<>'ADMIN_DISPOSED_UNVERIFIED'
    AND NEW.administrative_audit=OLD.administrative_audit AND NEW.administrative_clearance IS NOT DISTINCT FROM OLD.administrative_clearance THEN RETURN NEW; END IF;
 IF NOT ((OLD.ownership_state='RETAINED_PENDING_CLEANUP' AND NEW.ownership_state='ADMIN_DISPOSED_UNVERIFIED')
      OR (OLD.ownership_state='ADMIN_DISPOSED_UNVERIFIED' AND NEW.ownership_state='RETAINED_PENDING_CLEANUP'))
    OR OLD.status<>'INTERRUPTED' OR NEW.status<>'INTERRUPTED' THEN RAISE EXCEPTION 'Invalid administrative transition' USING ERRCODE='TH002'; END IF;
 IF (to_jsonb(NEW)-ARRAY['ownership_state','administrative_audit','administrative_clearance','revision']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['ownership_state','administrative_audit','administrative_clearance','revision']) OR NEW.revision<>OLD.revision THEN
  RAISE EXCEPTION 'Original session binding is immutable' USING ERRCODE='TH001';
 END IF;
 IF NEW.ownership_state='ADMIN_DISPOSED_UNVERIFIED' AND (EXISTS(SELECT 1 FROM teach_mode.recorded_actions WHERE session_id=OLD.id) OR EXISTS(SELECT 1 FROM teach_mode.ui_snapshots WHERE teach_session_id=OLD.id)) THEN
  RAISE EXCEPTION 'Legacy recording effects require independent reconciliation' USING ERRCODE='TH002';
 END IF;
 IF OLD.administrative_clearance IS NOT NULL AND NOT (OLD.ownership_state='ADMIN_DISPOSED_UNVERIFIED'
  AND NEW.ownership_state='RETAINED_PENDING_CLEANUP' AND OLD.administrative_clearance->>'successorSessionId' IS NULL
  AND NEW.administrative_clearance=OLD.administrative_clearance) THEN RAISE EXCEPTION 'Existing clearance requires separate reconciliation' USING ERRCODE='TH002'; END IF;
 IF NEW.administrative_clearance IS NOT NULL AND (jsonb_typeof(NEW.administrative_clearance)<>'object'
   OR coalesce(NEW.administrative_clearance->>'id','')!~'^[0-9a-f-]{36}$'
   OR coalesce(NEW.administrative_clearance->>'requestId','')!~'^[0-9a-f-]{36}$'
   OR coalesce(NEW.administrative_clearance->>'sourceSha256','')!~'^[a-f0-9]{64}$'
   OR coalesce(NEW.administrative_clearance->>'expiresAt','')!~'^[0-9]{13}$'
   OR NEW.administrative_clearance->>'successorSessionId' IS NOT NULL
   OR (SELECT count(*) FROM jsonb_object_keys(NEW.administrative_clearance))<>4) THEN
  RAISE EXCEPTION 'Invalid fresh-admission scope' USING ERRCODE='TH002';
 END IF;
 n:=jsonb_array_length(NEW.administrative_audit);
 IF n<>jsonb_array_length(OLD.administrative_audit)+1 OR (NEW.administrative_audit-(n-1))<>OLD.administrative_audit THEN
  RAISE EXCEPTION 'Administrative audit must append exactly once' USING ERRCODE='TH005';
 END IF;
 a:=NEW.administrative_audit->(n-1);
 IF jsonb_typeof(a)<>'object' THEN RAISE EXCEPTION 'Invalid audit' USING ERRCODE='TH002'; END IF;
 FOR k IN SELECT jsonb_object_keys(a) LOOP
  IF NOT k=ANY(ARRAY['approvalId','sessionId','executionId','requestId','physicalId','beforeRevision','action','actorRef',
   'authenticationEventSha256','acceptedAt','riskAccepted','reason','cleanupClaim','pendingAssessment','originalJournalSha256','evidenceDigests','preflightDigest']) THEN
   RAISE EXCEPTION 'Unknown audit field' USING ERRCODE='TH002';
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_object_keys(a))<>17
  OR a->>'sessionId' IS DISTINCT FROM OLD.id::text OR a->>'physicalId' IS DISTINCT FROM OLD.device_identity_hash
  OR a->>'beforeRevision' IS DISTINCT FROM OLD.revision::text
  OR a->>'action' IS DISTINCT FROM (CASE WHEN NEW.ownership_state='ADMIN_DISPOSED_UNVERIFIED' THEN 'DISPOSE' ELSE 'REQUARANTINE' END)
  OR a->>'actorRef' IS DISTINCT FROM 'local-owner' OR a->'riskAccepted' IS DISTINCT FROM 'true'::jsonb
  OR a->>'reason' IS DISTINCT FROM 'MISSING_ORIGINAL_NATIVE_CLEANUP_ATTESTATION'
  OR a->>'cleanupClaim' IS DISTINCT FROM 'UNVERIFIED' OR coalesce(a->>'pendingAssessment','') NOT IN ('NONE','HISTORICAL_GAP_NO_ACTIVE_EFFECT_EVIDENCE')
  OR coalesce(a->>'approvalId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR coalesce(a->>'executionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR coalesce(a->>'requestId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR coalesce(a->>'authenticationEventSha256','')!~'^[a-f0-9]{64}$'
  OR coalesce(a->>'originalJournalSha256','')!~'^[a-f0-9]{64}$' OR coalesce(a->>'preflightDigest','')!~'^[a-f0-9]{64}$'
  OR coalesce(a->>'acceptedAt','')!~'^[0-9]{1,16}$' OR jsonb_typeof(a->'evidenceDigests') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Audit exact binding or risk declaration invalid' USING ERRCODE='TH002';
 END IF;
 IF jsonb_array_length(a->'evidenceDigests') NOT BETWEEN 1 AND 32 OR EXISTS
   (SELECT 1 FROM jsonb_array_elements_text(a->'evidenceDigests') h WHERE h!~'^[a-f0-9]{64}$') THEN
   RAISE EXCEPTION 'Invalid evidence digest list' USING ERRCODE='TH002';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.administrative_audit) prior WHERE prior->>'approvalId'=a->>'approvalId') THEN
   RAISE EXCEPTION 'Approval already consumed' USING ERRCODE='TH002';
 END IF;
 NEW.revision:=OLD.revision+1; RETURN NEW;
END $$;
-- Preserve original guard implementation; split triggers only for new branch.
DROP TRIGGER trg_teach_sessions_guard ON teach_mode.teach_sessions;
CREATE TRIGGER trg_teach_sessions_guard_insert BEFORE INSERT ON teach_mode.teach_sessions
 FOR EACH ROW EXECUTE FUNCTION teach_mode.teach_sessions_guard();
CREATE TRIGGER trg_teach_sessions_guard BEFORE UPDATE ON teach_mode.teach_sessions FOR EACH ROW
 WHEN (OLD.ownership_state<>'ADMIN_DISPOSED_UNVERIFIED' AND NEW.ownership_state<>'ADMIN_DISPOSED_UNVERIFIED')
 EXECUTE FUNCTION teach_mode.teach_sessions_guard();
CREATE TRIGGER trg_01_admin_guard BEFORE INSERT OR UPDATE OR DELETE ON teach_mode.teach_sessions
 FOR EACH ROW EXECUTE FUNCTION teach_mode.teach_admin_guard();

CREATE FUNCTION teach_mode.teach_record_admin_disposition(p_id uuid,p_revision integer,p_audit jsonb)
 RETURNS SETOF teach_mode.teach_sessions LANGUAGE plpgsql SET search_path=pg_catalog,teach_mode AS $$
DECLARE s teach_mode.teach_sessions%ROWTYPE; prior jsonb;
BEGIN
 SELECT * INTO s FROM teach_mode.teach_sessions WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Session not found' USING ERRCODE='TH002'; END IF;
 SELECT a INTO prior FROM jsonb_array_elements(s.administrative_audit) a WHERE a->>'approvalId'=p_audit->>'approvalId';
 IF prior IS NOT NULL THEN
  IF prior<>p_audit THEN RAISE EXCEPTION 'Approval binding conflict' USING ERRCODE='TH002'; END IF;
  RETURN NEXT s; RETURN;
 END IF;
 IF s.revision<>p_revision OR p_audit->>'beforeRevision' IS DISTINCT FROM p_revision::text THEN
  RAISE EXCEPTION 'Revision conflict' USING ERRCODE='TH002';
 END IF;
 RETURN QUERY UPDATE teach_mode.teach_sessions SET ownership_state=CASE p_audit->>'action'
   WHEN 'DISPOSE' THEN 'ADMIN_DISPOSED_UNVERIFIED' WHEN 'REQUARANTINE' THEN 'RETAINED_PENDING_CLEANUP' ELSE 'INVALID' END,
   administrative_audit=administrative_audit||jsonb_build_array(p_audit)
  WHERE id=p_id AND revision=p_revision RETURNING *;
END $$;
-- No public/application activation; future operator grant requires separate approval.
REVOKE ALL ON FUNCTION teach_mode.teach_record_admin_disposition(uuid,integer,jsonb) FROM PUBLIC;

CREATE FUNCTION teach_mode.teach_retire_with_clearance(p_id uuid,p_revision integer,p_audit jsonb,p_clearance jsonb)
 RETURNS SETOF teach_mode.teach_sessions LANGUAGE plpgsql SET search_path=pg_catalog,teach_mode AS $$
BEGIN
 IF p_clearance IS NULL OR (p_clearance->>'expiresAt')::bigint <= extract(epoch FROM clock_timestamp())*1000
  OR (p_clearance->>'expiresAt')::bigint > extract(epoch FROM clock_timestamp())*1000+900000 THEN
  RAISE EXCEPTION 'Fresh clearance expired or outside budget' USING ERRCODE='TH002';
 END IF;
 RETURN QUERY UPDATE teach_mode.teach_sessions SET ownership_state='ADMIN_DISPOSED_UNVERIFIED',
  administrative_audit=administrative_audit||jsonb_build_array(p_audit),administrative_clearance=p_clearance
  WHERE id=p_id AND revision=p_revision AND ownership_state='RETAINED_PENDING_CLEANUP' RETURNING *;
 IF NOT FOUND THEN RAISE EXCEPTION 'Retirement revision conflict' USING ERRCODE='TH002'; END IF;
END $$;
REVOKE ALL ON FUNCTION teach_mode.teach_retire_with_clearance(uuid,integer,jsonb,jsonb) FROM PUBLIC;

CREATE FUNCTION teach_mode.teach_admit_fresh(p_id uuid,p_revision integer,p_clearance uuid,p_request uuid,p_source text,p_successor uuid,p_auth text)
 RETURNS SETOF teach_mode.teach_sessions LANGUAGE plpgsql SET search_path=pg_catalog,teach_mode AS $$
DECLARE s teach_mode.teach_sessions%ROWTYPE;
BEGIN
 SELECT * INTO s FROM teach_mode.teach_sessions WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR s.revision<>p_revision OR s.ownership_state<>'ADMIN_DISPOSED_UNVERIFIED'
  OR s.administrative_clearance->>'id' IS DISTINCT FROM p_clearance::text
  OR s.administrative_clearance->>'requestId' IS DISTINCT FROM p_request::text
  OR s.administrative_clearance->>'sourceSha256' IS DISTINCT FROM p_source
  OR s.administrative_clearance->>'successorSessionId' IS NOT NULL
  OR (s.administrative_clearance->>'expiresAt')::bigint <= extract(epoch FROM clock_timestamp())*1000
  OR p_auth!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Fresh admission unauthorized, expired or consumed' USING ERRCODE='TH002'; END IF;
 UPDATE teach_mode.teach_sessions SET administrative_clearance=administrative_clearance||jsonb_build_object(
  'successorSessionId',p_successor::text,'consumptionAuthSha256',p_auth,'consumedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint) WHERE id=p_id;
 RETURN QUERY INSERT INTO teach_mode.teach_sessions(id,device_id,status,ownership_state)
  VALUES(p_successor,s.device_id,'CREATED','HELD') RETURNING *;
END $$;
REVOKE ALL ON FUNCTION teach_mode.teach_admit_fresh(uuid,integer,uuid,uuid,text,uuid,text) FROM PUBLIC;
INSERT INTO teach_mode.teach_schema_migrations(version,name) VALUES(2,'teach_admin_retirement_v1');
COMMIT;
