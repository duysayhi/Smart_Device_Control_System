import { randomUUID } from 'node:crypto';
import * as ts from 'typescript';
import { understandOutcomes, validateOutcomeSpans, type OutcomeSpecV2 } from './outcome-spec';
import { capabilityFor } from './capability-registry';
import { GoalGraphV2Schema, type GoalGraphV2 } from './goal-graph';
import { requestedToggle, requestedPhoto } from './state-target';
import { requestedRecord } from './record-forms';
import { foldIntent } from './outcome-spec';
import { intentCapabilities } from './intent-capabilities';

// TypeScript's parser supplies the grammar; only a tiny numeric AST is evaluated.
export function arithmeticOracle(expression: string): { expression: string; result: string } {
  const normalized = expression.replace(/×/g, '*').replace(/[÷:]/g, '/').trim().replace(/[.!?]+$/, '');
  if (normalized.length > 120 || !/^[\d.\s+*/()\-]+$/.test(normalized)) throw new Error('UNSUPPORTED_OUTCOME: expected a bounded arithmetic expression.');
  const source = ts.createSourceFile('expression.ts', normalized, ts.ScriptTarget.ES2022, true);
  if (source.statements.length !== 1 || !ts.isExpressionStatement(source.statements[0])) throw new Error('Invalid expression.');
  const read = (node: ts.Node, depth = 0): number => {
    if (depth > 16) throw new Error('Expression nesting exceeded.');
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isParenthesizedExpression(node)) return read(node.expression, depth + 1);
    if (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(node.operator)) return (node.operator === ts.SyntaxKind.MinusToken ? -1 : 1) * read(node.operand, depth + 1);
    if (ts.isBinaryExpression(node)) {
      const a = read(node.left, depth + 1), b = read(node.right, depth + 1);
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: return a + b;
        case ts.SyntaxKind.MinusToken: return a - b;
        case ts.SyntaxKind.AsteriskToken: return a * b;
        case ts.SyntaxKind.SlashToken: return a / b;
      }
    }
    throw new Error('Unsupported arithmetic AST.');
  };
  const result = read(source.statements[0].expression);
  if (!Number.isFinite(result) || Math.abs(result) > 1e12) throw new Error('Arithmetic result outside supported range.');
  return { expression: normalized, result: String(Number(result.toPrecision(12))) };
}

export function compileOutcomes(request: string | OutcomeSpecV2, deviceId: string, executionId: string): GoalGraphV2 {
  const original = typeof request === 'string' ? understandOutcomes(request) : request;
  validateOutcomeSpans(original);
  let app: string | undefined;
  const nodes = original.outcomes.map((outcome, index) => {
    if (outcome.app) app = outcome.app;
    const capability = capabilityFor(outcome);
    let reason: string | undefined;
    if (outcome.negated) reason = 'NEEDS_CLARIFICATION: negated instructions are not executable outcomes.';
    else if (outcome.ambiguity.length) reason = 'NEEDS_CLARIFICATION: ' + outcome.ambiguity.join(', ');
    else if (!capability.executable) reason = 'UNSUPPORTED_OUTCOME: no registered executable verification path for ' + outcome.kind;
    if (outcome.kind === 'INTENT' && (!outcome.intent || !intentCapabilities[outcome.intent.request.name].implemented)) reason = 'NOT_IMPLEMENTED: intent has no independently verified non-persisting executor.';
    if (['ALARM', 'TIMER'].includes(outcome.kind) && !outcome.temporal && !outcome.ambiguity.length) reason = 'UNSUPPORTED_OUTCOME: typed time contract missing.';
    if (outcome.kind === 'CALCULATE') { try { arithmeticOracle(outcome.value); } catch { reason = 'UNSUPPORTED_OUTCOME: arithmetic expression cannot be compiled.'; } }
    if (outcome.kind === 'OPEN_RESULT' && (!outcome.browserResult || outcome.browserResult.ordinal !== 1 || index === 0 || original.outcomes[index - 1].kind !== 'SEARCH' || original.outcomes[index - 1].value !== outcome.browserResult.query)) reason = 'NEEDS_CLARIFICATION: BROWSER_RESULT_UNSUPPORTED: only first organic article after an exact search is supported.';
    if (outcome.kind === 'SET_STATE' && !requestedToggle(outcome)) reason = 'UNSUPPORTED_OUTCOME: only explicit labeled boolean state has a registered verifier.';
    if (outcome.kind === 'CAPTURE_MEDIA' && !requestedPhoto(outcome)) reason = 'UNSUPPORTED_OUTCOME: only an explicitly requested single photo has a registered media verifier.';
    if (['CREATE_RECORD', 'SET_STRUCTURED_STATE'].includes(outcome.kind) && !requestedRecord(outcome)) reason = 'UNSUPPORTED_OUTCOME: no exact supported record/time schema and readback contract.';
    const mediaProducer = outcome.kind === 'FIND_ARTIFACT' ? original.outcomes.slice(0, index).findLast(row => row.kind === 'CAPTURE_MEDIA') : undefined;
    if (outcome.kind === 'FIND_ARTIFACT' && (!mediaProducer || !/^(?:anh|hinh|photo|image)\s+(?:vua chup|just captured)$/.test(foldIntent(outcome.value)))) reason = 'UNSUPPORTED_OUTCOME: exact media view requires a typed capture producer; generic Gallery UI search is not implemented.';
    return { id: outcome.id, outcome, dependencies: [...new Set([...(index ? [original.outcomes[index - 1].id] : []), ...(mediaProducer ? [mediaProducer.id] : [])])], app: outcome.intent?.request.name === 'READ_STATE' ? undefined : app,
      capability: outcome.kind, preconditions: ['fresh device observation', 'grounded scope', 'registered verification'],
      predicates: [...capability.predicates], inputs: mediaProducer ? [mediaProducer.id] : [],
      outputs: ['CREATE_RECORD', 'CAPTURE_MEDIA'].includes(outcome.kind) ? [outcome.id + ':artifact'] : [],
      status: reason ? 'SAFE_BLOCKED' as const : 'PENDING' as const, reason, evidenceIds: [] as string[] };
  });
  return GoalGraphV2Schema.parse({ version: 2, id: randomUUID(), deviceId, executionId, original, nodes,
    coverage: nodes.some(node => node.reason?.startsWith('NEEDS_CLARIFICATION')) ? 'NEEDS_CLARIFICATION' : nodes.some(node => node.reason) ? 'UNSUPPORTED_OUTCOME' : 'COMPLETE' });
}
