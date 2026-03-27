import { realtimeConfig } from '../../../config/realtime.config.js';
import { getMe } from '../../auth/services/auth.service.js';
import { getRealtimeRuntimeStatus } from '../../../infra/realtime/index.js';

export const getRealtimeBootstrap = async ({ userId, sessionId }) => {
  const authContext = await getMe({
    userId,
    sessionId,
  });
  const runtime = getRealtimeRuntimeStatus();

  return {
    realtime: {
      enabled: runtime.enabled,
      socketPath: runtime.path,
      transports: runtime.transports,
      auth: {
        sessionId,
        userId: authContext.user._id,
        workspaceId: authContext.workspace._id,
        roleKey: authContext.roleKey,
      },
      user: authContext.user,
      workspace: authContext.workspace,
      features: realtimeConfig.features,
      collaboration: {
        requiresTicketSubscription:
          realtimeConfig.collaboration.requiresTicketSubscription,
        presenceTtlMs: realtimeConfig.collaboration.presenceTtlMs,
        typingTtlMs: realtimeConfig.collaboration.typingTtlMs,
        softClaimTtlMs: realtimeConfig.collaboration.softClaimTtlMs,
        actionThrottleMs: realtimeConfig.collaboration.actionThrottleMs,
      },
      redis: runtime.redis,
    },
  };
};
