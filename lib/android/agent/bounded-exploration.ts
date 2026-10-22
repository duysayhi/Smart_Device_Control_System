import type { GroundedCandidateV2 } from './grounded-candidates-v2';
import { isGroundedCandidate } from './grounded-candidates-v2';
import type { GoalNodeV2 } from './goal-graph';
import type { AgentBudget } from './budget';
import { foldIntent } from './outcome-spec';
import { NavigationBlocked } from './navigation-graph';

export class BoundedExploration {
  private readonly attempted = new Set<string>();
  private readonly uncertain = new Set<string>();
  begin(candidate: GroundedCandidateV2, parent: GoalNodeV2, budget: AgentBudget) {
    if (!isGroundedCandidate(candidate) || candidate.nodeId !== parent.id) throw new NavigationBlocked('Unissued exploration candidate or lost parent goal.');
    const key = [parent.id, candidate.action, candidate.target.resourceId, candidate.target.label, candidate.value ?? ''].join('|');
    if (this.uncertain.has(key)) throw new NavigationBlocked('UNCERTAIN_EFFECT_REPLAY_DENIED');
    if (candidate.effect !== 'READ') return key; // Existing typed mutation contracts still govern writes.
    const epoch = key + '|' + candidate.fingerprint;
    if (this.attempted.has(epoch)) throw new NavigationBlocked('EXPLORATION_EPOCH_LOOP');
    this.attempted.add(epoch);
    const target = foldIntent(parent.outcome.value).replace(/^(muc|trang|tab|page|section)\s+/, '');
    const direct = foldIntent(candidate.target.label).includes(target);
    if (parent.capability === 'NAVIGATE' && (!direct || candidate.action === 'SCROLL' || candidate.action === 'BACK')) budget.consume('recoverySubtasks');
    return key;
  }
  markUncertain(key: string) { this.uncertain.add(key); }
}
