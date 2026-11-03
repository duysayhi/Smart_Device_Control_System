import type { JsonReasoner } from './ollama';

const commands = new WeakMap<object, string>();
export function issueCloudCommand(source: string): object {
  const ref = Object.freeze({}); commands.set(ref, source.normalize('NFC')); return ref;
}
export function bindCommandSource(provider: JsonReasoner, source: string): JsonReasoner {
  const commandRef = issueCloudCommand(source);
  return { generate: (schema, system, input, budget, signal) => provider.generate(schema, system,
    input && typeof input === 'object' ? { ...input, commandRef } : input, budget, signal) };
}
// Explicit opt-in sends owner-authored command text to Groq, never screen text.
// Entire sensitive commands are withheld rather than partially redacted/guessed.
export function cloudCommandText(input: Record<string, unknown>): string | undefined {
  if (process.env.AGENT_GROQ_SEND_COMMAND_TEXT !== 'true' || input.sensitive === true || input.editable === true) return;
  const ref = input.commandRef;
  if (!ref || typeof ref !== 'object') return;
  const source = commands.get(ref);
  if (!source || source.length > 512 || /[\u0000-\u001f]/.test(source)) return;
  const folded = source.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  if (/\b(password|mat khau|passcode|pin|token|api key|secret|contacts?|danh ba|recipient|messages?|tin nhan|sms|send|gui|email|login|dang nhap|account|tai khoan)\b|gsk_|sk-proj-|@|\+?\d[\d .-]{7,}/.test(folded)) return;
  const key = process.env.GROQ_API_KEY;
  if (key && source.includes(key)) return;
  return source;
}
