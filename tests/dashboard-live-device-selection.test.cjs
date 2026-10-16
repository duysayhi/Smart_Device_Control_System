/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
}).outputText, file);

const { resolveLiveDeviceSelection } = require('../lib/android/device-selection.ts');

test('real ADB devices replace demo defaults and preserve the selected USB device', () => {
    const result = resolveLiveDeviceSelection(
        [
            { serial: 'R58MA78W6QK', status: 'device', connectionType: 'USB', model: 'SM_A507FN', osVersion: '11', batteryLevel: 70 },
            { serial: 'EMULATOR-5554', status: 'device', connectionType: 'USB', model: 'Pixel 7', osVersion: '14', batteryLevel: 40 },
        ],
        'R58MA78W6QK'
    );

    assert.deepEqual(result.selectedDeviceIds, ['R58MA78W6QK']);
    assert.equal(result.selectedAndroidSerial, 'R58MA78W6QK');
    assert.equal(result.devices.length, 2);
    assert.equal(result.devices[0].id, 'R58MA78W6QK');
    assert.equal(result.devices[0].status, 'READY');
});

test('when no USB device is present, the selection falls back to empty and no stale demo IDs remain', () => {
    const result = resolveLiveDeviceSelection([], 'dev-001');

    assert.deepEqual(result.selectedDeviceIds, []);
    assert.equal(result.selectedAndroidSerial, '');
    assert.deepEqual(result.devices, []);
});
