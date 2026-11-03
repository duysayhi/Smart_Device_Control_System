import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import ts from 'typescript';
const load = createRequire(import.meta.url);
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:f}).outputText,f);
const { FORBIDDEN_KEYS } = load('../lib/skills/skill-safety.ts');
test('SQL parity: Teach DSL keys exactly match the owner package teach_has_forbidden_keys', () => {
  const sql = fs.readFileSync(new URL('../db/teach/10_install_teach_schema.sql', import.meta.url),'utf8');
  const body = /CREATE FUNCTION teach_has_forbidden_keys\(p jsonb\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/.exec(sql)?.[1];
  assert.ok(body, 'The authoritative SQL function must be present');
  const keys = [...body.matchAll(/jsonb_path_exists\(p, '\$\.\*\*\.([^']+)'\)/g)].map(m=>m[1]);
  assert.equal(keys.length,11); assert.equal(new Set(keys).size,11);
  assert.deepEqual(keys,[...FORBIDDEN_KEYS]); assert.equal(keys.includes('verify'),false);
});
