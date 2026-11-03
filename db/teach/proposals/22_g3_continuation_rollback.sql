-- Rollback only before any continuation was consumed. Owner approval required.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM teach_mode.teach_continuations) THEN RAISE EXCEPTION 'Consumed continuation: preserve evidence and use a forward fix'; END IF; END $$;
DROP FUNCTION teach_mode.teach_continue_and_admit(jsonb);
CREATE OR REPLACE FUNCTION teach_mode.teach_admin_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,teach_mode AS $$
DECLARE a jsonb; n integer; k text;
BEGIN

 -- Reauthorization is a separate append-only administrative event, never a cleanup claim.
 IF TG_OP='UPDATE' AND OLD.ownership_state='ADMIN_DISPOSED_UNVERIFIED'
  AND NEW.ownership_state='ADMIN_DISPOSED_UNVERIFIED'
  AND jsonb_array_length(NEW.administrative_audit)=jsonb_array_length(OLD.administrative_audit)+1
  AND NEW.administrative_audit->(jsonb_array_length(NEW.administrative_audit)-1)->>'action'='REAUTHORIZE' THEN
  n:=jsonb_array_length(NEW.administrative_audit); a:=NEW.administrative_audit->(n-1);
  IF OLD.status<>'INTERRUPTED' OR OLD.administrative_clearance IS NULL
   OR OLD.administrative_clearance->>'successorSessionId' IS NOT NULL
   OR (to_jsonb(NEW)-ARRAY['administrative_clearance','administrative_audit','revision']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['administrative_clearance','administrative_audit','revision'])
   OR NEW.revision<>OLD.revision OR (NEW.administrative_audit-(n-1)) IS DISTINCT FROM OLD.administrative_audit
   OR jsonb_typeof(a) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(a))<>18
   OR a->'previousClearance' IS DISTINCT FROM OLD.administrative_clearance
   OR a->'newClearance' IS DISTINCT FROM NEW.administrative_clearance
   OR a->>'sessionId' IS DISTINCT FROM OLD.id::text OR a->>'physicalId' IS DISTINCT FROM OLD.device_identity_hash
   OR a->>'beforeRevision' IS DISTINCT FROM OLD.revision::text
   OR a->>'actorRef' IS DISTINCT FROM 'local-owner' OR a->'riskAccepted' IS DISTINCT FROM 'true'::jsonb
   OR a->>'cleanupClaim' IS DISTINCT FROM 'UNVERIFIED'
   OR a->>'pendingAssessment' IS DISTINCT FROM 'HISTORICAL_GAP_NO_ACTIVE_EFFECT_EVIDENCE'
   OR coalesce(a->>'approvalId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR coalesce(a->>'authenticationEventSha256','')!~'^[a-f0-9]{64}$'
   OR coalesce(a->>'originalJournalSha256','')!~'^[a-f0-9]{64}$'
   OR coalesce(a->>'priorMarkerSha256','')!~'^[a-f0-9]{64}$'
   OR coalesce(a->>'preflightDigest','')!~'^[a-f0-9]{64}$'
   OR coalesce(a->>'acceptedAt','')!~'^[0-9]{13}$'
   OR abs((a->>'acceptedAt')::bigint-extract(epoch FROM clock_timestamp())*1000)>60000
   OR EXISTS(SELECT 1 FROM teach_mode.recorded_actions WHERE session_id=OLD.id)
   OR EXISTS(SELECT 1 FROM teach_mode.ui_snapshots WHERE teach_session_id=OLD.id) THEN
   RAISE EXCEPTION 'Reauthorization binding or evidence invalid' USING ERRCODE='TH002';
  END IF;
  FOR k IN SELECT jsonb_object_keys(a) LOOP
   IF NOT k=ANY(ARRAY['approvalId','action','sessionId','executionId','requestId','physicalId','beforeRevision','actorRef',
    'authenticationEventSha256','acceptedAt','riskAccepted','cleanupClaim','pendingAssessment','originalJournalSha256',
    'priorMarkerSha256','preflightDigest','previousClearance','newClearance']) THEN
    RAISE EXCEPTION 'Unknown reauthorization audit field' USING ERRCODE='TH002'; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.administrative_audit) d WHERE d->>'action'='DISPOSE'
    AND d->>'executionId'=a->>'executionId' AND d->>'requestId'=a->>'requestId'
    AND d->>'originalJournalSha256'=a->>'originalJournalSha256')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.administrative_audit) d WHERE d->>'approvalId'=a->>'approvalId'
    OR d->>'authenticationEventSha256'=a->>'authenticationEventSha256')
   OR jsonb_typeof(NEW.administrative_clearance) IS DISTINCT FROM 'object'
   OR (SELECT count(*) FROM jsonb_object_keys(NEW.administrative_clearance))<>4
   OR coalesce(NEW.administrative_clearance->>'id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR coalesce(NEW.administrative_clearance->>'requestId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR coalesce(NEW.administrative_clearance->>'sourceSha256','')!~'^[a-f0-9]{64}$'
   OR coalesce(NEW.administrative_clearance->>'expiresAt','')!~'^[0-9]{13}$'
   OR NEW.administrative_clearance->>'id'=OLD.administrative_clearance->>'id'
   OR NEW.administrative_clearance->>'requestId'=OLD.administrative_clearance->>'requestId'
   OR (NEW.administrative_clearance->>'expiresAt')::bigint<=extract(epoch FROM clock_timestamp())*1000
   OR (NEW.administrative_clearance->>'expiresAt')::bigint>extract(epoch FROM clock_timestamp())*1000+600000 THEN
   RAISE EXCEPTION 'New clearance invalid or old authorization replayed' USING ERRCODE='TH002';
  END IF;
  -- Serialize ID reuse across different original sessions as well as row-level CAS.
  PERFORM pg_advisory_xact_lock(hashtext('teach-clearance:'||(NEW.administrative_clearance->>'id')));
  PERFORM pg_advisory_xact_lock(hashtext('teach-request:'||(NEW.administrative_clearance->>'requestId')));
  IF EXISTS(SELECT 1 FROM teach_mode.teach_sessions s WHERE s.administrative_clearance->>'id'=NEW.administrative_clearance->>'id'
    OR s.administrative_clearance->>'requestId'=NEW.administrative_clearance->>'requestId'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(s.administrative_audit) h WHERE
      h->'previousClearance'->>'id'=NEW.administrative_clearance->>'id' OR h->'newClearance'->>'id'=NEW.administrative_clearance->>'id'
      OR h->'previousClearance'->>'requestId'=NEW.administrative_clearance->>'requestId'
      OR h->'newClearance'->>'requestId'=NEW.administrative_clearance->>'requestId')) THEN
   RAISE EXCEPTION 'Clearance ID/request already used' USING ERRCODE='TH002'; END IF;
  NEW.revision:=OLD.revision+1; RETURN NEW;
 END IF;
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

DROP TABLE teach_mode.teach_continuations;
DROP FUNCTION teach_mode.teach_continuation_immutable();
DELETE FROM teach_mode.teach_schema_migrations WHERE version=4 AND name='teach_continuation_v1';
COMMIT;
