import {
  createPublicWidgetMessage,
  initializePublicWidgetSession,
} from '../services/widget-public.service.js';

export const initializePublicWidgetSessionController = async (
  req,
  res,
  next
) => {
  try {
    const data = await initializePublicWidgetSession({
      publicKey: req.params.publicKey,
      sessionToken: req.body?.sessionToken,
    });

    return res.json({
      messageKey: 'success.widget.sessionInitialized',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const createPublicWidgetMessageController = async (req, res, next) => {
  try {
    const data = await createPublicWidgetMessage({
      publicKey: req.params.publicKey,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.widget.messageCreated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
