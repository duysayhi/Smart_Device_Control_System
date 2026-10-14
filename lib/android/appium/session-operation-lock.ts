import { AsyncLocalStorage } from 'node:async_hooks';

const owners = new AsyncLocalStorage<{ session: object; active: boolean }>();
const gates = new WeakMap<object, Promise<unknown>>();

// Context changes affect all commands on a Session. Nested native verification
// belongs to the same operation; independent callers must wait for its cleanup.
export async function withSessionContextLock<T>(session: object, operation: () => Promise<T>): Promise<T> {
  const owner = owners.getStore();
  if (owner?.session === session && owner.active) return operation();
  const previous = gates.get(session) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => {
    const token = { session, active: true };
    return owners.run(token, async () => {
      try { return await operation(); }
      finally { token.active = false; }
    });
  });
  gates.set(session, current);
  try { return await current; }
  finally { if (gates.get(session) === current) gates.delete(session); }
}
