/* eslint-disable @typescript-eslint/no-require-imports */
// Test-only routing snapshot for the internal legacy facade.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.legacyRecipe = legacyRecipe;
exports.routeCapability = routeCapability;
const permission_decision_1 = require("../../lib/android/agent/permission-decision");
const safety_envelope_1 = require("../../lib/android/safety-envelope");
const goal_planner_1 = require("../../lib/android/agent/goal-planner");
const capabilities_1 = require("../../lib/android/capabilities");
const wifi_plan_1 = require("../../lib/android/wifi-plan");
const outcome_spec_1 = require("../../lib/android/agent/outcome-spec");
const browser_result_contract_1 = require("../../lib/android/agent/browser-result-contract");
function legacyRecipe(source) {
    const exactWifi = (0, wifi_plan_1.planWifiOff)(source) ?? (0, wifi_plan_1.planWifiOn)(source) ?? (0, wifi_plan_1.planWifiNavigation)(source);
    if (exactWifi)
        return exactWifi;
    const wifi = (0, wifi_plan_1.planWifiConnection)(source);
    // A free-form SSID cannot swallow a second requested action.
    if (wifi && ((0, outcome_spec_1.sourceClauseSpans)(source).length > 1 && !(0, wifi_plan_1.planWifiNavigation)(source) || /\b(?:va|roi|and|then)\s+(?:chup|tao|gui|mo|open|set|create)\b/.test((0, outcome_spec_1.commandMask)(source))))
        return;
    if (wifi)
        return wifi;
    return (0, outcome_spec_1.sourceClauseSpans)(source).length <= 2 ? (0, capabilities_1.planChromeCommand)(source) : undefined;
}
function routeCapability(source, backend, debugEngine) {
    (0, safety_envelope_1.assertSafeSource)(source);
    if ((0, permission_decision_1.decidePermission)({ source, stage: 'REQUEST' }).decision === 'DENY')
        throw Error('HARD_DENY: destructive or excluded source; no engine dispatched.');
    const recipe = legacyRecipe(source), legacy = (0, goal_planner_1.clearGoal)(source);
    const selected = debugEngine ?? (recipe ? 'ACTION_PLAN' : legacy && ['OPEN_RESULT', 'FIND_PLACE', 'OPEN_PAGE', 'FIND_ELEMENT'].includes(legacy.operation) ? 'V1' : 'V2');
    if (selected === 'V2' && legacy?.operation === 'OPEN_RESULT' && (0, browser_result_contract_1.browserResultRequest)(source)?.ordinal !== 1)
        throw Error('ASK: ENGINE_CAPABILITY_UNSUPPORTED: Agent V2 chưa hỗ trợ chọn kết quả theo thứ tự với đầy đủ bằng chứng xác minh. Chọn Tự động hoặc Agent V1 rồi Phân tích lại.');
    if (backend !== 'appium' && selected !== 'ACTION_PLAN')
        throw Error('BLOCKED: this engine requires Appium; no backend fallback.');
    if (selected === 'ACTION_PLAN' && !recipe && !legacy)
        throw Error('ASK: no complete legacy Action Plan coverage; use a supported explicit goal.');
    return { engine: selected, reason: debugEngine ? 'Debug selection; backend coverage and policy checks still required.' : recipe ? 'Existing complete legacy recipe and postconditions.' : selected === 'V1' ? 'Existing ordinal/native-navigation criteria and composite verifier.' : 'V2 typed outcomes, device discovery and registered predicates; coverage checked before dispatch.' };
}
