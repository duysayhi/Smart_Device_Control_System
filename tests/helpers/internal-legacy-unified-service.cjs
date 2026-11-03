/* eslint-disable @typescript-eslint/no-require-imports */
// Test-only characterization snapshot of the pre-merge facade. Never import from runtime.
const { AsyncLocalStorage } = require("node:async_hooks");
const legacyScope = new AsyncLocalStorage();
const { z } = require("zod");
const legacyAnalyzeInput = z.object({source:z.string().trim().min(1).max(2000),deviceId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),debugEngine:z.enum(["ACTION_PLAN","V1","V2"]).optional()}).strict();
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnifiedAgentService = exports.UnifiedPlanError = exports.UnifiedNotSentError = void 0;
exports.actionPlanCompletion = actionPlanCompletion;
const node_crypto_1 = require("node:crypto");
const contracts_1 = ({ AnalyzeInput: legacyAnalyzeInput });
const clarification_1 = require("../../lib/android/unified-agent/clarification");
const capability_router_1 = require("./internal-legacy-router.cjs");
const action_plan_schema_1 = require("../../lib/validators/action-plan.schema");
const goal_planner_1 = require("../../lib/android/agent/goal-planner");
const budget_1 = require("../../lib/android/agent/budget");
const safety_envelope_1 = require("../../lib/android/safety-envelope");
const binding = (c) => JSON.stringify([c.deviceId, c.physicalId, c.backend, c.runtimeHash, c.policyMode, c.ownerId]);
const terminal = (e) => Boolean(e.finishedAt);
class UnifiedNotSentError extends Error {
}
exports.UnifiedNotSentError = UnifiedNotSentError;
class UnifiedPlanError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.UnifiedPlanError = UnifiedPlanError;
function actionPlanCompletion(event) {
    if (event.success && event.status === 'SUCCESS' && event.steps.length > 0 && event.steps.every(s => s.status === 'SUCCESS' && s.verification === 'VERIFIED'))
        return 'COMPLETED';
    if (event.status === 'FAILED' || event.steps.some(s => s.status === 'FAILED'))
        return 'FAILED';
    return event.status === 'SENT' || event.steps.some(s => s.status === 'SENT') ? 'SENT' : 'FAILED';
}
function checkLegacyCoverage(source, plan) {
    (0, safety_envelope_1.assertSafePlan)(source, plan);
    const recipe = (0, capability_router_1.legacyRecipe)(source);
    if (recipe) {
        if (JSON.stringify(recipe.actions) !== JSON.stringify(plan.actions))
            throw Error('Action Plan changed the complete backend recipe.');
        return;
    }
    const spec = (0, goal_planner_1.clearGoal)(source);
    if (!spec)
        throw Error('ASK: unsupported legacy coverage.');
    const goal = (0, goal_planner_1.buildGoal)(source, spec, new budget_1.AgentBudget());
    if (plan.actions.some(a => !goal.allowedActionScope.includes(a.type)))
        throw Error('Action Plan exceeds the reviewed goal scope.');
    if (!plan.actions.some(a => a.type === 'OPEN_APP' && [spec.app, goal.packageName].includes(a.app)))
        throw Error('Action Plan omitted the requested application.');
    const inputs = plan.actions.filter(a => a.type === 'INPUT_TEXT');
    if (spec.query ? inputs.length !== 1 || inputs[0].text !== spec.query : inputs.length > 0)
        throw Error('Action Plan query coverage mismatch.');
    if (spec.operation === 'OPEN_RESULT' && !plan.actions.some(a => a.type === 'CLICK' && a.target === (spec.resultType === 'video' ? `video_card_${spec.ordinal}` : spec.ordinal === 1 ? 'first_result' : `result_${spec.ordinal}`)))
        throw Error('Action Plan omitted the requested ordinal.');
    if (['FIND_ELEMENT', 'FIND_PLACE', 'OPEN_PAGE'].includes(spec.operation))
        throw Error('ASK: use the native-navigation engine with explicit final criteria.');
    // Existing legacy verifiers prove these essential transitions, not arbitrary
    // extra navigation appended by a model. WAIT_FOR itself has no device effect.
    const effects = plan.actions.filter(a => a.type !== 'WAIT_FOR');
    const expected = [{ type: 'OPEN_APP', app: spec.app }];
    if (spec.query)
        expected.push({ type: 'CLICK', target: 'search_button' }, { type: 'INPUT_TEXT', text: spec.query }, { type: 'PRESS_KEY', key: 'ENTER' });
    if (spec.operation === 'OPEN_RESULT')
        expected.push({ type: 'CLICK', target: spec.resultType === 'video' ? `video_card_${spec.ordinal}` : spec.ordinal === 1 ? 'first_result' : `result_${spec.ordinal}` });
    const normalized = effects.map(a => a.type === 'OPEN_APP' ? { ...a, app: a.app === goal.packageName ? spec.app : a.app } : a);
    if (JSON.stringify(normalized) !== JSON.stringify(expected))
        throw Error('ASK: Action Plan contains extra effects or lacks the complete legacy verification sequence.');
}
class UnifiedAgentService {
    adapters;
    now;
    plans = new Map();
    clarifications = new Map();
    executions = new Map();
    busy(physicalId) { return [...this.executions.values()].some(l => l.view.plan.physicalId === physicalId && !terminal(l.view)); }
    constructor(adapters, now = Date.now) {
        this.adapters = adapters;
        this.now = now;
    }
    async analyzeForDashboard(input) {
        const parsed = contracts_1.AnalyzeInput.parse(input), options = (0, clarification_1.alarmPeriodChoices)(parsed.source);
        if (!options)
            return { plan: await this.analyze(parsed) };
        const c = await this.adapters.context(parsed.deviceId);
        if (c.busy || this.busy(c.physicalId))
            throw Error('BLOCKED: selected physical device already has an execution.');
        const route = (0, capability_router_1.routeCapability)(parsed.source, c.backend, parsed.debugEngine);
        if (route.engine !== 'V2')
            return { plan: await this.analyze(parsed) };
        for (const [id, old] of this.clarifications)
            if (old.view.expiresAt <= this.now())
                this.clarifications.delete(id);
        if (this.clarifications.size >= 100)
            throw Error('Too many pending clarification requests.');
        const view = { reference: (0, node_crypto_1.randomUUID)(), source: parsed.source, deviceId: parsed.deviceId,
            expiresAt: this.now() + 120000, kind: 'ALARM_PERIOD', question: options.question,
            choices: options.choices.map(({ id, label }) => ({ id, label })) };
        this.clarifications.set(view.reference, { view, input: parsed, binding: binding(c), choices: options.choices });
        return { clarification: structuredClone(view) };
    }
    async clarify(reference, choice) {
        const pending = this.clarifications.get(reference), selected = pending?.choices.find(c => c.id === choice);
        if (!pending || !selected || pending.view.expiresAt <= this.now())
            throw Error('Clarification expired, used or unavailable; analyze again.');
        this.clarifications.delete(reference);
        const c = await this.adapters.context(pending.input.deviceId);
        if (binding(c) !== pending.binding || c.busy || this.busy(c.physicalId) || pending.view.expiresAt <= this.now())
            throw Error('Clarification device, permission or expiry changed; analyze again.');
        const result = await this.analyzeForDashboard({ ...pending.input, source: selected.source });
        if (result.plan) {
            result.plan.clarifiedFrom = pending.view.source;
            this.plans.get(result.plan.reference).view.clarifiedFrom = pending.view.source;
        }
        return result;
    }
    async reanalyze(reference) {
        const old = this.plans.get(reference);
        if (!old || old.consumed)
            throw new UnifiedPlanError('PLAN_UNAVAILABLE', 'Plan used or unavailable; analyze the command again.');
        old.consumed = true;
        const fresh = await this.analyze(old.input);
        if (old.view.clarifiedFrom) {
            fresh.clarifiedFrom = old.view.clarifiedFrom;
            this.plans.get(fresh.reference).view.clarifiedFrom = fresh.clarifiedFrom;
        }
        return fresh;
    }
    async analyze(input) {
        const { source, deviceId, debugEngine } = contracts_1.AnalyzeInput.parse(input), c = await this.adapters.context(deviceId);
        if (c.busy || this.busy(c.physicalId))
            throw Error('BLOCKED: selected physical device already has an execution.');
        const route = (0, capability_router_1.routeCapability)(source, c.backend, debugEngine);
        let p, steps, summary = source, confirmations, analysisMetrics;
        let backendExpiry = Infinity;
        const started = this.now();
        if (route.engine === 'ACTION_PLAN') {
            const result = await this.adapters.interpret(source, deviceId), plan = action_plan_schema_1.ActionPlanSchema.parse(result.actionPlan);
            checkLegacyCoverage(source, plan);
            p = { actionPlan: plan, authorizationToken: result.authorizationToken };
            steps = plan.actions.map(a => a.type === 'OPEN_APP' ? `Mở ${a.app}` : a.type === 'INPUT_TEXT' ? `Nhập đúng: ${a.text}` : a.type === 'WAIT_FOR' ? `Chờ và xác minh: ${a.target}` : a.type === 'CLICK' ? `Chọn và xác minh: ${a.target}` : a.type === 'PRESS_KEY' ? `Nhấn ${a.key}` : a.type);
            confirmations = ['Chính sách và xác nhận kết nối Wi-Fi của Action Plan vẫn được áp dụng.'];
        }
        else {
            const result = await this.adapters.prepare(source, deviceId, route.engine);
            p = { workerReference: result.reference };
            steps = result.steps;
            summary = result.summary;
            confirmations = result.confirmations;
            analysisMetrics = result.metrics;
            backendExpiry = result.expiresAt;
        }
        const fresh = await this.adapters.context(deviceId);
        if (binding(c) !== binding(fresh) || fresh.busy || this.busy(fresh.physicalId))
            throw Error('Device or permission changed during analysis; analyze again.');
        const reference = (0, node_crypto_1.randomUUID)(), expiresAt = Math.min(backendExpiry, route.engine === 'ACTION_PLAN' ? started + 85000 : this.now() + 85000);
        if (expiresAt <= this.now())
            throw Error('Analysis authorization expired; analyze again.');
        const view = { reference, source, deviceId, physicalId: c.physicalId, engine: route.engine, expiresAt, summary, steps, confirmations, reason: route.reason, analysisMetrics };
        for (const [id, old] of this.plans)
            if (old.view.expiresAt <= this.now() || old.consumed)
                this.plans.delete(id);
        if (this.plans.size >= 100)
            throw Error('Too many pending plans.');
        this.plans.set(reference, { view, input: contracts_1.AnalyzeInput.parse(input), binding: binding(c), consumed: false, ...p });
        return structuredClone(view);
    }
    async execute(reference) {
        const p = this.plans.get(reference);
        if (!p)
            throw new UnifiedPlanError('PLAN_UNAVAILABLE', 'Plan used, expired or unavailable after restart; analyze again.');
        if (p.consumed)
            throw new UnifiedPlanError('PLAN_REPLAYED', 'Plan used; analyze again.');
        if (p.view.expiresAt <= this.now())
            throw new UnifiedPlanError('PLAN_EXPIRED', 'Plan expired; analyze again.');
        const c = await this.adapters.context(p.view.deviceId);
        if (binding(c) !== p.binding || c.busy || this.busy(c.physicalId) || p.consumed || p.view.expiresAt <= this.now())
            throw Error('Device, permission, source version, expiry or replay check failed.');
        p.consumed = true;
        // Consume before the first await/dispatch. No alternate engine is tried on failure.
        const id = (0, node_crypto_1.randomUUID)(), live = { view: { id, plan: structuredClone(p.view), status: 'QUEUED' }, plan: p, controller: new AbortController() };
        this.executions.set(id, live);
        for (const [oldId, old] of this.executions)
            if (this.executions.size > 40 && terminal(old.view))
                this.executions.delete(oldId);
        live.running = this.dispatch(live);
        return structuredClone(live.view);
    }
    async dispatch(live) {
        const p = live.plan, view = live.view;
        try {
            if (live.controller.signal.aborted) {
                view.status = 'CANCELLED';
                view.finishedAt = this.now();
                return;
            }
            if (p.view.engine !== 'ACTION_PLAN') {
                const task = await this.adapters.start(p.workerReference);
                if (task.request !== p.view.source || task.deviceId !== p.view.deviceId || task.physicalId !== p.view.physicalId || (task.agentVersion === 2 ? 'V2' : 'V1') !== p.view.engine)
                    throw Error('Worker task binding mismatch; inspect original worker execution.');
                view.workerExecutionId = task.executionId;
                view.task = task;
                view.status = task.status;
                view.rawStatus = task.status;
                if (live.controller.signal.aborted)
                    await this.adapters.cancel(task);
                return;
            }
            view.status = 'RUNNING';
            const response = await this.adapters.legacy(p.actionPlan, p.view.source, p.view.deviceId, p.authorizationToken, live.controller.signal, live.confirmationToken);
            if (!response.ok) {
                const data = await response.json();
                if (response.status === 409 && data.confirmationRequired === true && typeof data.confirmationToken === 'string' && !live.confirmationToken) {
                    live.confirmationToken = data.confirmationToken;
                    view.status = 'WAITING_CONFIRMATION';
                    view.reason = data.error;
                    return;
                }
                view.status = 'BLOCKED';
                view.reason = data.error ?? 'Legacy preflight rejected.';
                view.finishedAt = this.now();
                return;
            }
            if (!response.body)
                throw Error('Missing legacy evidence stream.');
            const reader = response.body.getReader(), decoder = new TextDecoder();
            let buffer = '', complete = false;
            try {
                while (true) {
                    const chunk = await reader.read();
                    if (chunk.done)
                        break;
                    buffer += decoder.decode(chunk.value, { stream: true });
                    if (buffer.length > 2000000)
                        throw Error('Evidence stream exceeded its bound.');
                    let boundary;
                    while ((boundary = buffer.indexOf('\n')) >= 0) {
                        const line = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 1);
                        if (!line.trim())
                            continue;
                        const event = JSON.parse(line);
                        view.legacyEvent = event;
                        view.steps = event.steps;
                        if (event.type === 'complete') {
                            complete = true;
                            view.rawStatus = event.status;
                            view.status = actionPlanCompletion(event);
                            view.reason = event.error;
                        }
                    }
                }
            }
            finally {
                reader.releaseLock();
            }
            if (!complete)
                throw Error('Legacy stream ended without a final verification result.');
            // A cancelled command may have had an effect; retain the actual final status/evidence.
            view.finishedAt = this.now();
        }
        catch (error) {
            view.status = error instanceof UnifiedNotSentError ? 'BLOCKED' : 'UNKNOWN_EFFECT';
            view.reason = error instanceof Error ? error.message : 'Dispatch outcome uncertain; no replay.';
            // A lost worker response may hide a running task. Keep polling by its immutable
            // batch reference, and let cancellation reach it without resending START.
            if (p.view.engine === 'ACTION_PLAN')
                live.controller.abort();
            if (p.view.engine === 'ACTION_PLAN' || error instanceof UnifiedNotSentError)
                view.finishedAt = this.now();
        }
    }
    async list() {
        if ([...this.executions.values()].some(l => l.plan.view.engine !== 'ACTION_PLAN' && !l.view.finishedAt)) {
            const tasks = await this.adapters.tasks();
            for (const live of this.executions.values()) {
                const task = tasks.find(t => t.executionId === live.view.workerExecutionId || t.batchId === live.plan.workerReference);
                if (live.plan.view.engine === 'ACTION_PLAN' || !task)
                    continue;
                if (task.deviceId !== live.plan.view.deviceId || task.request !== live.plan.view.source || task.physicalId !== live.plan.view.physicalId || (task.agentVersion === 2 ? 'V2' : 'V1') !== live.plan.view.engine)
                    continue;
                live.view.task = task;
                live.view.workerExecutionId = task.executionId;
                live.view.rawStatus = task.status;
                live.view.status = task.status;
                live.view.finishedAt = task.finishedAt;
                live.view.reason = task.latest?.reason;
                if (live.controller.signal.aborted && !task.finishedAt && !task.cancelRequested)
                    await this.adapters.cancel(task);
            }
        }
        return [...this.executions.values()].map(l => structuredClone(l.view));
    }
    async cancel(id) {
        const live = this.executions.get(id);
        if (!live || terminal(live.view))
            return false;
        live.view.cancelRequested = true;
        live.controller.abort();
        if (live.view.task)
            await this.adapters.cancel(live.view.task);
        if (live.view.status === 'WAITING_CONFIRMATION') {
            live.view.status = 'CANCELLED';
            live.view.finishedAt = this.now();
        }
        return true;
    }
    async assist(id, reply) {
        const live = this.executions.get(id);
        if (!live || live.controller.signal.aborted || live.plan.view.engine !== reply.kind || !this.adapters.assist)
            throw Error('Assistance execution/engine mismatch.');
        const task = (await this.adapters.tasks()).find(t => t.executionId === live.view.workerExecutionId && t.deviceId === live.plan.view.deviceId && t.physicalId === live.plan.view.physicalId && t.request === live.plan.view.source);
        if (!task || task.status !== 'WAITING_HUMAN' || task.finishedAt || task.cancelRequested)
            throw Error('Assistance is not pending on this execution.');
        await this.adapters.assist(task, reply);
    }
    async confirm(id) {
        const live = this.executions.get(id);
        if (!live || live.view.status !== 'WAITING_CONFIRMATION' || live.confirming || live.controller.signal.aborted || live.plan.view.expiresAt <= this.now())
            throw Error('Confirmation unavailable or expired; no action sent.');
        live.confirming = true;
        try {
            const c = await this.adapters.context(live.plan.view.deviceId);
            if (binding(c) !== live.plan.binding || c.busy || live.controller.signal.aborted || live.plan.view.expiresAt <= this.now() || live.view.status !== 'WAITING_CONFIRMATION')
                throw Error('Confirmation binding changed.');
            live.view.status = 'QUEUED';
            live.running = this.dispatch(live);
        }
        finally {
            live.confirming = false;
        }
    }
}
exports.UnifiedAgentService = UnifiedAgentService;

exports.InternalLegacyUnifiedService = exports.UnifiedAgentService;
exports.internalLegacyFixture = () => legacyScope.getStore() === true;
exports.internalLegacyTest = (title, body) => require("node:test")("internal legacy: " + title, () => legacyScope.run(true, body));
