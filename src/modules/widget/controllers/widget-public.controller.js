import {
  createPublicWidgetMessage,
  initializePublicWidgetSession,
  uploadPublicWidgetFile,
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

export const uploadPublicWidgetFileController = async (req, res, next) => {
  try {
    const data = await uploadPublicWidgetFile({
      publicKey: req.params.publicKey,
      sessionToken: req.body?.sessionToken,
      file: req.file,
    });

    return res.json({
      messageKey: 'success.file.uploaded',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
