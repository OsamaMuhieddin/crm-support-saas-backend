import {
  continueRecoveredWidgetConversation,
  requestWidgetRecovery,
  startNewRecoveredWidgetConversation,
  verifyWidgetRecovery,
} from '../services/widget-recovery.service.js';

export const requestWidgetRecoveryController = async (req, res, next) => {
  try {
    const data = await requestWidgetRecovery({
      publicKey: req.params.publicKey,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.widget.recoveryRequested',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const verifyWidgetRecoveryController = async (req, res, next) => {
  try {
    const data = await verifyWidgetRecovery({
      publicKey: req.params.publicKey,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.widget.recoveryVerified',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const continueRecoveredWidgetConversationController = async (
  req,
  res,
  next
) => {
  try {
    const data = await continueRecoveredWidgetConversation({
      publicKey: req.params.publicKey,
      recoveryToken: req.body?.recoveryToken,
    });

    return res.json({
      messageKey: 'success.widget.recoveryContinued',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const startNewRecoveredWidgetConversationController = async (
  req,
  res,
  next
) => {
  try {
    const data = await startNewRecoveredWidgetConversation({
      publicKey: req.params.publicKey,
      recoveryToken: req.body?.recoveryToken,
    });

    return res.json({
      messageKey: 'success.widget.recoveryStartedNew',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
