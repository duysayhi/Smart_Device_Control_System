const active = task => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(task.status);
async function recheckTask(api, executionId, deviceId, observations, now = Date.now) {
  const requestedAt = now(), task = (await api()).tasks.find(t => t.executionId === executionId && t.deviceId === deviceId);
  const row = { requestedAt, checkedAt: now(), executionId, status: task?.status, finishedAt: task?.finishedAt, terminal: Boolean(task && !active(task)) };
  observations.push(row);
  if (!task) throw Error('Execution missing during cancellation revalidation; no CANCEL sent.');
  return { task, terminal: row.terminal, row };
}
async function cancelIfActive(api, executionId, deviceId, observations, now = Date.now) {
  const checked = await recheckTask(api, executionId, deviceId, observations, now);
  if (checked.terminal) return checked;
  checked.row.cancelRequestedAt = now();
  const response = await api({ type: 'CANCEL', executionId, deviceId });
  checked.row.cancelRespondedAt = now(); checked.row.cancelAccepted = response.accepted;
  return checked;
}
module.exports = { active, recheckTask, cancelIfActive };
