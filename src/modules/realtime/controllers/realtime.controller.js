import { getRealtimeBootstrap } from '../services/realtime.service.js';

export const getRealtimeBootstrapController = async (req, res, next) => {
  try {
    const data = await getRealtimeBootstrap({
      userId: req.auth.userId,
      sessionId: req.auth.sessionId,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
