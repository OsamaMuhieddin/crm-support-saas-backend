import mongoose from 'mongoose';
import { realtimeConfig } from '../../../config/realtime.config.js';
import {
  buildRealtimeAck,
  buildRealtimeEventEnvelope,
} from '../../../infra/realtime/contracts.js';
import { logRealtimeWarn } from '../../../infra/realtime/logger.js';
import { realtimePublisher } from '../../../infra/realtime/publisher.js';
import { ticketRoomName } from '../../../infra/realtime/rooms.js';
import { createError } from '../../../shared/errors/createError.js';
import { findTicketInWorkspaceOrThrow } from '../../tickets/services/ticket-query.service.js';
import { loadWorkspaceMemberUserSummaryMap } from '../../tickets/services/ticket-reference.service.js';
import {
  addRealtimeCollaborationSetMembers,
  deleteRealtimeCollaborationValue,
  getRealtimeCollaborationJsonValue,
  getRealtimeCollaborationSetMembers,
  removeRealtimeCollaborationSetMembers,
  resetRealtimeCollaborationStore,
  setRealtimeCollaborationJsonValue,
} from './realtime-collaboration-store.service.js';
import {
  assertRealtimeActionAllowed,
  clearRealtimeActionGuardForSocket,
  resetRealtimeActionGuardRuntime,
} from './realtime-action-guard.service.js';

const PRESENCE_STATES = new Set(['viewing', 'replying', 'internal_note']);
const TYPING_MODES = new Set(['public_reply', 'internal_note']);
const COLLABORATION_KEY_PREFIX = 'realtime:collaboration';
const expiryTimers = new Map();

const toTrimmedString = (value) => String(value || '').trim();

const assertObjectIdOrThrow = (value, field) => {
  const normalized = toTrimmedString(value);

  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
    throw createError('errors.validation.invalidId', 422, {
      field,
    });
  }

  return normalized;
};

const assertEnumOrThrow = ({ value, field, allowedValues }) => {
  const normalized = toTrimmedString(value);

  if (!allowedValues.has(normalized)) {
    throw createError('errors.validation.invalidEnum', 422, {
      field,
    });
  }

  return normalized;
};

const buildRealtimeTicketAck = ({
  code,
  ticketId,
  extra = null,
}) =>
  buildRealtimeAck({
    ok: true,
    code,
    messageKey: 'success.ok',
    data: {
      scope: 'ticket',
      ticketId: String(ticketId),
      ...(extra && typeof extra === 'object' ? extra : {}),
    },
  });

const buildTicketRef = ({ workspaceId, ticketId }) =>
  `${String(workspaceId)}:${String(ticketId)}`;

const parseTicketRef = (value) => {
  const [workspaceId = '', ticketId = ''] = String(value || '').split(':');

  return {
    workspaceId: workspaceId.trim(),
    ticketId: ticketId.trim(),
  };
};

const presenceItemKey = ({ workspaceId, ticketId, socketId }) =>
  `${COLLABORATION_KEY_PREFIX}:presence:item:${workspaceId}:${ticketId}:${socketId}`;

const presenceTicketSetKey = ({ workspaceId, ticketId }) =>
  `${COLLABORATION_KEY_PREFIX}:presence:ticket:${workspaceId}:${ticketId}`;

const presenceSocketSetKey = ({ socketId }) =>
  `${COLLABORATION_KEY_PREFIX}:presence:socket:${socketId}`;

const typingItemKey = ({ workspaceId, ticketId, socketId }) =>
  `${COLLABORATION_KEY_PREFIX}:typing:item:${workspaceId}:${ticketId}:${socketId}`;

const typingTicketSetKey = ({ workspaceId, ticketId }) =>
  `${COLLABORATION_KEY_PREFIX}:typing:ticket:${workspaceId}:${ticketId}`;

const typingSocketSetKey = ({ socketId }) =>
  `${COLLABORATION_KEY_PREFIX}:typing:socket:${socketId}`;

const softClaimTicketKey = ({ workspaceId, ticketId }) =>
  `${COLLABORATION_KEY_PREFIX}:soft-claim:ticket:${workspaceId}:${ticketId}`;

const softClaimSocketSetKey = ({ socketId }) =>
  `${COLLABORATION_KEY_PREFIX}:soft-claim:socket:${socketId}`;

const getPresenceTimerKey = ({ workspaceId, ticketId, socketId }) =>
  `presence:${workspaceId}:${ticketId}:${socketId}`;

const getTypingTimerKey = ({ workspaceId, ticketId, socketId }) =>
  `typing:${workspaceId}:${ticketId}:${socketId}`;

const getSoftClaimTimerKey = ({ workspaceId, ticketId }) =>
  `soft-claim:${workspaceId}:${ticketId}`;

const clearExpiryTimer = (timerKey) => {
  const timer = expiryTimers.get(timerKey);

  if (timer) {
    clearTimeout(timer);
    expiryTimers.delete(timerKey);
  }
};

const scheduleExpiryTimer = ({ timerKey, delayMs, callback }) => {
  clearExpiryTimer(timerKey);

  const timer = setTimeout(async () => {
    expiryTimers.delete(timerKey);

    try {
      // Expiry fan-out is best-effort per node. The canonical recovery path
      // remains re-subscribe + snapshot, while stale set members are pruned
      // from the shared store on subsequent reads.
      await callback();
    } catch (error) {
      logRealtimeWarn('Failed to process realtime collaboration expiry.', {
        timerKey,
        error: error?.message || 'unknown',
      });
    }
  }, Math.max(1, delayMs));

  timer.unref?.();
  expiryTimers.set(timerKey, timer);
};

const sortEntriesByRecentActivity = (entries = []) =>
  [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.claimedAt || 0);
    const rightTime = Date.parse(right.updatedAt || right.claimedAt || 0);

    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    return String(left.userId || '').localeCompare(String(right.userId || ''));
  });

const buildFallbackUserSummary = ({ userId, roleKey = null }) => ({
  _id: String(userId),
  email: null,
  name: null,
  avatar: null,
  status: null,
  roleKey: roleKey || null,
});

const buildRealtimeUserView = ({ entry, usersById }) =>
  usersById.get(String(entry.userId)) ||
  buildFallbackUserSummary({
    userId: entry.userId,
    roleKey: entry.roleKey || null,
  });

const groupLatestEntriesByUserId = (entries = []) => {
  const grouped = new Map();

  for (const entry of sortEntriesByRecentActivity(entries)) {
    if (!grouped.has(String(entry.userId))) {
      grouped.set(String(entry.userId), entry);
    }
  }

  return sortEntriesByRecentActivity([...grouped.values()]);
};

const isSubscribedToTicketRoom = ({ socket, ticketId }) =>
  socket.rooms.has(ticketRoomName(ticketId));

const loadReadableTicketContextOrThrow = async ({
  socket,
  payload,
  requireSubscription = true,
}) => {
  const workspaceId = String(socket.data.auth.workspaceId);
  const ticketId = assertObjectIdOrThrow(payload?.ticketId, 'ticketId');

  await findTicketInWorkspaceOrThrow({
    workspaceId,
    ticketId,
    lean: true,
    projection: '_id workspaceId',
  });

  if (
    requireSubscription &&
    realtimeConfig.collaboration.requiresTicketSubscription &&
    !isSubscribedToTicketRoom({ socket, ticketId })
  ) {
    throw createError('errors.realtime.ticketSubscriptionRequired', 409);
  }

  return {
    workspaceId,
    ticketId,
    actorUserId: String(socket.data.auth.userId),
    roleKey: socket.data.member?.roleKey || null,
    socketId: String(socket.id),
  };
};

const pruneTicketSetEntries = async ({
  setKey,
  activeMembers,
  staleMembers,
}) => {
  if (staleMembers.length > 0) {
    await removeRealtimeCollaborationSetMembers({
      key: setKey,
      members: staleMembers,
    });
  }

  return activeMembers;
};

const listPresenceEntries = async ({ workspaceId, ticketId }) => {
  const setKey = presenceTicketSetKey({
    workspaceId,
    ticketId,
  });
  const socketIds = await getRealtimeCollaborationSetMembers({
    key: setKey,
  });

  if (socketIds.length === 0) {
    return [];
  }

  const entries = await Promise.all(
    socketIds.map(async (socketId) => ({
      socketId,
      value: await getRealtimeCollaborationJsonValue({
        key: presenceItemKey({
          workspaceId,
          ticketId,
          socketId,
        }),
      }),
    }))
  );

  const activeMembers = entries
    .filter((entry) => entry.value)
    .map((entry) => ({
      ...entry.value,
      socketId: String(entry.socketId),
    }));
  const staleMembers = entries
    .filter((entry) => !entry.value)
    .map((entry) => entry.socketId);

  return pruneTicketSetEntries({
    setKey,
    activeMembers,
    staleMembers,
  });
};

const listTypingEntries = async ({ workspaceId, ticketId }) => {
  const setKey = typingTicketSetKey({
    workspaceId,
    ticketId,
  });
  const socketIds = await getRealtimeCollaborationSetMembers({
    key: setKey,
  });

  if (socketIds.length === 0) {
    return [];
  }

  const entries = await Promise.all(
    socketIds.map(async (socketId) => ({
      socketId,
      value: await getRealtimeCollaborationJsonValue({
        key: typingItemKey({
          workspaceId,
          ticketId,
          socketId,
        }),
      }),
    }))
  );

  const activeMembers = entries
    .filter((entry) => entry.value)
    .map((entry) => ({
      ...entry.value,
      socketId: String(entry.socketId),
    }));
  const staleMembers = entries
    .filter((entry) => !entry.value)
    .map((entry) => entry.socketId);

  return pruneTicketSetEntries({
    setKey,
    activeMembers,
    staleMembers,
  });
};

const getSoftClaimEntry = async ({ workspaceId, ticketId }) =>
  getRealtimeCollaborationJsonValue({
    key: softClaimTicketKey({
      workspaceId,
      ticketId,
    }),
  });

const loadTicketCollaborationSnapshot = async ({ workspaceId, ticketId }) => {
  const [presenceEntries, typingEntries, softClaimEntry] = await Promise.all([
    listPresenceEntries({ workspaceId, ticketId }),
    listTypingEntries({ workspaceId, ticketId }),
    getSoftClaimEntry({ workspaceId, ticketId }),
  ]);

  const latestPresenceEntries = groupLatestEntriesByUserId(presenceEntries);
  const latestTypingEntries = groupLatestEntriesByUserId(typingEntries);
  const userIds = [
    ...new Set(
      [
        ...latestPresenceEntries.map((entry) => entry.userId),
        ...latestTypingEntries.map((entry) => entry.userId),
        softClaimEntry?.userId || null,
      ].filter(Boolean)
    ),
  ];
  const usersById = await loadWorkspaceMemberUserSummaryMap({
    workspaceId,
    userIds,
  });

  return {
    ticketId: String(ticketId),
    presence: latestPresenceEntries.map((entry) => ({
      userId: String(entry.userId),
      state: entry.state,
      updatedAt: entry.updatedAt,
      user: buildRealtimeUserView({
        entry,
        usersById,
      }),
    })),
    typing: latestTypingEntries.map((entry) => ({
      userId: String(entry.userId),
      mode: entry.mode,
      updatedAt: entry.updatedAt,
      user: buildRealtimeUserView({
        entry,
        usersById,
      }),
    })),
    softClaim: softClaimEntry
      ? {
          userId: String(softClaimEntry.userId),
          claimedAt: softClaimEntry.claimedAt,
          updatedAt: softClaimEntry.updatedAt,
          user: buildRealtimeUserView({
            entry: softClaimEntry,
            usersById,
          }),
        }
      : null,
  };
};

const emitTicketSnapshotToSocket = async ({ socket, workspaceId, ticketId }) => {
  const snapshot = await loadTicketCollaborationSnapshot({
    workspaceId,
    ticketId,
  });

  socket.emit(
    'ticket.presence.snapshot',
    buildRealtimeEventEnvelope({
      event: 'ticket.presence.snapshot',
      workspaceId,
      actorUserId: null,
      data: snapshot,
    })
  );

  return snapshot;
};

const emitPresenceChanged = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
}) => {
  const snapshot = await loadTicketCollaborationSnapshot({
    workspaceId,
    ticketId,
  });

  return realtimePublisher.emitToTicket({
    ticketId,
    workspaceId,
    actorUserId,
    event: 'ticket.presence.changed',
    data: {
      ticketId: String(ticketId),
      presence: snapshot.presence,
    },
  });
};

const emitTypingChanged = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
}) => {
  const snapshot = await loadTicketCollaborationSnapshot({
    workspaceId,
    ticketId,
  });

  return realtimePublisher.emitToTicket({
    ticketId,
    workspaceId,
    actorUserId,
    event: 'ticket.typing.changed',
    data: {
      ticketId: String(ticketId),
      typing: snapshot.typing,
    },
  });
};

const emitSoftClaimChanged = async ({
  workspaceId,
  ticketId,
  actorUserId = null,
}) => {
  const snapshot = await loadTicketCollaborationSnapshot({
    workspaceId,
    ticketId,
  });

  return realtimePublisher.emitToTicket({
    ticketId,
    workspaceId,
    actorUserId,
    event: 'ticket.soft_claim.changed',
    data: {
      ticketId: String(ticketId),
      softClaim: snapshot.softClaim,
    },
  });
};

const schedulePresenceExpiry = ({ workspaceId, ticketId, socketId }) => {
  const timerKey = getPresenceTimerKey({
    workspaceId,
    ticketId,
    socketId,
  });

  scheduleExpiryTimer({
    timerKey,
    delayMs: realtimeConfig.collaboration.presenceTtlMs + 100,
    callback: async () => {
      const current = await getRealtimeCollaborationJsonValue({
        key: presenceItemKey({
          workspaceId,
          ticketId,
          socketId,
        }),
      });

      if (current) {
        return;
      }

      const ticketRef = buildTicketRef({
        workspaceId,
        ticketId,
      });

      await Promise.all([
        removeRealtimeCollaborationSetMembers({
          key: presenceTicketSetKey({
            workspaceId,
            ticketId,
          }),
          members: [socketId],
        }),
        removeRealtimeCollaborationSetMembers({
          key: presenceSocketSetKey({
            socketId,
          }),
          members: [ticketRef],
        }),
      ]);

      await emitPresenceChanged({
        workspaceId,
        ticketId,
        actorUserId: null,
      });
    },
  });
};

const scheduleTypingExpiry = ({ workspaceId, ticketId, socketId }) => {
  const timerKey = getTypingTimerKey({
    workspaceId,
    ticketId,
    socketId,
  });

  scheduleExpiryTimer({
    timerKey,
    delayMs: realtimeConfig.collaboration.typingTtlMs + 100,
    callback: async () => {
      const current = await getRealtimeCollaborationJsonValue({
        key: typingItemKey({
          workspaceId,
          ticketId,
          socketId,
        }),
      });

      if (current) {
        return;
      }

      const ticketRef = buildTicketRef({
        workspaceId,
        ticketId,
      });

      await Promise.all([
        removeRealtimeCollaborationSetMembers({
          key: typingTicketSetKey({
            workspaceId,
            ticketId,
          }),
          members: [socketId],
        }),
        removeRealtimeCollaborationSetMembers({
          key: typingSocketSetKey({
            socketId,
          }),
          members: [ticketRef],
        }),
      ]);

      await emitTypingChanged({
        workspaceId,
        ticketId,
        actorUserId: null,
      });
    },
  });
};

const scheduleSoftClaimExpiry = ({ workspaceId, ticketId, socketId }) => {
  const timerKey = getSoftClaimTimerKey({
    workspaceId,
    ticketId,
  });

  scheduleExpiryTimer({
    timerKey,
    delayMs: realtimeConfig.collaboration.softClaimTtlMs + 100,
    callback: async () => {
      const current = await getRealtimeCollaborationJsonValue({
        key: softClaimTicketKey({
          workspaceId,
          ticketId,
        }),
      });

      if (current) {
        return;
      }

      await removeRealtimeCollaborationSetMembers({
        key: softClaimSocketSetKey({
          socketId,
        }),
        members: [
          buildTicketRef({
            workspaceId,
            ticketId,
          }),
        ],
      });

      await emitSoftClaimChanged({
        workspaceId,
        ticketId,
        actorUserId: null,
      });
    },
  });
};

const upsertPresenceState = async ({
  workspaceId,
  ticketId,
  socketId,
  userId,
  roleKey,
  state,
}) => {
  const key = presenceItemKey({
    workspaceId,
    ticketId,
    socketId,
  });
  const previous = await getRealtimeCollaborationJsonValue({
    key,
  });
  const next = {
    userId: String(userId),
    roleKey: roleKey || null,
    state,
    updatedAt: new Date().toISOString(),
  };
  const ticketRef = buildTicketRef({
    workspaceId,
    ticketId,
  });

  await Promise.all([
    setRealtimeCollaborationJsonValue({
      key,
      value: next,
      ttlMs: realtimeConfig.collaboration.presenceTtlMs,
    }),
    addRealtimeCollaborationSetMembers({
      key: presenceTicketSetKey({
        workspaceId,
        ticketId,
      }),
      members: [socketId],
    }),
    addRealtimeCollaborationSetMembers({
      key: presenceSocketSetKey({
        socketId,
      }),
      members: [ticketRef],
    }),
  ]);

  schedulePresenceExpiry({
    workspaceId,
    ticketId,
    socketId,
  });

  return {
    previous,
    next,
    changed:
      !previous ||
      previous.state !== next.state ||
      String(previous.userId) !== String(next.userId),
  };
};

const clearPresenceState = async ({ workspaceId, ticketId, socketId }) => {
  const key = presenceItemKey({
    workspaceId,
    ticketId,
    socketId,
  });
  const previous = await getRealtimeCollaborationJsonValue({
    key,
  });
  const ticketRef = buildTicketRef({
    workspaceId,
    ticketId,
  });

  clearExpiryTimer(
    getPresenceTimerKey({
      workspaceId,
      ticketId,
      socketId,
    })
  );

  await Promise.all([
    deleteRealtimeCollaborationValue({
      key,
    }),
    removeRealtimeCollaborationSetMembers({
      key: presenceTicketSetKey({
        workspaceId,
        ticketId,
      }),
      members: [socketId],
    }),
    removeRealtimeCollaborationSetMembers({
      key: presenceSocketSetKey({
        socketId,
      }),
      members: [ticketRef],
    }),
  ]);

  return {
    previous,
    changed: Boolean(previous),
  };
};

const upsertTypingState = async ({
  workspaceId,
  ticketId,
  socketId,
  userId,
  roleKey,
  mode,
}) => {
  const key = typingItemKey({
    workspaceId,
    ticketId,
    socketId,
  });
  const previous = await getRealtimeCollaborationJsonValue({
    key,
  });
  const next = {
    userId: String(userId),
    roleKey: roleKey || null,
    mode,
    updatedAt: new Date().toISOString(),
  };
  const ticketRef = buildTicketRef({
    workspaceId,
    ticketId,
  });

  await Promise.all([
    setRealtimeCollaborationJsonValue({
      key,
      value: next,
      ttlMs: realtimeConfig.collaboration.typingTtlMs,
    }),
    addRealtimeCollaborationSetMembers({
      key: typingTicketSetKey({
        workspaceId,
        ticketId,
      }),
      members: [socketId],
    }),
    addRealtimeCollaborationSetMembers({
      key: typingSocketSetKey({
        socketId,
      }),
      members: [ticketRef],
    }),
  ]);

  scheduleTypingExpiry({
    workspaceId,
    ticketId,
    socketId,
  });

  return {
    previous,
    next,
    changed:
      !previous ||
      previous.mode !== next.mode ||
      String(previous.userId) !== String(next.userId),
  };
};

const clearTypingState = async ({ workspaceId, ticketId, socketId }) => {
  const key = typingItemKey({
    workspaceId,
    ticketId,
    socketId,
  });
  const previous = await getRealtimeCollaborationJsonValue({
    key,
  });
  const ticketRef = buildTicketRef({
    workspaceId,
    ticketId,
  });

  clearExpiryTimer(
    getTypingTimerKey({
      workspaceId,
      ticketId,
      socketId,
    })
  );

  await Promise.all([
    deleteRealtimeCollaborationValue({
      key,
    }),
    removeRealtimeCollaborationSetMembers({
      key: typingTicketSetKey({
        workspaceId,
        ticketId,
      }),
      members: [socketId],
    }),
    removeRealtimeCollaborationSetMembers({
      key: typingSocketSetKey({
        socketId,
      }),
      members: [ticketRef],
    }),
  ]);

  return {
    previous,
    changed: Boolean(previous),
  };
};

const upsertSoftClaimState = async ({
  workspaceId,
  ticketId,
  socketId,
  userId,
  roleKey,
}) => {
  const key = softClaimTicketKey({
    workspaceId,
    ticketId,
  });
  const previous = await getRealtimeCollaborationJsonValue({
    key,
  });
  const now = new Date().toISOString();
  const next = {
    userId: String(userId),
    roleKey: roleKey || null,
    socketId: String(socketId),
    claimedAt:
      previous &&
      String(previous.userId) === String(userId) &&
      String(previous.socketId) === String(socketId)
        ? previous.claimedAt
        : now,
    updatedAt: now,
  };
  const ticketRef = buildTicketRef({
    workspaceId,
    ticketId,
  });

  await Promise.all([
    setRealtimeCollaborationJsonValue({
      key,
      value: next,
      ttlMs: realtimeConfig.collaboration.softClaimTtlMs,
    }),
    addRealtimeCollaborationSetMembers({
      key: softClaimSocketSetKey({
        socketId,
      }),
      members: [ticketRef],
    }),
  ]);

  if (previous?.socketId && String(previous.socketId) !== String(socketId)) {
    await removeRealtimeCollaborationSetMembers({
      key: softClaimSocketSetKey({
        socketId: previous.socketId,
      }),
      members: [ticketRef],
    });
  }

  scheduleSoftClaimExpiry({
    workspaceId,
    ticketId,
    socketId,
  });

  return {
    previous,
    next,
    changed:
      !previous ||
      String(previous.userId) !== String(next.userId) ||
      String(previous.socketId) !== String(next.socketId),
  };
};

const clearSoftClaimState = async ({
  workspaceId,
  ticketId,
  socketId = null,
}) => {
  const key = softClaimTicketKey({
    workspaceId,
    ticketId,
  });
  const previous = await getRealtimeCollaborationJsonValue({
    key,
  });
  const ticketRef = buildTicketRef({
    workspaceId,
    ticketId,
  });

  clearExpiryTimer(
    getSoftClaimTimerKey({
      workspaceId,
      ticketId,
    })
  );

  await deleteRealtimeCollaborationValue({
    key,
  });

  await Promise.all([
    previous?.socketId
      ? removeRealtimeCollaborationSetMembers({
          key: softClaimSocketSetKey({
            socketId: previous.socketId,
          }),
          members: [ticketRef],
        })
      : Promise.resolve(),
    socketId
      ? removeRealtimeCollaborationSetMembers({
          key: softClaimSocketSetKey({
            socketId,
          }),
          members: [ticketRef],
        })
      : Promise.resolve(),
  ]);

  return {
    previous,
    changed: Boolean(previous),
  };
};

const cleanupSocketPresenceStates = async ({ socketId }) => {
  const refs = await getRealtimeCollaborationSetMembers({
    key: presenceSocketSetKey({
      socketId,
    }),
  });
  const cleanedTickets = [];

  for (const ref of refs) {
    const { workspaceId, ticketId } = parseTicketRef(ref);
    const result = await clearPresenceState({
      workspaceId,
      ticketId,
      socketId,
    });

    if (result.changed) {
      cleanedTickets.push({
        workspaceId,
        ticketId,
      });
    }
  }

  return cleanedTickets;
};

const cleanupSocketTypingStates = async ({ socketId }) => {
  const refs = await getRealtimeCollaborationSetMembers({
    key: typingSocketSetKey({
      socketId,
    }),
  });
  const cleanedTickets = [];

  for (const ref of refs) {
    const { workspaceId, ticketId } = parseTicketRef(ref);
    const result = await clearTypingState({
      workspaceId,
      ticketId,
      socketId,
    });

    if (result.changed) {
      cleanedTickets.push({
        workspaceId,
        ticketId,
      });
    }
  }

  return cleanedTickets;
};

const cleanupSocketSoftClaims = async ({ socketId }) => {
  const refs = await getRealtimeCollaborationSetMembers({
    key: softClaimSocketSetKey({
      socketId,
    }),
  });
  const cleanedTickets = [];

  for (const ref of refs) {
    const { workspaceId, ticketId } = parseTicketRef(ref);
    const result = await clearSoftClaimState({
      workspaceId,
      ticketId,
      socketId,
    });

    if (result.changed) {
      cleanedTickets.push({
        workspaceId,
        ticketId,
      });
    }
  }

  return cleanedTickets;
};

export const emitTicketCollaborationSnapshot = async ({ socket, ticketId }) =>
  emitTicketSnapshotToSocket({
    socket,
    workspaceId: String(socket.data.auth.workspaceId),
    ticketId: String(ticketId),
  });

export const setTicketPresence = async ({ socket, payload }) => {
  const { workspaceId, ticketId, actorUserId, roleKey, socketId } =
    await loadReadableTicketContextOrThrow({
      socket,
      payload,
    });
  const state = assertEnumOrThrow({
    value: payload?.state,
    field: 'state',
    allowedValues: PRESENCE_STATES,
  });
  const actionGuard = assertRealtimeActionAllowed({
    socketId,
    eventName: 'ticket.presence.set',
    ticketId,
    fingerprint: `state:${state}`,
  });

  if (actionGuard.duplicateWithinThrottleWindow) {
    return buildRealtimeTicketAck({
      code: 'realtime.ticket.presence.updated',
      ticketId,
      extra: {
        state,
        expiresInMs: realtimeConfig.collaboration.presenceTtlMs,
      },
    });
  }

  const result = await upsertPresenceState({
    workspaceId,
    ticketId,
    socketId,
    userId: actorUserId,
    roleKey,
    state,
  });

  if (result.changed) {
    await emitPresenceChanged({
      workspaceId,
      ticketId,
      actorUserId,
    });
  }

  return buildRealtimeTicketAck({
    code: 'realtime.ticket.presence.updated',
    ticketId,
    extra: {
      state,
      expiresInMs: realtimeConfig.collaboration.presenceTtlMs,
    },
  });
};

export const startTicketTyping = async ({ socket, payload }) => {
  const { workspaceId, ticketId, actorUserId, roleKey, socketId } =
    await loadReadableTicketContextOrThrow({
      socket,
      payload,
    });
  const mode = assertEnumOrThrow({
    value: payload?.mode,
    field: 'mode',
    allowedValues: TYPING_MODES,
  });
  const actionGuard = assertRealtimeActionAllowed({
    socketId,
    eventName: 'ticket.typing.start',
    ticketId,
    fingerprint: `mode:${mode}`,
  });

  if (actionGuard.duplicateWithinThrottleWindow) {
    return buildRealtimeTicketAck({
      code: 'realtime.ticket.typing.started',
      ticketId,
      extra: {
        mode,
        expiresInMs: realtimeConfig.collaboration.typingTtlMs,
      },
    });
  }

  const result = await upsertTypingState({
    workspaceId,
    ticketId,
    socketId,
    userId: actorUserId,
    roleKey,
    mode,
  });

  if (result.changed) {
    await emitTypingChanged({
      workspaceId,
      ticketId,
      actorUserId,
    });
  }

  return buildRealtimeTicketAck({
    code: 'realtime.ticket.typing.started',
    ticketId,
    extra: {
      mode,
      expiresInMs: realtimeConfig.collaboration.typingTtlMs,
    },
  });
};

export const stopTicketTyping = async ({ socket, payload }) => {
  const { workspaceId, ticketId, actorUserId, socketId } =
    await loadReadableTicketContextOrThrow({
      socket,
      payload,
    });
  const actionGuard = assertRealtimeActionAllowed({
    socketId,
    eventName: 'ticket.typing.stop',
    ticketId,
    fingerprint: 'stop',
  });

  if (actionGuard.duplicateWithinThrottleWindow) {
    return buildRealtimeTicketAck({
      code: 'realtime.ticket.typing.stopped',
      ticketId,
    });
  }

  const result = await clearTypingState({
    workspaceId,
    ticketId,
    socketId,
  });

  if (result.changed) {
    await emitTypingChanged({
      workspaceId,
      ticketId,
      actorUserId,
    });
  }

  return buildRealtimeTicketAck({
    code: 'realtime.ticket.typing.stopped',
    ticketId,
  });
};

export const setTicketSoftClaim = async ({ socket, payload }) => {
  const { workspaceId, ticketId, actorUserId, roleKey, socketId } =
    await loadReadableTicketContextOrThrow({
      socket,
      payload,
    });
  const actionGuard = assertRealtimeActionAllowed({
    socketId,
    eventName: 'ticket.soft_claim.set',
    ticketId,
    fingerprint: 'set',
  });

  if (actionGuard.duplicateWithinThrottleWindow) {
    return buildRealtimeTicketAck({
      code: 'realtime.ticket.softClaim.set',
      ticketId,
      extra: {
        expiresInMs: realtimeConfig.collaboration.softClaimTtlMs,
      },
    });
  }

  const result = await upsertSoftClaimState({
    workspaceId,
    ticketId,
    socketId,
    userId: actorUserId,
    roleKey,
  });

  if (result.changed) {
    await emitSoftClaimChanged({
      workspaceId,
      ticketId,
      actorUserId,
    });
  }

  return buildRealtimeTicketAck({
    code: 'realtime.ticket.softClaim.set',
    ticketId,
    extra: {
      expiresInMs: realtimeConfig.collaboration.softClaimTtlMs,
    },
  });
};

export const clearTicketSoftClaim = async ({ socket, payload }) => {
  const { workspaceId, ticketId, actorUserId, socketId } =
    await loadReadableTicketContextOrThrow({
      socket,
      payload,
    });
  const actionGuard = assertRealtimeActionAllowed({
    socketId,
    eventName: 'ticket.soft_claim.clear',
    ticketId,
    fingerprint: 'clear',
  });

  if (actionGuard.duplicateWithinThrottleWindow) {
    return buildRealtimeTicketAck({
      code: 'realtime.ticket.softClaim.cleared',
      ticketId,
    });
  }

  const result = await clearSoftClaimState({
    workspaceId,
    ticketId,
    socketId,
  });

  if (result.changed) {
    await emitSoftClaimChanged({
      workspaceId,
      ticketId,
      actorUserId,
    });
  }

  return buildRealtimeTicketAck({
    code: 'realtime.ticket.softClaim.cleared',
    ticketId,
  });
};

export const clearSocketTicketCollaboration = async ({ socket, ticketId }) => {
  const workspaceId = String(socket.data.auth.workspaceId);
  const socketId = String(socket.id);
  const normalizedTicketId = String(ticketId);
  const [presenceResult, typingResult, softClaimResult] = await Promise.all([
    clearPresenceState({
      workspaceId,
      ticketId: normalizedTicketId,
      socketId,
    }),
    clearTypingState({
      workspaceId,
      ticketId: normalizedTicketId,
      socketId,
    }),
    clearSoftClaimState({
      workspaceId,
      ticketId: normalizedTicketId,
      socketId,
    }),
  ]);

  if (presenceResult.changed) {
    await emitPresenceChanged({
      workspaceId,
      ticketId: normalizedTicketId,
      actorUserId: null,
    });
  }

  if (typingResult.changed) {
    await emitTypingChanged({
      workspaceId,
      ticketId: normalizedTicketId,
      actorUserId: null,
    });
  }

  if (softClaimResult.changed) {
    await emitSoftClaimChanged({
      workspaceId,
      ticketId: normalizedTicketId,
      actorUserId: null,
    });
  }
};

export const cleanupDisconnectedSocketCollaboration = async ({ socket }) => {
  const socketId = String(socket.id);
  clearRealtimeActionGuardForSocket({
    socketId,
  });
  const [presenceTickets, typingTickets, softClaimTickets] = await Promise.all([
    cleanupSocketPresenceStates({
      socketId,
    }),
    cleanupSocketTypingStates({
      socketId,
    }),
    cleanupSocketSoftClaims({
      socketId,
    }),
  ]);

  for (const ticket of presenceTickets) {
    await emitPresenceChanged({
      ...ticket,
      actorUserId: null,
    });
  }

  for (const ticket of typingTickets) {
    await emitTypingChanged({
      ...ticket,
      actorUserId: null,
    });
  }

  for (const ticket of softClaimTickets) {
    await emitSoftClaimChanged({
      ...ticket,
      actorUserId: null,
    });
  }
};

export const resetTicketCollaborationRuntime = () => {
  for (const timer of expiryTimers.values()) {
    clearTimeout(timer);
  }

  expiryTimers.clear();
  resetRealtimeActionGuardRuntime();
  resetRealtimeCollaborationStore();
};
