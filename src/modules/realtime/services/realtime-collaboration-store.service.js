import { getRealtimeRedisClient } from '../../../infra/realtime/realtime-redis.js';

const memoryValueStore = new Map();
const memorySetStore = new Map();

const cloneValue = (value) =>
  value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));

const getNow = () => Date.now();

const getMemorySet = (key, createIfMissing = false) => {
  if (!memorySetStore.has(key) && createIfMissing) {
    memorySetStore.set(key, new Set());
  }

  return memorySetStore.get(key) || null;
};

const deleteMemorySetIfEmpty = (key) => {
  const set = memorySetStore.get(key);

  if (set && set.size === 0) {
    memorySetStore.delete(key);
  }
};

const pruneExpiredMemoryValue = (key) => {
  const entry = memoryValueStore.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= getNow()) {
    memoryValueStore.delete(key);
    return null;
  }

  return entry;
};

const setMemoryJsonValue = ({ key, value, ttlMs }) => {
  memoryValueStore.set(key, {
    value: cloneValue(value),
    expiresAt: getNow() + Math.max(1, Number(ttlMs) || 1),
  });
};

const getMemoryJsonValue = ({ key }) => {
  const entry = pruneExpiredMemoryValue(key);
  return entry ? cloneValue(entry.value) : null;
};

const deleteMemoryValue = ({ key }) => {
  memoryValueStore.delete(key);
};

const addMemorySetMembers = ({ key, members }) => {
  const safeMembers = (Array.isArray(members) ? members : [])
    .map((member) => String(member || '').trim())
    .filter(Boolean);

  if (safeMembers.length === 0) {
    return;
  }

  const set = getMemorySet(key, true);

  for (const member of safeMembers) {
    set.add(member);
  }
};

const getMemorySetMembers = ({ key }) => {
  const set = getMemorySet(key, false);
  return set ? [...set] : [];
};

const removeMemorySetMembers = ({ key, members }) => {
  const set = getMemorySet(key, false);

  if (!set) {
    return;
  }

  for (const member of Array.isArray(members) ? members : []) {
    set.delete(String(member || '').trim());
  }

  deleteMemorySetIfEmpty(key);
};

const getRedisClientOrNull = async () => getRealtimeRedisClient();

export const setRealtimeCollaborationJsonValue = async ({
  key,
  value,
  ttlMs,
}) => {
  const client = await getRedisClientOrNull();

  if (!client) {
    setMemoryJsonValue({ key, value, ttlMs });
    return;
  }

  await client.set(key, JSON.stringify(value), {
    PX: Math.max(1, Number(ttlMs) || 1),
  });
};

export const getRealtimeCollaborationJsonValue = async ({ key }) => {
  const client = await getRedisClientOrNull();

  if (!client) {
    return getMemoryJsonValue({ key });
  }

  const raw = await client.get(key);

  if (!raw) {
    return null;
  }

  return JSON.parse(raw);
};

export const deleteRealtimeCollaborationValue = async ({ key }) => {
  const client = await getRedisClientOrNull();

  if (!client) {
    deleteMemoryValue({ key });
    return;
  }

  await client.del(key);
};

export const addRealtimeCollaborationSetMembers = async ({ key, members }) => {
  const safeMembers = (Array.isArray(members) ? members : [])
    .map((member) => String(member || '').trim())
    .filter(Boolean);

  if (safeMembers.length === 0) {
    return;
  }

  const client = await getRedisClientOrNull();

  if (!client) {
    addMemorySetMembers({ key, members: safeMembers });
    return;
  }

  await client.sAdd(key, safeMembers);
};

export const getRealtimeCollaborationSetMembers = async ({ key }) => {
  const client = await getRedisClientOrNull();

  if (!client) {
    return getMemorySetMembers({ key });
  }

  return client.sMembers(key);
};

export const removeRealtimeCollaborationSetMembers = async ({
  key,
  members,
}) => {
  const safeMembers = (Array.isArray(members) ? members : [])
    .map((member) => String(member || '').trim())
    .filter(Boolean);

  if (safeMembers.length === 0) {
    return;
  }

  const client = await getRedisClientOrNull();

  if (!client) {
    removeMemorySetMembers({ key, members: safeMembers });
    return;
  }

  await client.sRem(key, safeMembers);
};

export const resetRealtimeCollaborationStore = () => {
  memoryValueStore.clear();
  memorySetStore.clear();
};
