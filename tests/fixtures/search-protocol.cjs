/* eslint-disable @typescript-eslint/no-require-imports */
const { generateGroundedCandidates } = require('../../lib/android/agent/grounded-candidates-v2.ts');
const { consumeEffectGrant, issueEffectGrant } = require('../../lib/android/agent/effect-grants.ts');
const { beforeSearchDispatch, noteSearchQueryEntered } = require('../../lib/android/agent/generic-search.ts');
// Verifier tests still issue and consume entry authority, rather than starting
// from an unexplained pre-filled field and fabricating a submit receipt.
exports.enter = function enter(node, scope, before, after) {
  const c = generateGroundedCandidates(node, before, scope.executionId, scope.sessionId, false, 0, '', false, undefined, false, scope).candidates[0];
  if (c?.search?.phase !== 'ENTER') throw Error('Test protocol requires empty focused field.');
  consumeEffectGrant(issueEffectGrant(c, node), scope.deviceId, scope.sessionId);
  beforeSearchDispatch(c, before); noteSearchQueryEntered(c, before, after);
};
