import { Router } from 'express';
import validate from '../../../shared/middlewares/validate.js';
import requireAuth from '../../../shared/middlewares/requireAuth.js';
import requireActiveUser from '../../../shared/middlewares/requireActiveUser.js';
import requireActiveMember from '../../../shared/middlewares/requireActiveMember.js';
import requireWorkspaceRole from '../../../shared/middlewares/requireWorkspaceRole.js';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import {
  activateTicketCategoryController,
  createTicketCategoryController,
  deactivateTicketCategoryController,
  getTicketCategoryController,
  listTicketCategoriesController,
  listTicketCategoryOptionsController,
  updateTicketCategoryController,
} from '../controllers/ticket-categories.controller.js';
import {
  activateTicketTagController,
  createTicketTagController,
  deactivateTicketTagController,
  getTicketTagController,
  listTicketTagOptionsController,
  listTicketTagsController,
  updateTicketTagController,
} from '../controllers/ticket-tags.controller.js';
import {
  createTicketMessageController,
  getTicketConversationController,
  listTicketMessagesController,
} from '../controllers/ticket-messages.controller.js';
import {
  listTicketParticipantsController,
  removeTicketParticipantController,
  saveTicketParticipantController,
} from '../controllers/ticket-participants.controller.js';
import {
  assignTicketController,
  closeTicketController,
  createTicketController,
  getTicketController,
  listTicketsController,
  reopenTicketController,
  selfAssignTicketController,
  solveTicketController,
  unassignTicketController,
  updateTicketStatusController,
  updateTicketController,
} from '../controllers/tickets.controller.js';
import {
  createTicketMessageValidator,
  listTicketMessagesValidator,
  ticketConversationByTicketIdValidator,
} from '../validators/ticket-messages.validators.js';
import {
  listTicketParticipantsValidator,
  removeTicketParticipantValidator,
  saveTicketParticipantValidator,
} from '../validators/ticket-participants.validators.js';
import {
  createTicketCategoryValidator,
  listTicketCategoriesValidator,
  ticketCategoryActionByIdValidator,
  ticketCategoryByIdValidator,
  ticketCategoryOptionsValidator,
  updateTicketCategoryBodyValidation,
  updateTicketCategoryValidator,
} from '../validators/ticket-categories.validators.js';
import {
  createTicketTagValidator,
  listTicketTagsValidator,
  ticketTagActionByIdValidator,
  ticketTagByIdValidator,
  ticketTagOptionsValidator,
  updateTicketTagBodyValidation,
  updateTicketTagValidator,
} from '../validators/ticket-tags.validators.js';
import {
  assignTicketValidator,
  createTicketValidator,
  listTicketsValidator,
  ticketActionByIdValidator,
  ticketByIdValidator,
  updateTicketStatusValidator,
  updateTicketBodyValidation,
  updateTicketValidator,
} from '../validators/tickets.validators.js';

const router = Router();

router.use(requireAuth, requireActiveUser, requireActiveMember);

router.get(
  '/categories',
  validate(listTicketCategoriesValidator),
  listTicketCategoriesController
);
router.get(
  '/categories/options',
  validate(ticketCategoryOptionsValidator),
  listTicketCategoryOptionsController
);
router.get(
  '/categories/:id',
  validate(ticketCategoryByIdValidator),
  getTicketCategoryController
);
router.post(
  '/categories',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(createTicketCategoryValidator),
  createTicketCategoryController
);
router.patch(
  '/categories/:id',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate([
    ...updateTicketCategoryValidator,
    updateTicketCategoryBodyValidation,
  ]),
  updateTicketCategoryController
);
router.post(
  '/categories/:id/activate',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(ticketCategoryActionByIdValidator),
  activateTicketCategoryController
);
router.post(
  '/categories/:id/deactivate',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(ticketCategoryActionByIdValidator),
  deactivateTicketCategoryController
);

router.get(
  '/tags',
  validate(listTicketTagsValidator),
  listTicketTagsController
);
router.get(
  '/tags/options',
  validate(ticketTagOptionsValidator),
  listTicketTagOptionsController
);
router.get(
  '/tags/:id',
  validate(ticketTagByIdValidator),
  getTicketTagController
);
router.post(
  '/tags',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(createTicketTagValidator),
  createTicketTagController
);
router.patch(
  '/tags/:id',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate([...updateTicketTagValidator, updateTicketTagBodyValidation]),
  updateTicketTagController
);
router.post(
  '/tags/:id/activate',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(ticketTagActionByIdValidator),
  activateTicketTagController
);
router.post(
  '/tags/:id/deactivate',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(ticketTagActionByIdValidator),
  deactivateTicketTagController
);

router.post(
  '/',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate(createTicketValidator),
  createTicketController
);
router.get('/', validate(listTicketsValidator), listTicketsController);
router.post(
  '/:id/assign',
  requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN),
  validate(assignTicketValidator),
  assignTicketController
);
router.post(
  '/:id/unassign',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate(ticketActionByIdValidator),
  unassignTicketController
);
router.post(
  '/:id/self-assign',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate(ticketActionByIdValidator),
  selfAssignTicketController
);
router.post(
  '/:id/status',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate(updateTicketStatusValidator),
  updateTicketStatusController
);
router.post(
  '/:id/solve',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate(ticketActionByIdValidator),
  solveTicketController
);
router.post(
  '/:id/close',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate(ticketActionByIdValidator),
  closeTicketController
);
router.post(
  '/:id/reopen',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate(ticketActionByIdValidator),
  reopenTicketController
);
router.get(
  '/:id/conversation',
  validate(ticketConversationByTicketIdValidator),
  getTicketConversationController
);
router.get(
  '/:id/messages',
  validate(listTicketMessagesValidator),
  listTicketMessagesController
);
router.post(
  '/:id/messages',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate(createTicketMessageValidator),
  createTicketMessageController
);
router.get(
  '/:id/participants',
  validate(listTicketParticipantsValidator),
  listTicketParticipantsController
);
router.post(
  '/:id/participants',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate(saveTicketParticipantValidator),
  saveTicketParticipantController
);
router.delete(
  '/:id/participants/:userId',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate(removeTicketParticipantValidator),
  removeTicketParticipantController
);
router.get('/:id', validate(ticketByIdValidator), getTicketController);
router.patch(
  '/:id',
  requireWorkspaceRole(
    WORKSPACE_ROLES.OWNER,
    WORKSPACE_ROLES.ADMIN,
    WORKSPACE_ROLES.AGENT
  ),
  validate([...updateTicketValidator, updateTicketBodyValidation]),
  updateTicketController
);

export default router;
