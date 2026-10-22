export type Strategy = 'INTENT' | 'UI_NAVIGATION' | 'SETTINGS_SEARCH' | 'DISCOVERY';
export interface Reflection { capability: string; strategy: Strategy; outcome: 'VERIFIED' | 'BLOCKED' | 'UNKNOWN'; reason: string; changed: boolean }
export class StrategyFailure extends Error { constructor(message: string, readonly dispatch: 'NOT_SENT' | 'UNKNOWN' | 'ACKNOWLEDGED' = 'NOT_SENT') { super(message); } }
// A hint never authorizes an effect, changes source meaning, or supplies evidence.
const memory = new Map<string, Strategy>();
export const strategyHint = (device: string, version: string, capability: string) => memory.get(JSON.stringify([device, version, capability]));
export async function reflectStrategies<T>(capability: string, handlers: Partial<Record<Strategy, () => Promise<T>>>, records: Reflection[], check: () => void, changed = () => true): Promise<T> {
  for (const strategy of ['INTENT', 'UI_NAVIGATION', 'SETTINGS_SEARCH', 'DISCOVERY'] as const) {
    check();
    const handler = handlers[strategy];
    if (!handler) { records.push({ capability, strategy, outcome: 'BLOCKED', reason: 'No registered grounded executor and independent verifier.', changed: false }); continue; }
    try { const proof = await handler(); records.push({ capability, strategy, outcome: 'VERIFIED', reason: 'Registered verifier accepted independent evidence.', changed: changed() }); return proof; }
    catch (e) {
      const known = e instanceof StrategyFailure && e.dispatch === 'NOT_SENT';
      records.push({ capability, strategy, outcome: known ? 'BLOCKED' : 'UNKNOWN', reason: e instanceof Error ? e.message.slice(0, 180) : 'Unknown outcome', changed: !known });
      if (!known) throw e; // Never switch/retry after any possibly sent mutation.
    }
  }
  throw new StrategyFailure('SAFE_BLOCKED: every registered strategy exhausted without an effect.');
}
export function rememberVerifiedStrategy(device: string, version: string, capability: string, strategy: Strategy) {
  if (!device || !version) return;
  if (memory.size >= 128) memory.delete(memory.keys().next().value!);
  memory.set(JSON.stringify([device, version, capability]), strategy);
}
