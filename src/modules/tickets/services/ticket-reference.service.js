import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import { MEMBER_STATUS } from '../../../constants/member-status.js';
import { createError } from '../../../shared/errors/createError.js';
import { Workspace } from '../../workspaces/models/workspace.model.js';
import { WorkspaceMember } from '../../workspaces/models/workspace-member.model.js';
import { Mailbox } from '../../mailboxes/models/mailbox.model.js';
import { Contact } from '../../customers/models/contact.model.js';
import { Organization } from '../../customers/models/organization.model.js';
import { User } from '../../users/models/user.model.js';
import { Conversation } from '../models/conversation.model.js';
import { TicketCategory } from '../models/ticket-category.model.js';
import { TicketTag } from '../models/ticket-tag.model.js';
import {
  normalizeObjectId,
  toObjectIdIfValid,
} from '../utils/ticket.helpers.js';
import { toValidationError } from '../utils/ticket-validation.js';

const OPERATIONAL_ASSIGNEE_ROLES = Object.freeze([
  WORKSPACE_ROLES.OWNER,
  WORKSPACE_ROLES.ADMIN,
  WORKSPACE_ROLES.AGENT,
]);

const MAILBOX_SUMMARY_PROJECTION = {
  _id: 1,
  name: 1,
  type: 1,
  emailAddress: 1,
  isDefault: 1,
  isActive: 1,
};

const CONTACT_SUMMARY_PROJECTION = {
  _id: 1,
  organizationId: 1,
  fullName: 1,
  email: 1,
  phone: 1,
};

const ORGANIZATION_SUMMARY_PROJECTION = {
  _id: 1,
  name: 1,
  domain: 1,
};

const USER_SUMMARY_PROJECTION = {
  _id: 1,
  email: 1,
  profile: 1,
  status: 1,
};

const CATEGORY_SUMMARY_PROJECTION = {
  _id: 1,
  name: 1,
  slug: 1,
  path: 1,
  isActive: 1,
};

const TAG_SUMMARY_PROJECTION = {
  _id: 1,
  name: 1,
  isActive: 1,
};

const CONVERSATION_SUMMARY_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  ticketId: 1,
  mailboxId: 1,
  channel: 1,
  lastMessageAt: 1,
  messageCount: 1,
  publicMessageCount: 1,
  internalNoteCount: 1,
  attachmentCount: 1,
  lastMessageType: 1,
  lastMessagePreview: 1,
  createdAt: 1,
  updatedAt: 1,
};

export const buildMailboxSummaryView = (mailbox) => ({
  _id: normalizeObjectId(mailbox._id),
  name: mailbox.name,
  type: mailbox.type,
  emailAddress: mailbox.emailAddress || null,
  isDefault: Boolean(mailbox.isDefault),
  isActive: Boolean(mailbox.isActive),
});

export const buildContactSummaryView = (contact) => ({
  _id: normalizeObjectId(contact._id),
  organizationId: contact.organizationId
    ? normalizeObjectId(contact.organizationId)
    : null,
  fullName: contact.fullName,
  email: contact.email || null,
  phone: contact.phone || null,
});

export const buildOrganizationSummaryView = (organization) => ({
  _id: normalizeObjectId(organization._id),
  name: organization.name,
  domain: organization.domain || null,
});

export const buildAssigneeSummaryView = ({ user, member = null }) => ({
  _id: normalizeObjectId(user._id),
  email: user.email,
  name: user?.profile?.name || null,
  avatar: user?.profile?.avatar || null,
  status: user.status || null,
  roleKey: member?.roleKey || null,
});

export const buildCategorySummaryView = (category) => ({
  _id: normalizeObjectId(category._id),
  name: category.name,
  slug: category.slug,
  path: category.path || null,
  isActive: Boolean(category.isActive),
});

export const buildTagSummaryView = (tag) => ({
  _id: normalizeObjectId(tag._id),
  name: tag.name,
  isActive: Boolean(tag.isActive),
});

export const buildConversationSummaryView = (conversation) => ({
  _id: normalizeObjectId(conversation._id),
  workspaceId: normalizeObjectId(conversation.workspaceId),
  ticketId: conversation.ticketId
    ? normalizeObjectId(conversation.ticketId)
    : null,
  mailboxId: conversation.mailboxId
    ? normalizeObjectId(conversation.mailboxId)
    : null,
  channel: conversation.channel,
  lastMessageAt: conversation.lastMessageAt || null,
  messageCount: Number(conversation.messageCount || 0),
  publicMessageCount: Number(conversation.publicMessageCount || 0),
  internalNoteCount: Number(conversation.internalNoteCount || 0),
  attachmentCount: Number(conversation.attachmentCount || 0),
  lastMessageType: conversation.lastMessageType || null,
  lastMessagePreview: conversation.lastMessagePreview || null,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
});

export const findWorkspaceForTicketWritesOrThrow = async ({
  workspaceId,
  projection = '_id defaultMailboxId',
}) => {
  const workspace = await Workspace.findOne({
    _id: workspaceId,
    deletedAt: null,
  })
    .select(projection)
    .lean();

  if (!workspace) {
    throw createError('errors.workspace.notFound', 404);
  }

  return workspace;
};

export const resolveTicketMailboxForWrite = async ({
  workspaceId,
  workspace = null,
  mailboxId = null,
}) => {
  let workspaceRecord = workspace;

  if (!workspaceRecord) {
    workspaceRecord = await findWorkspaceForTicketWritesOrThrow({
      workspaceId,
    });
  }

  const targetMailboxId = mailboxId
    ? toObjectIdIfValid(mailboxId)
    : workspaceRecord.defaultMailboxId;

  if (!targetMailboxId) {
    throw createError('errors.mailbox.notFound', 404);
  }

  const mailbox = await Mailbox.findOne({
    _id: targetMailboxId,
    workspaceId,
    deletedAt: null,
    isActive: true,
  })
    .select(MAILBOX_SUMMARY_PROJECTION)
    .lean();

  if (!mailbox) {
    throw createError('errors.mailbox.notFound', 404);
  }

  return mailbox;
};

export const resolveTicketContactForWrite = async ({
  workspaceId,
  contactId,
}) => {
  const contact = await Contact.findOne({
    _id: contactId,
    workspaceId,
    deletedAt: null,
  })
    .select(CONTACT_SUMMARY_PROJECTION)
    .lean();

  if (!contact) {
    throw createError('errors.ticket.contactNotFound', 404);
  }

  return contact;
};

export const resolveTicketOrganizationForWrite = async ({
  workspaceId,
  organizationId = null,
  contact,
}) => {
  const contactOrganizationId = contact?.organizationId
    ? toObjectIdIfValid(contact.organizationId)
    : null;
  const requestedOrganizationId = organizationId
    ? toObjectIdIfValid(organizationId)
    : null;

  if (contactOrganizationId) {
    if (
      requestedOrganizationId &&
      String(requestedOrganizationId) !== String(contactOrganizationId)
    ) {
      throw toValidationError(
        'organizationId',
        'errors.ticket.organizationMismatch'
      );
    }

    const organization = await Organization.findOne({
      _id: contactOrganizationId,
      workspaceId,
      deletedAt: null,
    })
      .select(ORGANIZATION_SUMMARY_PROJECTION)
      .lean();

    if (!organization) {
      throw createError('errors.ticket.organizationNotFound', 404);
    }

    return organization;
  }

  if (!requestedOrganizationId) {
    return null;
  }

  const organization = await Organization.findOne({
    _id: requestedOrganizationId,
    workspaceId,
    deletedAt: null,
  })
    .select(ORGANIZATION_SUMMARY_PROJECTION)
    .lean();

  if (!organization) {
    throw createError('errors.ticket.organizationNotFound', 404);
  }

  return organization;
};

export const resolveTicketAssigneeForWrite = async ({
  workspaceId,
  assigneeId = null,
}) => {
  if (!assigneeId) {
    return null;
  }

  const assigneeObjectId = toObjectIdIfValid(assigneeId);
  const member = await WorkspaceMember.findOne({
    workspaceId,
    userId: assigneeObjectId,
    deletedAt: null,
    status: MEMBER_STATUS.ACTIVE,
    roleKey: { $in: OPERATIONAL_ASSIGNEE_ROLES },
  })
    .select('userId roleKey status')
    .lean();

  if (!member) {
    throw createError('errors.ticket.assigneeNotFound', 404);
  }

  const user = await User.findOne({
    _id: assigneeObjectId,
    deletedAt: null,
    status: 'active',
  })
    .select(USER_SUMMARY_PROJECTION)
    .lean();

  if (!user) {
    throw createError('errors.ticket.assigneeNotFound', 404);
  }

  return {
    ...user,
    roleKey: member.roleKey,
  };
};

export const resolveTicketParticipantUserForWrite = async ({
  workspaceId,
  userId = null,
}) => {
  if (!userId) {
    return null;
  }

  const participantUserId = toObjectIdIfValid(userId);
  const member = await WorkspaceMember.findOne({
    workspaceId,
    userId: participantUserId,
    deletedAt: null,
    status: MEMBER_STATUS.ACTIVE,
  })
    .select('userId roleKey status')
    .lean();

  if (!member) {
    throw createError('errors.ticket.participantUserNotFound', 404);
  }

  const user = await User.findOne({
    _id: participantUserId,
    deletedAt: null,
    status: 'active',
  })
    .select(USER_SUMMARY_PROJECTION)
    .lean();

  if (!user) {
    throw createError('errors.ticket.participantUserNotFound', 404);
  }

  return {
    user,
    member,
  };
};

export const loadWorkspaceMemberUserSummaryMap = async ({
  workspaceId,
  userIds = [],
}) => {
  const safeUserIds = [
    ...new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean)),
  ];

  if (safeUserIds.length === 0) {
    return new Map();
  }

  const normalizedUserIds = safeUserIds.map((userId) =>
    toObjectIdIfValid(userId)
  );
  const [users, members] = await Promise.all([
    User.find({
      _id: { $in: normalizedUserIds },
      deletedAt: null,
    })
      .select(USER_SUMMARY_PROJECTION)
      .lean(),
    WorkspaceMember.find({
      workspaceId,
      userId: { $in: normalizedUserIds },
      deletedAt: null,
    })
      .select('userId roleKey status')
      .lean(),
  ]);

  const membersByUserId = new Map(
    members.map((member) => [String(member.userId), member])
  );

  return new Map(
    users.map((user) => [
      String(user._id),
      buildAssigneeSummaryView({
        user,
        member: membersByUserId.get(String(user._id)) || null,
      }),
    ])
  );
};

export const resolveActiveTicketCategoryForWrite = async ({
  workspaceId,
  categoryId = null,
}) => {
  if (!categoryId) {
    return null;
  }

  const category = await TicketCategory.findOne({
    _id: categoryId,
    workspaceId,
    deletedAt: null,
    isActive: true,
  })
    .select(CATEGORY_SUMMARY_PROJECTION)
    .lean();

  if (!category) {
    throw createError('errors.ticketCategory.notFound', 404);
  }

  return category;
};

export const resolveActiveTicketTagsForWrite = async ({
  workspaceId,
  tagIds = [],
}) => {
  if (!Array.isArray(tagIds) || tagIds.length === 0) {
    return [];
  }

  const normalizedTagIds = tagIds.map((tagId) => toObjectIdIfValid(tagId));
  const tags = await TicketTag.find({
    _id: { $in: normalizedTagIds },
    workspaceId,
    deletedAt: null,
    isActive: true,
  })
    .select(TAG_SUMMARY_PROJECTION)
    .lean();

  if (tags.length !== normalizedTagIds.length) {
    throw createError('errors.ticketTag.notFound', 404);
  }

  const tagsById = new Map(tags.map((tag) => [String(tag._id), tag]));

  return normalizedTagIds.map((tagId) => tagsById.get(String(tagId)));
};

export const loadTicketReferenceBundle = async ({ workspaceId, tickets }) => {
  const safeTickets = Array.isArray(tickets) ? tickets : [];
  if (safeTickets.length === 0) {
    return {
      mailboxesById: new Map(),
      contactsById: new Map(),
      organizationsById: new Map(),
      assigneesById: new Map(),
      categoriesById: new Map(),
      tagsById: new Map(),
      conversationsById: new Map(),
    };
  }

  const mailboxIds = new Set();
  const contactIds = new Set();
  const organizationIds = new Set();
  const assigneeIds = new Set();
  const categoryIds = new Set();
  const tagIds = new Set();
  const conversationIds = new Set();

  for (const ticket of safeTickets) {
    if (ticket.mailboxId) mailboxIds.add(String(ticket.mailboxId));
    if (ticket.contactId) contactIds.add(String(ticket.contactId));
    if (ticket.organizationId)
      organizationIds.add(String(ticket.organizationId));
    if (ticket.assigneeId) assigneeIds.add(String(ticket.assigneeId));
    if (ticket.categoryId) categoryIds.add(String(ticket.categoryId));
    if (ticket.conversationId) {
      conversationIds.add(String(ticket.conversationId));
    }

    for (const tagId of ticket.tagIds || []) {
      if (tagId) {
        tagIds.add(String(tagId));
      }
    }
  }

  const [
    mailboxes,
    contacts,
    organizations,
    categories,
    tags,
    conversations,
    users,
    members,
  ] = await Promise.all([
    mailboxIds.size
      ? Mailbox.find({
          _id: { $in: [...mailboxIds].map((id) => toObjectIdIfValid(id)) },
          workspaceId,
          deletedAt: null,
        })
          .select(MAILBOX_SUMMARY_PROJECTION)
          .lean()
      : [],
    contactIds.size
      ? Contact.find({
          _id: { $in: [...contactIds].map((id) => toObjectIdIfValid(id)) },
          workspaceId,
          deletedAt: null,
        })
          .select(CONTACT_SUMMARY_PROJECTION)
          .lean()
      : [],
    organizationIds.size
      ? Organization.find({
          _id: {
            $in: [...organizationIds].map((id) => toObjectIdIfValid(id)),
          },
          workspaceId,
          deletedAt: null,
        })
          .select(ORGANIZATION_SUMMARY_PROJECTION)
          .lean()
      : [],
    categoryIds.size
      ? TicketCategory.find({
          _id: { $in: [...categoryIds].map((id) => toObjectIdIfValid(id)) },
          workspaceId,
          deletedAt: null,
        })
          .select(CATEGORY_SUMMARY_PROJECTION)
          .lean()
      : [],
    tagIds.size
      ? TicketTag.find({
          _id: { $in: [...tagIds].map((id) => toObjectIdIfValid(id)) },
          workspaceId,
          deletedAt: null,
        })
          .select(TAG_SUMMARY_PROJECTION)
          .lean()
      : [],
    conversationIds.size
      ? Conversation.find({
          _id: {
            $in: [...conversationIds].map((id) => toObjectIdIfValid(id)),
          },
          workspaceId,
          deletedAt: null,
        })
          .select(CONVERSATION_SUMMARY_PROJECTION)
          .lean()
      : [],
    assigneeIds.size
      ? User.find({
          _id: { $in: [...assigneeIds].map((id) => toObjectIdIfValid(id)) },
          deletedAt: null,
        })
          .select(USER_SUMMARY_PROJECTION)
          .lean()
      : [],
    assigneeIds.size
      ? WorkspaceMember.find({
          workspaceId,
          userId: { $in: [...assigneeIds].map((id) => toObjectIdIfValid(id)) },
          deletedAt: null,
        })
          .select('userId roleKey status')
          .lean()
      : [],
  ]);

  const mailboxesById = new Map(
    mailboxes.map((mailbox) => [
      String(mailbox._id),
      buildMailboxSummaryView(mailbox),
    ])
  );
  const contactsById = new Map(
    contacts.map((contact) => [
      String(contact._id),
      buildContactSummaryView(contact),
    ])
  );
  const organizationsById = new Map(
    organizations.map((organization) => [
      String(organization._id),
      buildOrganizationSummaryView(organization),
    ])
  );
  const membersByUserId = new Map(
    members.map((member) => [String(member.userId), member])
  );
  const assigneesById = new Map(
    users.map((user) => [
      String(user._id),
      buildAssigneeSummaryView({
        user,
        member: membersByUserId.get(String(user._id)) || null,
      }),
    ])
  );
  const categoriesById = new Map(
    categories.map((category) => [
      String(category._id),
      buildCategorySummaryView(category),
    ])
  );
  const tagsById = new Map(
    tags.map((tag) => [String(tag._id), buildTagSummaryView(tag)])
  );
  const conversationsById = new Map(
    conversations.map((conversation) => [
      String(conversation._id),
      buildConversationSummaryView(conversation),
    ])
  );

  return {
    mailboxesById,
    contactsById,
    organizationsById,
    assigneesById,
    categoriesById,
    tagsById,
    conversationsById,
  };
};
