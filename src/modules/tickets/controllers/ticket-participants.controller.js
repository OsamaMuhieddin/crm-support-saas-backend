import {
  listTicketParticipants,
  removeTicketParticipant,
  saveTicketParticipant,
} from '../services/ticket-participants.service.js';

export const listTicketParticipantsController = async (req, res, next) => {
  try {
    const data = await listTicketParticipants({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const saveTicketParticipantController = async (req, res, next) => {
  try {
    const data = await saveTicketParticipant({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
      actorUserId: req.auth.userId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.ticket.participantSaved',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const removeTicketParticipantController = async (req, res, next) => {
  try {
    const data = await removeTicketParticipant({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
      userId: req.params.userId,
      deletedByUserId: req.auth.userId,
    });

    return res.json({
      messageKey: 'success.ticket.participantRemoved',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
