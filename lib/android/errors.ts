import type { ExplorationMetrics } from './exploration/types';
import type { VisualSummary } from './visual-grounding';
export type AndroidErrorCode = 'TIMEOUT' | 'DEVICE_ERROR' | 'UNKNOWN' | 'BACKEND_ERROR' | 'SESSION_ERROR' | 'CONFIG_ERROR' | 'CANCELLED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'SCROLL_LIMIT_REACHED';

export class AndroidExecutionError extends Error {
  requestOutcomeKnown?: boolean;
  sessionInvalid?: boolean;
  exploration?: ExplorationMetrics;
  visual?: VisualSummary;
  visualFailure?: string;
  selection?: import('./exploration/types').DiscoveredSelection;
  interactionSent?: boolean;
  backendReason?: 'CHROMEDRIVER_INCOMPATIBLE' | 'CHROMEDRIVER_UNAVAILABLE' | 'CONTEXT_UNAVAILABLE';
  constructor(public readonly code: AndroidErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AndroidExecutionError';
  }
}

export function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AndroidExecutionError(signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED', signal.reason?.name === 'TimeoutError' ? 'Execution deadline exceeded.' : 'Execution cancelled.');
}

export function asAndroidError(error: unknown): AndroidExecutionError {
  if (error instanceof AndroidExecutionError) return error;
  return new AndroidExecutionError('BACKEND_ERROR', error instanceof Error ? error.message : 'Android execution failed.');
}
