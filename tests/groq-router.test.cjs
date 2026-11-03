/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { z } = require('zod'), { AgentBudget } = require('../lib/android/agent/budget.ts');
const { GroqProposalProvider, GroqLocalRouter, createStructuredReasoner, retryAfterMs, redactedReasoningPayload } = require('../lib/android/agent/reasoning-provider.ts');
const schema = z.object({ choice: z.enum(['C1', 'C2', 'ABSTAIN']) }).strict();
const input = { request: 'search private password', slots: [[1, 'private']], candidates: [{ id: 'C1', action: 'CLICK', label: 'private' }, { id: 'C2', action: 'BACK' }] };
const good = value => JSON.stringify({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }], usage: { prompt_tokens: 20, completion_tokens: 4 } });
let sequence = 0;
async function fixture(mode, run) {
  const secret = 'mock-private-key-' + (++sequence), bodies = []; let calls = 0, localCalls = 0;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    bodies.push(body); assert.equal(req.headers.authorization, 'Bearer ' + secret);
    if (req.url === '/models') return res.end(JSON.stringify({ data: [{ id: 'openai/gpt-oss-20b' }] }));
    calls++;
    if (mode === '429') { res.writeHead(429, { 'Retry-After': '30' }); return res.end(secret); }
    if (mode === '500') { res.writeHead(503); return res.end(secret); }
    if (mode === 'network') return req.socket.destroy();
    if (mode === 'timeout') return;
    res.end(mode === 'invalid' ? good('not JSON ' + secret) : mode === 'foreign' ? good({ choice: 'C6' }) : mode === 'grant' ? good({ choice: 'C1', grant: true }) : good({ choice: 'C1' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, transport = (url, options) => fetch('http://127.0.0.1:' + port + new URL(url).pathname.replace('/openai/v1', ''), options);
  const cloud = new GroqProposalProvider(transport, secret, Date.now, mode === 'timeout' ? 60 : 2000);
  const local = { async generate(_schema, _system, _input, budget) { localCalls++; budget.reasoningMeasurements.push({ model: 'qwen2.5:3b-instruct', status: 'VALID', elapsedMs: 1, loadMs: 0 }); return { choice: 'ABSTAIN' }; } };
  try { await run({ cloud, router: new GroqLocalRouter(cloud, local), bodies, secret, counts: () => ({ calls, localCalls }) }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('Groq success uses structured schema, closed projection and no private prompt', () => fixture('ok', async ({ router, bodies, counts }) => {
  const b = new AgentBudget(); assert.deepEqual(await router.generate(schema, 'private system', input, b), { choice: 'C1' });
  assert.deepEqual(counts(), { calls: 1, localCalls: 0 });
  const body = JSON.parse(bodies.at(-1)); assert.equal(body.response_format.type, 'json_schema');
  assert.equal(JSON.stringify(body).includes('private'), false); assert.deepEqual(JSON.parse(body.messages[1].content), redactedReasoningPayload(input));
  assert.deepEqual(b.reasoningMeasurements[0].sentFields, ['schema', 'slotIds', 'commandTags', 'candidates']);
}));
for (const [mode, reason] of [['429', 'HTTP_429'], ['500', 'HTTP_5XX'], ['network', 'NETWORK'], ['timeout', 'TIMEOUT'], ['invalid', 'INVALID_JSON'], ['foreign', 'FOREIGN_ID'], ['grant', 'INVALID_JSON']]) test('Groq ' + mode + ' falls back once without leaking response/error/key', () => fixture(mode, async ({ router, secret, counts }) => {
  const b = new AgentBudget(), out = await router.generate(schema, 'private', input, b);
  assert.deepEqual(out, { choice: 'ABSTAIN' }); assert.equal(counts().localCalls, 1);
  assert.equal(b.reasoningMeasurements.at(-1).fallbackReason, reason);
  assert.equal(JSON.stringify({ out, measurements: b.reasoningMeasurements }).includes(secret), false);
}));
test('Groq Retry-After skips subsequent cloud request', () => fixture('429', async ({ router, counts }) => {
  await router.generate(schema, '', input, new AgentBudget()); const b = new AgentBudget(); await router.generate(schema, '', input, b);
  assert.equal(counts().calls, 1); assert.equal(b.reasoningMeasurements.at(-1).fallbackReason, 'RETRY_AFTER');
  assert.equal(retryAfterMs('30'), 30000); assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60000);
}));
test('Groq three failures open short circuit', () => fixture('500', async ({ router, counts }) => {
  for (let i = 0; i < 3; i++) await router.generate(schema, '', input, new AgentBudget());
  const b = new AgentBudget(); await router.generate(schema, '', input, b); assert.equal(counts().calls, 3);
  assert.equal(b.reasoningMeasurements.at(-1).fallbackReason, 'CIRCUIT_OPEN');
}));
test('Groq process-local rate budget proactively falls back', () => fixture('ok', async ({ router, counts }) => {
  for (let i = 0; i < 5; i++) await router.generate(schema, '', input, new AgentBudget());
  const b = new AgentBudget(); await router.generate(schema, '', input, b); assert.equal(counts().calls, 5);
  assert.equal(b.reasoningMeasurements.at(-1).fallbackReason, 'RATE_BUDGET');
}));
test('Groq missing key does not attempt HTTP; local used', async () => {
  let calls = 0; const cloud = new GroqProposalProvider(async () => { calls++; throw Error('unexpected'); }, '');
  const router = new GroqLocalRouter(cloud, { generate: async () => ({ choice: 'ABSTAIN' }) });
  assert.deepEqual(await router.generate(schema, '', input, new AgentBudget()), { choice: 'ABSTAIN' }); assert.equal(calls, 0);
});
test('Cancellation never triggers local fallback', () => fixture('ok', async ({ router, counts }) => {
  const c = new AbortController(); c.abort(); await assert.rejects(router.generate(schema, '', input, new AgentBudget(), c.signal)); assert.equal(counts().localCalls, 0);
}));
test('Cloud disabled by default; V1 model config not changed', () => {
  const old = process.env.AGENT_STRUCTURED_PROVIDER; delete process.env.AGENT_STRUCTURED_PROVIDER;
  try { assert.equal(createStructuredReasoner().constructor.name, 'OllamaAgentReasoner'); } finally { if (old !== undefined) process.env.AGENT_STRUCTURED_PROVIDER = old; }
});
test('Local invalid choice is rejected once, never retried into execution', async () => {
  let calls = 0;
  const router = new GroqLocalRouter({ providerId: 'mock', generate: async () => { throw Error('secret'); } }, { generate: async () => { calls++; return { choice: 'C6' }; } });
  await assert.rejects(router.generate(schema, '', input, new AgentBudget()), /^Error: Local proposal unavailable or invalid\.$/); assert.equal(calls, 1);
});
test('Cloud public schema rejects private literals before HTTP and emits only sanitized error', () => fixture('ok', async ({ cloud, counts, secret }) => {
  await assert.rejects(cloud.generate(z.object({ choice: z.literal(secret) }), '', input, new AgentBudget()), /^Error: Groq proposal: PRIVATE_SCHEMA$/); assert.equal(counts().calls, 0);
}));
test('Proposal adapter has no grant, journal, verifier or device executor dependencies', () => {
  const src = fs.readFileSync('lib/android/agent/reasoning-provider.ts', 'utf8');
  assert.doesNotMatch(src, /from ['"].*(?:effect-grants|setting-mutations|full-control-policy|intent-executor|appium)/);
  const agent = fs.readFileSync('lib/android/agent/agent-v2.ts', 'utf8');
  assert.ok(agent.indexOf('await reasoner.generate') < agent.indexOf('const grant = artifacts.issueView'));
});
test('Provider serialization never exposes key and projection is idempotent', () => fixture('ok', async ({ cloud, secret }) => {
  assert.equal(JSON.stringify(cloud).includes(secret), false);
  const p = redactedReasoningPayload(input); assert.deepEqual(redactedReasoningPayload(p), p);
}));
test('Open-ended model strings or absent public choices stay local', () => fixture('ok', async ({ cloud, counts }) => {
  await assert.rejects(cloud.generate(z.object({ choice: z.literal('C1'), reason: z.string() }), '', input, new AgentBudget()), /PRIVATE_SCHEMA/);
  await assert.rejects(cloud.generate(z.object({ p: z.number() }), '', {}, new AgentBudget()), /PRIVATE_SCHEMA/);
  assert.equal(counts().calls, 0);
}));
test('M4e richer opt-in sends only authenticated owner command and exact manifest', () => fixture('ok', async ({ cloud, bodies }) => {
  const { issueCloudCommand } = require('../lib/android/agent/cloud-command.ts'), old = process.env.AGENT_GROQ_SEND_COMMAND_TEXT;
  process.env.AGENT_GROQ_SEND_COMMAND_TEXT = 'true';
  try {
    const b = new AgentBudget(); await cloud.generate(schema, 'private prompt', { ...input, commandRef: issueCloudCommand('search marine biology') }, b);
    const body = JSON.parse(bodies.at(-1)), payload = JSON.parse(body.messages[1].content);
    assert.equal(payload.commandText, 'search marine biology'); assert.equal(JSON.stringify(body).includes('private'), false);
    assert.deepEqual(b.reasoningMeasurements[0].sentFields, ['schema', 'slotIds', 'commandTags', 'candidates', 'commandText']);
    assert.equal(payload.commandRef, undefined);
  } finally { if (old === undefined) delete process.env.AGENT_GROQ_SEND_COMMAND_TEXT; else process.env.AGENT_GROQ_SEND_COMMAND_TEXT = old; }
}));
test('M4e sensitive and editable command contexts never enter cloud body or manifest', () => fixture('ok', async ({ cloud, bodies }) => {
  const { issueCloudCommand } = require('../lib/android/agent/cloud-command.ts'), old = process.env.AGENT_GROQ_SEND_COMMAND_TEXT;
  process.env.AGENT_GROQ_SEND_COMMAND_TEXT = 'true';
  try {
    for (const extra of [{ commandRef: issueCloudCommand('type password hidden') }, { commandRef: issueCloudCommand('search ordinary'), editable: true }]) {
      const b = new AgentBudget(); await cloud.generate(schema, '', { ...input, ...extra }, b);
      assert.equal(JSON.parse(JSON.parse(bodies.at(-1)).messages[1].content).commandText, undefined);
      assert.equal(b.reasoningMeasurements[0].sentFields.includes('commandText'), false);
    }
  } finally { if (old === undefined) delete process.env.AGENT_GROQ_SEND_COMMAND_TEXT; else process.env.AGENT_GROQ_SEND_COMMAND_TEXT = old; }
}));
