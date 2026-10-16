/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd());
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file,
}).outputText, file);
const { runAdb } = require('../lib/android/adb.ts');
const { discoverApplication } = require('../lib/android/agent/application-discovery.ts');
const { planGoal } = require('../lib/android/agent/goal-planner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { createAgentExecution } = require('../lib/android/agent/agent-loop.ts');
const { nativeReadControl, nativeContextSafe } = require('../lib/android/agent/native-navigation.ts');
const { visibleNode, observedTarget, safeNavigationOwner } = require('../lib/android/agent/navigation-semantics.ts');
const { matchUiTarget, normalizeUiText } = require('../lib/android/ui-understanding.ts');
const { generateActionCandidates } = require('../lib/android/agent/action-candidates.ts');
// Read-only diagnostic of the current foreground UI. Never opens an app or sends a gesture.
async function inspect() {
  const [serial, packageName, target] = process.argv.slice(2);
  if (!serial || !packageName || !target) throw Error('Usage: node tests/native-app.integration.cjs SERIAL PACKAGE TARGET');
  const budget = new AgentBudget(), signal = AbortSignal.timeout(60000);
  const { goal } = await planGoal(`Mở ${packageName} và mở trang ${target}`, budget, undefined, signal,
    app => discoverApplication(serial, app, runAdb, signal));
  goal.currentSubgoal = 1;
  const execution = await createAgentExecution(goal, budget, serial, runAdb, signal);
  try {
    const s = await execution.observe(signal);
    console.log(JSON.stringify({ foreground: s.foregroundPackage, viewport: s.viewport, contextSafe: nativeContextSafe(goal, s),
      web: s.web && { status: s.web.status, contexts: s.web.contexts, reason: s.web.reason },
      webViewCount: s.nodes.filter(n => /WebView/.test(n.className)).length,
      target, labels: s.nodes.filter(n => n.text || n.description).slice(0, 24).map(n => ({ text: n.text, description: n.description, id: n.resourceId })),
      nodes: s.nodes.filter(n => normalizeUiText(n.text || n.description).includes(normalizeUiText(target))).map(n => {
        const selector = observedTarget(s, n), match = selector && matchUiTarget(s, selector, true);
        return { text: n.text, description: n.description, id: n.resourceId, bounds: n.bounds, visible: visibleNode(s, n),
          safeOwner: safeNavigationOwner(s, n), read: nativeReadControl(goal, s, n), selector,
          owner: match && { status: match.status, className: match.node?.className, id: match.node?.resourceId, description: match.node?.description, bounds: match.node?.bounds } };
      }), candidates: generateActionCandidates(goal, s).map(c => ({ role: c.semanticRole, action: c.action })) }, null, 2));
  } finally { await execution.close(); }
}
inspect().catch(error => { console.error(error.message); process.exitCode = 1; });
