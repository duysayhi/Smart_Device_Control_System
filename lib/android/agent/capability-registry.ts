import type { OutcomeV2 } from './outcome-spec';

export const capabilityRegistry = {
  LAUNCH: { effect: 'READ', predicates: ['FOREGROUND_IS'], affordances: [], executable: true },
  NAVIGATE: { effect: 'READ', predicates: ['ELEMENT_VISIBLE'], affordances: ['navigation'], executable: true },
  SEARCH: { effect: 'READ', predicates: ['SEARCH_OUTCOME_MATCHES'], affordances: ['editable', 'search'], executable: true },
  OPEN_RESULT: { effect: 'READ', predicates: ['BROWSER_RESULT_MATCHES'], affordances: ['browser_organic'], executable: true },
  CALCULATE: { effect: 'LOCAL_WRITE', predicates: ['VALUE_EQUALS'], affordances: ['editable', 'clickable'], executable: true },
  CREATE_RECORD: { effect: 'LOCAL_WRITE', predicates: ['RECORD_READBACK_MATCHES'], affordances: ['editable', 'save'], executable: true },
  CAPTURE_MEDIA: { effect: 'LOCAL_WRITE', predicates: ['ARTIFACT_EXISTS'], affordances: ['capture'], executable: true },
  SET_STATE: { effect: 'LOCAL_WRITE', predicates: ['ITEM_SELECTED'], affordances: ['checkable'], executable: true },
  SET_STRUCTURED_STATE: { effect: 'LOCAL_WRITE', predicates: ['RECORD_READBACK_MATCHES'], affordances: ['editable', 'checkable', 'save'], executable: true },
  ALARM: { effect: 'LOCAL_WRITE', predicates: ['TEMPORAL_READBACK_MATCHES'], affordances: ['editable', 'selection', 'save'], executable: true },
  TIMER: { effect: 'LOCAL_WRITE', predicates: ['TEMPORAL_READBACK_MATCHES'], affordances: ['editable', 'selection', 'start'], executable: true },
  FIND_ARTIFACT: { effect: 'READ', predicates: ['ARTIFACT_IDENTITY_MATCHES'], affordances: ['media_viewer'], executable: true },
  INTENT: { effect: 'READ', predicates: ['INTENT_OUTCOME_VERIFIED'], affordances: [], executable: true },
  UNKNOWN: { effect: 'UNKNOWN', predicates: [], affordances: [], executable: false },
} as const;
export function capabilityFor(outcome: OutcomeV2) { return capabilityRegistry[outcome.kind]; }
