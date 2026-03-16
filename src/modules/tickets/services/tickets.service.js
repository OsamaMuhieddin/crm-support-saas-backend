import { TICKET_STATUS } from '../../../constants/ticket-status.js'
import { TICKET_PRIORITY } from '../../../constants/ticket-priority.js'
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js'
import { createError } from '../../../shared/errors/createError.js'
import { buildPagination } from '../../../shared/utils/pagination.js'
import { escapeRegex } from '../../../shared/utils/regex.js'
import { normalizeSubject } from '../../../shared/utils/normalize.js'
import { Conversation } from '../models/conversation.model.js'
import { TicketCounter } from '../models/ticket-counter.model.js'
import { Ticket } from '../models/ticket.model.js'
import {
  findWorkspaceForTicketWritesOrThrow,
  loadTicketReferenceBundle,
  resolveActiveTicketCategoryForWrite,
  resolveActiveTicketTagsForWrite,
  resolveTicketAssigneeForWrite,
  resolveTicketContactForWrite,
  resolveTicketMailboxForWrite,
  resolveTicketOrganizationForWrite
} from './ticket-reference.service.js'
import { findTicketInWorkspaceOrThrow } from './ticket-query.service.js'
import {
  buildTicketStatusI18nArg,
  normalizeObjectId,
  normalizeNullableString,
  parseNullableBoolean,
  toObjectIdIfValid
} from '../utils/ticket.helpers.js'
import { createTicketMessage } from './ticket-messages.service.js'

const SORT_ALLOWLIST = Object.freeze({
  number: { number: 1, _id: 1 },
  '-number': { number: -1, _id: 1 },
  subject: { subjectNormalized: 1, _id: 1 },
  '-subject': { subjectNormalized: -1, _id: 1 },
  priority: { priority: 1, _id: 1 },
  '-priority': { priority: -1, _id: 1 },
  createdAt: { createdAt: 1, _id: 1 },
  '-createdAt': { createdAt: -1, _id: 1 },
  updatedAt: { updatedAt: 1, _id: 1 },
  '-updatedAt': { updatedAt: -1, _id: 1 },
  lastMessageAt: { lastMessageAt: 1, _id: 1 },
  '-lastMessageAt': { lastMessageAt: -1, _id: 1 }
})

const DEFAULT_LIST_SORT = {
  updatedAt: -1,
  _id: 1
}

const ELEVATED_WORKSPACE_ROLES = new Set([
  WORKSPACE_ROLES.OWNER,
  WORKSPACE_ROLES.ADMIN
])

const EXPLICIT_STATUS_TRANSITIONS = Object.freeze({
  [TICKET_STATUS.NEW]: new Set([
    TICKET_STATUS.OPEN,
    TICKET_STATUS.PENDING,
    TICKET_STATUS.WAITING_ON_CUSTOMER,
    TICKET_STATUS.SOLVED
  ]),
  [TICKET_STATUS.OPEN]: new Set([
    TICKET_STATUS.PENDING,
    TICKET_STATUS.WAITING_ON_CUSTOMER,
    TICKET_STATUS.SOLVED
  ]),
  [TICKET_STATUS.PENDING]: new Set([
    TICKET_STATUS.OPEN,
    TICKET_STATUS.WAITING_ON_CUSTOMER,
    TICKET_STATUS.SOLVED
  ]),
  [TICKET_STATUS.WAITING_ON_CUSTOMER]: new Set([
    TICKET_STATUS.OPEN,
    TICKET_STATUS.PENDING,
    TICKET_STATUS.SOLVED
  ]),
  [TICKET_STATUS.SOLVED]: new Set([TICKET_STATUS.OPEN]),
  [TICKET_STATUS.CLOSED]: new Set()
})

const TICKET_BASE_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  mailboxId: 1,
  number: 1,
  subject: 1,
  status: 1,
  priority: 1,
  channel: 1,
  categoryId: 1,
  tagIds: 1,
  contactId: 1,
  organizationId: 1,
  assigneeId: 1,
  createdByUserId: 1,
  conversationId: 1,
  messageCount: 1,
  publicMessageCount: 1,
  internalNoteCount: 1,
  attachmentCount: 1,
  participantCount: 1,
  lastMessageAt: 1,
  lastCustomerMessageAt: 1,
  lastPublicReplyAt: 1,
  lastInternalNoteAt: 1,
  lastMessageType: 1,
  lastMessagePreview: 1,
  statusChangedAt: 1,
  assignedAt: 1,
  closedAt: 1,
  sla: 1,
  createdAt: 1,
  updatedAt: 1
}

const isElevatedWorkspaceRole = (roleKey) =>
  ELEVATED_WORKSPACE_ROLES.has(String(roleKey || '').toLowerCase())

const ensureTicketSlaObject = (ticket) => {
  if (!ticket.sla || typeof ticket.sla !== 'object') {
    ticket.sla = {}
  }

  return ticket.sla
}

const maybeMoveAssignedNewTicketToOpen = (ticket) => {
  if (ticket.status !== TICKET_STATUS.NEW) {
    return false
  }

  ticket.status = TICKET_STATUS.OPEN
  return true
}

const applyResolvedMarkerForStatusChange = ({
  ticket,
  currentStatus,
  nextStatus
}) => {
  const sla = ensureTicketSlaObject(ticket)

  if (nextStatus === TICKET_STATUS.SOLVED) {
    if (!sla.resolvedAt || currentStatus !== TICKET_STATUS.SOLVED) {
      sla.resolvedAt = new Date()
    }

    return
  }

  if (
    (currentStatus === TICKET_STATUS.SOLVED ||
      currentStatus === TICKET_STATUS.CLOSED) &&
    nextStatus !== TICKET_STATUS.CLOSED
  ) {
    sla.resolvedAt = null
  }
}

const assertExplicitStatusTransitionAllowed = ({
  currentStatus,
  nextStatus,
  errorMessageKey = 'errors.ticket.invalidStatusTransition'
}) => {
  if (currentStatus === nextStatus) {
    return
  }

  const allowedStatuses = EXPLICIT_STATUS_TRANSITIONS[currentStatus]

  if (!allowedStatuses || !allowedStatuses.has(nextStatus)) {
    throw createError(errorMessageKey, 409, null, {
      from: buildTicketStatusI18nArg(currentStatus),
      to: buildTicketStatusI18nArg(nextStatus)
    })
  }
}

const buildTicketSlaView = (sla = {}) => ({
  policyId: sla?.policyId ? normalizeObjectId(sla.policyId) : null,
  firstResponseDueAt: sla?.firstResponseDueAt || null,
  nextResponseDueAt: sla?.nextResponseDueAt || null,
  resolutionDueAt: sla?.resolutionDueAt || null,
  firstResponseAt: sla?.firstResponseAt || null,
  resolvedAt: sla?.resolvedAt || null,
  isFirstResponseBreached: Boolean(sla?.isFirstResponseBreached),
  isResolutionBreached: Boolean(sla?.isResolutionBreached)
})

const buildTicketAssignmentActionView = (ticket) => ({
  _id: normalizeObjectId(ticket._id),
  assigneeId: ticket.assigneeId ? normalizeObjectId(ticket.assigneeId) : null,
  assignedAt: ticket.assignedAt || null,
  status: ticket.status
})

const buildTicketStatusActionView = (ticket) => ({
  _id: normalizeObjectId(ticket._id),
  status: ticket.status,
  statusChangedAt: ticket.statusChangedAt || null
})

const buildTicketSolveActionView = (ticket) => ({
  ...buildTicketStatusActionView(ticket),
  sla: {
    resolvedAt: ticket?.sla?.resolvedAt || null
  }
})

const buildTicketCloseActionView = (ticket) => ({
  ...buildTicketStatusActionView(ticket),
  closedAt: ticket.closedAt || null,
  sla: {
    resolvedAt: ticket?.sla?.resolvedAt || null
  }
})

const buildTicketReopenActionView = (ticket) => ({
  ...buildTicketCloseActionView(ticket),
  sla: {
    resolvedAt: ticket?.sla?.resolvedAt || null
  }
})

const buildTicketView = ({ ticket, references }) => {
  const referenceMaps = references || {}
  const category = ticket.categoryId
    ? referenceMaps.categoriesById?.get(String(ticket.categoryId)) || null
    : null
  const tags = (ticket.tagIds || [])
    .map((tagId) => referenceMaps.tagsById?.get(String(tagId)) || null)
    .filter(Boolean)
  const conversation = ticket.conversationId
    ? referenceMaps.conversationsById?.get(String(ticket.conversationId)) || null
    : null

  return {
    _id: normalizeObjectId(ticket._id),
    workspaceId: normalizeObjectId(ticket.workspaceId),
    mailboxId: normalizeObjectId(ticket.mailboxId),
    number: Number(ticket.number),
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    channel: ticket.channel,
    categoryId: ticket.categoryId ? normalizeObjectId(ticket.categoryId) : null,
    tagIds: (ticket.tagIds || []).map((tagId) => normalizeObjectId(tagId)),
    contactId: normalizeObjectId(ticket.contactId),
    organizationId: ticket.organizationId
      ? normalizeObjectId(ticket.organizationId)
      : null,
    assigneeId: ticket.assigneeId ? normalizeObjectId(ticket.assigneeId) : null,
    createdByUserId: ticket.createdByUserId
      ? normalizeObjectId(ticket.createdByUserId)
      : null,
    conversationId: ticket.conversationId
      ? normalizeObjectId(ticket.conversationId)
      : null,
    messageCount: Number(ticket.messageCount || 0),
    publicMessageCount: Number(ticket.publicMessageCount || 0),
    internalNoteCount: Number(ticket.internalNoteCount || 0),
    attachmentCount: Number(ticket.attachmentCount || 0),
    participantCount: Number(ticket.participantCount || 0),
    lastMessageAt: ticket.lastMessageAt || null,
    lastCustomerMessageAt: ticket.lastCustomerMessageAt || null,
    lastPublicReplyAt: ticket.lastPublicReplyAt || null,
    lastInternalNoteAt: ticket.lastInternalNoteAt || null,
    lastMessageType: ticket.lastMessageType || null,
    lastMessagePreview: ticket.lastMessagePreview || null,
    statusChangedAt: ticket.statusChangedAt || null,
    assignedAt: ticket.assignedAt || null,
    closedAt: ticket.closedAt || null,
    sla: buildTicketSlaView(ticket.sla),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    mailbox: referenceMaps.mailboxesById?.get(String(ticket.mailboxId)) || null,
    contact: referenceMaps.contactsById?.get(String(ticket.contactId)) || null,
    organization: ticket.organizationId
      ? referenceMaps.organizationsById?.get(String(ticket.organizationId)) || null
      : null,
    assignee: ticket.assigneeId
      ? referenceMaps.assigneesById?.get(String(ticket.assigneeId)) || null
      : null,
    category,
    tags,
    conversation
  }
}

const normalizeCreatePayload = (payload = {}) => ({
  subject: String(payload.subject || '').trim(),
  mailboxId: normalizeNullableString(payload.mailboxId),
  contactId: normalizeNullableString(payload.contactId),
  organizationId: normalizeNullableString(payload.organizationId),
  priority: payload.priority || TICKET_PRIORITY.NORMAL,
  categoryId: normalizeNullableString(payload.categoryId),
  tagIds: Array.isArray(payload.tagIds)
    ? payload.tagIds.map((tagId) => normalizeNullableString(tagId)).filter(Boolean)
    : [],
  assigneeId: normalizeNullableString(payload.assigneeId),
  initialMessage: payload.initialMessage || null
})

const normalizeUpdatePayload = (payload = {}) => {
  const normalized = {}

  if (Object.prototype.hasOwnProperty.call(payload, 'subject')) {
    normalized.subject = String(payload.subject || '').trim()
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'priority')) {
    normalized.priority = payload.priority
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'categoryId')) {
    normalized.categoryId = normalizeNullableString(payload.categoryId)
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'tagIds')) {
    normalized.tagIds = Array.isArray(payload.tagIds)
      ? payload.tagIds.map((tagId) => normalizeNullableString(tagId)).filter(Boolean)
      : []
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'mailboxId')) {
    normalized.mailboxId = normalizeNullableString(payload.mailboxId)
  }

  return normalized
}

const normalizeInitialMessagePayload = (payload = null) => {
  if (!payload) {
    return null
  }

  return {
    type: payload.type,
    bodyText: String(payload.bodyText || '').trim(),
    bodyHtml: normalizeNullableString(payload.bodyHtml),
    attachmentFileIds: Array.isArray(payload.attachmentFileIds)
      ? payload.attachmentFileIds
          .map((fileId) => normalizeNullableString(fileId))
          .filter(Boolean)
      : []
  }
}

const buildSearchClause = (q) => {
  const normalized = normalizeSubject(q)
  if (!normalized) {
    return null
  }

  const escaped = escapeRegex(normalized)
  const clauses = [
    {
      subjectNormalized: {
        $regex: escaped,
        $options: 'i'
      }
    }
  ]

  if (/^\d+$/.test(normalized)) {
    clauses.push({ number: Number(normalized) })
  }

  return { $or: clauses }
}

const buildSort = (sort) => SORT_ALLOWLIST[sort] || DEFAULT_LIST_SORT

const buildDateRange = ({ from, to }) => {
  const range = {}

  if (from) {
    range.$gte = new Date(from)
  }

  if (to) {
    range.$lte = new Date(to)
  }

  return Object.keys(range).length > 0 ? range : null
}

const normalizeStatusFilter = (status) => {
  if (status === undefined || status === null) {
    return []
  }

  const values = Array.isArray(status) ? status : [status]

  return [
    ...new Set(
      values
        .flatMap((value) => String(value || '').split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ]
}

const buildTicketListQuery = ({
  workspaceId,
  status = null,
  priority = null,
  mailboxId = null,
  assigneeId = null,
  unassigned = null,
  categoryId = null,
  tagId = null,
  contactId = null,
  organizationId = null,
  channel = null,
  includeClosed = null,
  search = null,
  createdFrom = null,
  createdTo = null,
  updatedFrom = null,
  updatedTo = null
}) => {
  const query = {
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null
  }
  const normalizedStatuses = normalizeStatusFilter(status)

  if (normalizedStatuses.length === 1) {
    query.status = normalizedStatuses[0]
  } else if (normalizedStatuses.length > 1) {
    query.status = { $in: normalizedStatuses }
  } else if (parseNullableBoolean(includeClosed) !== true) {
    query.status = { $ne: TICKET_STATUS.CLOSED }
  }

  if (priority) {
    query.priority = priority
  }

  if (mailboxId) {
    query.mailboxId = toObjectIdIfValid(mailboxId)
  }

  if (assigneeId) {
    query.assigneeId = toObjectIdIfValid(assigneeId)
  }

  const parsedUnassigned = parseNullableBoolean(unassigned)

  if (parsedUnassigned === true) {
    query.assigneeId = null
  } else if (parsedUnassigned === false && !assigneeId) {
    query.assigneeId = { $ne: null }
  }

  if (categoryId) {
    query.categoryId = toObjectIdIfValid(categoryId)
  }

  if (tagId) {
    query.tagIds = toObjectIdIfValid(tagId)
  }

  if (contactId) {
    query.contactId = toObjectIdIfValid(contactId)
  }

  if (organizationId) {
    query.organizationId = toObjectIdIfValid(organizationId)
  }

  if (channel) {
    query.channel = channel
  }

  const createdAtRange = buildDateRange({
    from: createdFrom,
    to: createdTo
  })
  if (createdAtRange) {
    query.createdAt = createdAtRange
  }

  const updatedAtRange = buildDateRange({
    from: updatedFrom,
    to: updatedTo
  })
  if (updatedAtRange) {
    query.updatedAt = updatedAtRange
  }

  const searchClause = buildSearchClause(search)
  if (searchClause) {
    Object.assign(query, searchClause)
  }

  return query
}

const syncConversationMailboxForTicketOrThrow = async ({
  workspaceId,
  ticket,
  mailboxId
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId)
  const conversationQuery = {
    workspaceId: workspaceObjectId,
    ticketId: toObjectIdIfValid(ticket._id),
    deletedAt: null
  }

  if (ticket.conversationId) {
    conversationQuery._id = toObjectIdIfValid(ticket.conversationId)
  }

  const conversation = await Conversation.findOne(conversationQuery)
    .select('_id mailboxId')
    .lean()

  if (!conversation) {
    throw createError('errors.ticket.conversationInvariantFailed', 500)
  }

  const updateResult = await Conversation.updateOne(
    {
      _id: conversation._id,
      workspaceId: workspaceObjectId,
      ticketId: toObjectIdIfValid(ticket._id),
      deletedAt: null
    },
    {
      $set: {
        mailboxId
      }
    }
  )

  if (Number(updateResult.matchedCount || 0) !== 1) {
    throw createError('errors.ticket.conversationInvariantFailed', 500)
  }

  return conversation
}

export const createTicket = async ({
  workspaceId,
  createdByUserId = null,
  payload
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId)
  const normalized = normalizeCreatePayload(payload)
  const workspace = await findWorkspaceForTicketWritesOrThrow({
    workspaceId: workspaceObjectId
  })
  const mailbox = await resolveTicketMailboxForWrite({
    workspaceId: workspaceObjectId,
    workspace,
    mailboxId: normalized.mailboxId
  })
  const contact = await resolveTicketContactForWrite({
    workspaceId: workspaceObjectId,
    contactId: normalized.contactId
  })
  const organization = await resolveTicketOrganizationForWrite({
    workspaceId: workspaceObjectId,
    organizationId: normalized.organizationId,
    contact
  })
  const assignee = await resolveTicketAssigneeForWrite({
    workspaceId: workspaceObjectId,
    assigneeId: normalized.assigneeId
  })
  const category = await resolveActiveTicketCategoryForWrite({
    workspaceId: workspaceObjectId,
    categoryId: normalized.categoryId
  })
  const tags = await resolveActiveTicketTagsForWrite({
    workspaceId: workspaceObjectId,
    tagIds: normalized.tagIds
  })
  const initialMessage = normalizeInitialMessagePayload(normalized.initialMessage)

  const number = await TicketCounter.allocateNextNumber(workspaceObjectId)

  let ticket = null
  let conversation = null

  try {
    ticket = await Ticket.create({
      workspaceId: workspaceObjectId,
      mailboxId: mailbox._id,
      number,
      subject: normalized.subject,
      status: assignee?._id ? TICKET_STATUS.OPEN : TICKET_STATUS.NEW,
      priority: normalized.priority,
      categoryId: category?._id || null,
      tagIds: tags.map((tag) => tag._id),
      contactId: contact._id,
      organizationId: organization?._id || null,
      assigneeId: assignee?._id || null,
      createdByUserId: createdByUserId ? toObjectIdIfValid(createdByUserId) : null
    })

    conversation = await Conversation.create({
      workspaceId: workspaceObjectId,
      ticketId: ticket._id,
      mailboxId: mailbox._id,
      channel: ticket.channel
    })

    ticket.conversationId = conversation._id
    await ticket.save()

    if (initialMessage) {
      await createTicketMessage({
        workspaceId: workspaceObjectId,
        ticketId: ticket._id,
        createdByUserId,
        payload: initialMessage
      })
    }
  } catch (error) {
    await Promise.allSettled([
      conversation?._id ? Conversation.deleteOne({ _id: conversation._id }) : null,
      ticket?._id ? Ticket.deleteOne({ _id: ticket._id }) : null
    ].filter(Boolean))

    throw error
  }

  return getTicketById({
    workspaceId: workspaceObjectId,
    ticketId: ticket._id
  })
}

export const listTickets = async ({
  workspaceId,
  page = 1,
  limit = 20,
  q = null,
  search = null,
  status = null,
  priority = null,
  mailboxId = null,
  assigneeId = null,
  unassigned = null,
  categoryId = null,
  tagId = null,
  contactId = null,
  organizationId = null,
  channel = null,
  includeClosed = null,
  createdFrom = null,
  createdTo = null,
  updatedFrom = null,
  updatedTo = null,
  sort = null
}) => {
  const safePage = Math.max(1, Number(page) || 1)
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20))
  const skip = (safePage - 1) * safeLimit
  const query = buildTicketListQuery({
    workspaceId,
    status,
    priority,
    mailboxId,
    assigneeId,
    unassigned,
    categoryId,
    tagId,
    contactId,
    organizationId,
    channel,
    includeClosed,
    search: q || search,
    createdFrom,
    createdTo,
    updatedFrom,
    updatedTo
  })
  const sortQuery = buildSort(String(sort || '').trim())

  const [total, tickets] = await Promise.all([
    Ticket.countDocuments(query),
    Ticket.find(query)
      .sort(sortQuery)
      .skip(skip)
      .limit(safeLimit)
      .select(TICKET_BASE_PROJECTION)
      .lean()
  ])
  const references = await loadTicketReferenceBundle({
    workspaceId: toObjectIdIfValid(workspaceId),
    tickets
  })

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: tickets.length
    }),
    tickets: tickets.map((ticket) =>
      buildTicketView({
        ticket,
        references
      })
    )
  }
}

export const getTicketById = async ({ workspaceId, ticketId }) => {
  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: toObjectIdIfValid(workspaceId),
    ticketId: toObjectIdIfValid(ticketId),
    lean: true,
    projection: TICKET_BASE_PROJECTION
  })
  const references = await loadTicketReferenceBundle({
    workspaceId: toObjectIdIfValid(workspaceId),
    tickets: [ticket]
  })

  return {
    ticket: buildTicketView({
      ticket,
      references
    })
  }
}

export const updateTicket = async ({ workspaceId, ticketId, payload }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId)
  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: toObjectIdIfValid(ticketId),
    lean: false,
    projection: TICKET_BASE_PROJECTION
  })
  const normalized = normalizeUpdatePayload(payload)

  if (Object.prototype.hasOwnProperty.call(normalized, 'subject')) {
    ticket.subject = normalized.subject
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'priority')) {
    ticket.priority = normalized.priority
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'categoryId')) {
    const category = await resolveActiveTicketCategoryForWrite({
      workspaceId: workspaceObjectId,
      categoryId: normalized.categoryId
    })
    ticket.categoryId = category?._id || null
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'tagIds')) {
    const tags = await resolveActiveTicketTagsForWrite({
      workspaceId: workspaceObjectId,
      tagIds: normalized.tagIds
    })
    ticket.tagIds = tags.map((tag) => tag._id)
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'mailboxId')) {
    const nextMailboxId = toObjectIdIfValid(normalized.mailboxId)
    const currentMailboxId = ticket.mailboxId
      ? String(ticket.mailboxId)
      : null

    if (String(nextMailboxId) !== currentMailboxId && Number(ticket.messageCount || 0) > 0) {
      throw createError('errors.ticket.mailboxChangeNotAllowed', 409, null, {
        messageCount: Number(ticket.messageCount || 0)
      })
    }

    if (String(nextMailboxId) !== currentMailboxId) {
      const mailbox = await resolveTicketMailboxForWrite({
        workspaceId: workspaceObjectId,
        mailboxId: normalized.mailboxId
      })
      const previousMailboxId = ticket.mailboxId
      const conversation = await syncConversationMailboxForTicketOrThrow({
        workspaceId: workspaceObjectId,
        ticket,
        mailboxId: mailbox._id
      })

      ticket.mailboxId = mailbox._id

      if (!ticket.conversationId) {
        ticket.conversationId = conversation._id
      }

      try {
        await ticket.save()
      } catch (error) {
        await Promise.allSettled([
          Conversation.updateOne(
            {
              _id: conversation._id,
              workspaceId: workspaceObjectId,
              ticketId: toObjectIdIfValid(ticket._id),
              deletedAt: null
            },
            {
              $set: {
                mailboxId: previousMailboxId
              }
            }
          )
        ])

        throw error
      }

      return getTicketById({
        workspaceId: workspaceObjectId,
        ticketId: ticket._id
      })
    }
  }

  await ticket.save()

  return getTicketById({
    workspaceId: workspaceObjectId,
    ticketId: ticket._id
  })
}

export const assignTicket = async ({
  workspaceId,
  ticketId,
  currentUserId,
  currentRoleKey,
  assigneeId
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId)
  const currentUserObjectId = toObjectIdIfValid(currentUserId)
  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: toObjectIdIfValid(ticketId),
    lean: false,
    projection: TICKET_BASE_PROJECTION
  })
  const assignee = await resolveTicketAssigneeForWrite({
    workspaceId: workspaceObjectId,
    assigneeId
  })

  if (
    !isElevatedWorkspaceRole(currentRoleKey) &&
    String(assignee._id) !== String(currentUserObjectId)
  ) {
    throw createError('errors.ticket.assignOthersNotAllowed', 403)
  }

  if (
    !isElevatedWorkspaceRole(currentRoleKey) &&
    ticket.assigneeId &&
    String(ticket.assigneeId) !== String(currentUserObjectId)
  ) {
    throw createError('errors.ticket.selfAssignNotAvailable', 409)
  }

  const nextAssigneeId = toObjectIdIfValid(assignee._id)
  const currentAssigneeId = ticket.assigneeId ? String(ticket.assigneeId) : null
  let shouldSave = false

  if (currentAssigneeId !== String(nextAssigneeId)) {
    ticket.assigneeId = nextAssigneeId
    shouldSave = true
  }

  if (maybeMoveAssignedNewTicketToOpen(ticket)) {
    shouldSave = true
  }

  if (shouldSave) {
    await ticket.save()
  }

  return {
    ticket: buildTicketAssignmentActionView(ticket)
  }
}

export const unassignTicket = async ({
  workspaceId,
  ticketId,
  currentUserId,
  currentRoleKey
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId)
  const currentUserObjectId = toObjectIdIfValid(currentUserId)
  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: toObjectIdIfValid(ticketId),
    lean: false,
    projection: TICKET_BASE_PROJECTION
  })
  const isElevated = isElevatedWorkspaceRole(currentRoleKey)

  if (
    !isElevated &&
    ticket.assigneeId &&
    String(ticket.assigneeId) !== String(currentUserObjectId)
  ) {
    throw createError('errors.ticket.unassignNotAllowed', 403)
  }

  if (!ticket.assigneeId) {
    return {
      ticket: buildTicketAssignmentActionView(ticket)
    }
  }

  ticket.assigneeId = null
  await ticket.save()

  return {
    ticket: buildTicketAssignmentActionView(ticket)
  }
}

export const selfAssignTicket = async ({
  workspaceId,
  ticketId,
  currentUserId
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId)
  const currentUserObjectId = toObjectIdIfValid(currentUserId)
  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: toObjectIdIfValid(ticketId),
    lean: false,
    projection: TICKET_BASE_PROJECTION
  })
  const currentUserAssignee = await resolveTicketAssigneeForWrite({
    workspaceId: workspaceObjectId,
    assigneeId: currentUserObjectId
  })

  if (
    ticket.assigneeId &&
    String(ticket.assigneeId) !== String(currentUserObjectId)
  ) {
    throw createError('errors.ticket.selfAssignNotAvailable', 409)
  }

  let shouldSave = false

  if (!ticket.assigneeId) {
    ticket.assigneeId = toObjectIdIfValid(currentUserAssignee._id)
    shouldSave = true
  }

  if (maybeMoveAssignedNewTicketToOpen(ticket)) {
    shouldSave = true
  }

  if (shouldSave) {
    await ticket.save()
  }

  return {
    ticket: buildTicketAssignmentActionView(ticket)
  }
}

const updateTicketStatusInternal = async ({
  workspaceId,
  ticketId,
  nextStatus,
  errorMessageKey,
  buildResponse = buildTicketStatusActionView
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId)
  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: toObjectIdIfValid(ticketId),
    lean: false,
    projection: TICKET_BASE_PROJECTION
  })
  const currentStatus = ticket.status

  assertExplicitStatusTransitionAllowed({
    currentStatus,
    nextStatus,
    errorMessageKey
  })

  if (currentStatus !== nextStatus) {
    applyResolvedMarkerForStatusChange({
      ticket,
      currentStatus,
      nextStatus
    })
    ticket.status = nextStatus
    await ticket.save()
  }

  return {
    ticket: buildResponse(ticket)
  }
}

export const updateTicketStatus = async ({
  workspaceId,
  ticketId,
  status
}) =>
  updateTicketStatusInternal({
    workspaceId,
    ticketId,
    nextStatus: status,
    errorMessageKey: 'errors.ticket.invalidStatusTransition'
  })

export const solveTicket = async ({ workspaceId, ticketId }) =>
  updateTicketStatusInternal({
    workspaceId,
    ticketId,
    nextStatus: TICKET_STATUS.SOLVED,
    errorMessageKey: 'errors.ticket.solveNotAllowed',
    buildResponse: buildTicketSolveActionView
  })

export const closeTicket = async ({ workspaceId, ticketId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId)
  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: toObjectIdIfValid(ticketId),
    lean: false,
    projection: TICKET_BASE_PROJECTION
  })

  if (ticket.status !== TICKET_STATUS.SOLVED && ticket.status !== TICKET_STATUS.CLOSED) {
    throw createError('errors.ticket.closeNotAllowed', 409, null, {
      from: buildTicketStatusI18nArg(ticket.status),
      requiredFrom: buildTicketStatusI18nArg(TICKET_STATUS.SOLVED)
    })
  }

  if (ticket.status !== TICKET_STATUS.CLOSED) {
    ticket.status = TICKET_STATUS.CLOSED
    await ticket.save()
  }

  return {
    ticket: buildTicketCloseActionView(ticket)
  }
}

export const reopenTicket = async ({ workspaceId, ticketId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId)
  const ticket = await findTicketInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    ticketId: toObjectIdIfValid(ticketId),
    lean: false
  })

  if (
    ticket.status !== TICKET_STATUS.SOLVED &&
    ticket.status !== TICKET_STATUS.CLOSED
  ) {
    throw createError('errors.ticket.reopenNotAllowed', 409, null, {
      from: buildTicketStatusI18nArg(ticket.status),
      allowedFromOne: buildTicketStatusI18nArg(TICKET_STATUS.SOLVED),
      allowedFromTwo: buildTicketStatusI18nArg(TICKET_STATUS.CLOSED)
    })
  }

  if (ticket.status !== TICKET_STATUS.OPEN) {
    applyResolvedMarkerForStatusChange({
      ticket,
      currentStatus: ticket.status,
      nextStatus: TICKET_STATUS.OPEN
    })
    ticket.status = TICKET_STATUS.OPEN
    await ticket.save()
  }

  return {
    ticket: buildTicketReopenActionView(ticket)
  }
}
