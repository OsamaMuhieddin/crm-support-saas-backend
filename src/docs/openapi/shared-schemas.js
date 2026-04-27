import {
  arrayOf,
  booleanSchema,
  dateTimeSchema,
  headerParam,
  idSchema,
  integerSchema,
  nullableRef,
  numberSchema,
  objectSchema,
  ref,
  stringSchema,
} from './helpers.js';
import { BILLING_SUBSCRIPTION_STATUS_VALUES } from '../../constants/billing-subscription-status.js';
import { INVITE_STATUS_VALUES } from '../../constants/invite-status.js';
import { MAILBOX_TYPE } from '../../constants/mailbox-type.js';
import { OTP_PURPOSE_VALUES } from '../../constants/otp-purpose.js';
import { PLATFORM_ROLE_VALUES } from '../../constants/platform-roles.js';
import { TICKET_CHANNEL_VALUES } from '../../constants/ticket-channel.js';
import {
  TICKET_MESSAGE_TYPE,
  TICKET_MESSAGE_TYPE_VALUES,
} from '../../constants/ticket-message-type.js';
import { TICKET_PARTICIPANT_TYPE_VALUES } from '../../constants/ticket-participant-type.js';
import { TICKET_PRIORITY_VALUES } from '../../constants/ticket-priority.js';
import { TICKET_STATUS_VALUES } from '../../constants/ticket-status.js';
import { WORKSPACE_ROLE_VALUES } from '../../constants/workspace-roles.js';
import { WORKSPACE_STATUS_VALUES } from '../../constants/workspace-status.js';

const nullableString = (options = {}) =>
  stringSchema({ ...options, nullable: true });
const nullableId = (description) => ({
  ...idSchema(description),
  nullable: true,
});

const timestampFields = {
  createdAt: dateTimeSchema('Creation date-time.'),
  updatedAt: dateTimeSchema('Last update date-time.'),
};

const idField = {
  _id: idSchema('Resource id.'),
};

const optionSchema = (extra = {}) =>
  objectSchema(
    {
      ...idField,
      name: stringSchema(),
      ...extra,
    },
    {
      additionalProperties: true,
    }
  );

export const sharedOpenApiComponents = {
  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'Workspace-scoped JWT access token. The active workspace and roleKey are taken from the current session token.',
    },
    platformBearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Platform admin JWT access token for /admin endpoints.',
    },
  },
  parameters: {
    LangHeader: headerParam(
      'x-lang',
      stringSchema({ enum: ['en', 'ar'], example: 'en' }),
      'Optional response language. Defaults to en.',
      false
    ),
    StripeSignatureHeader: headerParam(
      'stripe-signature',
      stringSchema({ minLength: 1 }),
      'Stripe webhook signature header.',
      true
    ),
  },
  schemas: {
    ObjectId: idSchema(),
    SuccessEnvelope: objectSchema(
      {
        messageKey: stringSchema({
          description: 'Localization key for the success message.',
          example: 'success.ok',
        }),
        message: stringSchema({
          description: 'Localized success message.',
          example: 'OK',
        }),
      },
      {
        required: ['messageKey', 'message'],
        additionalProperties: true,
      }
    ),
    ErrorEnvelope: objectSchema(
      {
        status: integerSchema({ minimum: 400, example: 404 }),
        messageKey: stringSchema({ example: 'errors.notFound' }),
        message: stringSchema({ example: 'Route not found.' }),
        errors: {
          nullable: true,
          oneOf: [
            arrayOf(objectSchema({}, { additionalProperties: true })),
            objectSchema({}, { additionalProperties: true }),
          ],
        },
      },
      {
        required: ['status', 'messageKey', 'message', 'errors'],
        additionalProperties: true,
      }
    ),
    ValidationError: objectSchema(
      {
        field: stringSchema({ example: 'email' }),
        messageKey: stringSchema({
          example: 'errors.validation.invalidEmail',
        }),
        msg: stringSchema({ example: 'Invalid email address.' }),
      },
      {
        required: ['field', 'messageKey', 'msg'],
        additionalProperties: true,
      }
    ),
    ValidationErrorEnvelope: objectSchema(
      {
        status: integerSchema({ example: 422 }),
        messageKey: stringSchema({ example: 'errors.validation.failed' }),
        message: stringSchema({ example: 'Validation failed.' }),
        errors: arrayOf(ref('ValidationError')),
      },
      {
        required: ['status', 'messageKey', 'message', 'errors'],
        additionalProperties: false,
      }
    ),
    PaginationFields: objectSchema(
      {
        page: integerSchema({ minimum: 1, example: 1 }),
        limit: integerSchema({ minimum: 1, example: 20 }),
        total: integerSchema({ minimum: 0, example: 0 }),
        results: integerSchema({ minimum: 0, example: 0 }),
      },
      {
        required: ['page', 'limit', 'total', 'results'],
        additionalProperties: false,
      }
    ),
    HealthStatus: objectSchema(
      {
        status: stringSchema({ enum: ['ok'] }),
      },
      { required: ['status'], additionalProperties: false }
    ),
    UserSummary: objectSchema(
      {
        ...idField,
        email: stringSchema({ format: 'email' }),
        name: nullableString(),
        avatar: nullableString({ maxLength: 2048 }),
      },
      { additionalProperties: true }
    ),
    WorkspaceSummary: objectSchema(
      {
        ...idField,
        name: stringSchema(),
        slug: nullableString(),
        status: stringSchema({ enum: WORKSPACE_STATUS_VALUES }),
        defaultMailboxId: nullableId('Default mailbox id.'),
        defaultSlaPolicyId: nullableId('Default SLA policy id.'),
      },
      { additionalProperties: true }
    ),
    WorkspaceMembership: objectSchema(
      {
        workspace: ref('WorkspaceSummary'),
        roleKey: stringSchema({ enum: WORKSPACE_ROLE_VALUES }),
        isCurrent: booleanSchema(),
      },
      { additionalProperties: true }
    ),
    WorkspaceInvite: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        email: stringSchema({ format: 'email' }),
        roleKey: stringSchema({ enum: WORKSPACE_ROLE_VALUES }),
        status: stringSchema({ enum: INVITE_STATUS_VALUES }),
        invitedByUserId: nullableId('Inviting user id.'),
        expiresAt: dateTimeSchema(),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    AuthTokens: objectSchema(
      {
        accessToken: stringSchema(),
        refreshToken: stringSchema(),
      },
      { additionalProperties: true }
    ),
    AuthSession: objectSchema(
      {
        ...idField,
        userId: idSchema(),
        workspaceId: nullableId('Active workspace id.'),
        roleKey: nullableString({ enum: WORKSPACE_ROLE_VALUES }),
      },
      { additionalProperties: true }
    ),
    Contact: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        organizationId: nullableId('Organization id.'),
        organization: nullableRef('Organization'),
        fullName: stringSchema({ maxLength: 180 }),
        email: nullableString({ format: 'email' }),
        phone: nullableString(),
        tags: arrayOf(stringSchema()),
        customFields: objectSchema(
          {},
          { additionalProperties: true, nullable: true }
        ),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    ContactOption: optionSchema({
      fullName: stringSchema(),
      email: nullableString({ format: 'email' }),
      phone: nullableString(),
      organizationId: nullableId('Organization id.'),
    }),
    ContactIdentity: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        contactId: idSchema(),
        type: stringSchema({ enum: ['email', 'phone', 'whatsapp'] }),
        value: stringSchema(),
        verifiedAt: { ...dateTimeSchema(), nullable: true },
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    Organization: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        name: stringSchema({ maxLength: 180 }),
        domain: nullableString({ maxLength: 253 }),
        notes: nullableString({ maxLength: 5000 }),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    OrganizationOption: optionSchema({
      domain: nullableString({ maxLength: 253 }),
    }),
    Mailbox: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        name: stringSchema({ maxLength: 120 }),
        type: stringSchema({ enum: [MAILBOX_TYPE.EMAIL] }),
        emailAddress: nullableString({ format: 'email' }),
        fromName: nullableString(),
        replyTo: nullableString({ format: 'email' }),
        signatureText: nullableString(),
        signatureHtml: nullableString(),
        slaPolicyId: nullableId('SLA policy id.'),
        isActive: booleanSchema(),
        isDefault: booleanSchema(),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    MailboxOption: optionSchema({
      type: stringSchema({ enum: [MAILBOX_TYPE.EMAIL] }),
      isActive: booleanSchema(),
      isDefault: booleanSchema(),
    }),
    MailboxAction: objectSchema(
      {
        ...idField,
        name: stringSchema(),
        isActive: booleanSchema(),
        isDefault: booleanSchema(),
      },
      { additionalProperties: true }
    ),
    TicketCategory: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        name: stringSchema({ maxLength: 120 }),
        slug: nullableString({ maxLength: 140 }),
        parentId: nullableId('Parent category id.'),
        order: integerSchema(),
        isActive: booleanSchema(),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    TicketCategoryOption: optionSchema({
      slug: nullableString(),
      parentId: nullableId('Parent category id.'),
      isActive: booleanSchema(),
    }),
    TicketTag: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        name: stringSchema({ maxLength: 80 }),
        isActive: booleanSchema(),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    TicketTagOption: optionSchema({
      isActive: booleanSchema(),
    }),
    TicketSla: objectSchema(
      {
        policyId: nullableId('SLA policy id.'),
        source: nullableString({ enum: ['mailbox', 'workspace_default'] }),
        firstResponseDueAt: { ...dateTimeSchema(), nullable: true },
        resolutionDueAt: { ...dateTimeSchema(), nullable: true },
        firstResponseStatus: nullableString(),
        resolutionStatus: nullableString(),
      },
      { additionalProperties: true }
    ),
    Ticket: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        number: integerSchema({ minimum: 1 }),
        subject: stringSchema({ maxLength: 240 }),
        status: stringSchema({ enum: TICKET_STATUS_VALUES }),
        priority: stringSchema({ enum: TICKET_PRIORITY_VALUES }),
        channel: stringSchema({ enum: TICKET_CHANNEL_VALUES }),
        mailboxId: idSchema(),
        mailbox: nullableRef('Mailbox'),
        contactId: idSchema(),
        contact: nullableRef('Contact'),
        organizationId: nullableId('Organization id.'),
        organization: nullableRef('Organization'),
        categoryId: nullableId('Ticket category id.'),
        category: nullableRef('TicketCategory'),
        tagIds: arrayOf(idSchema()),
        tags: arrayOf(ref('TicketTag')),
        assigneeId: nullableId('Assignee user id.'),
        assignee: nullableRef('UserSummary'),
        conversationId: idSchema(),
        messageCount: integerSchema({ minimum: 0 }),
        sla: ref('TicketSla'),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    TicketAction: objectSchema(
      {
        ...idField,
        status: stringSchema({ enum: TICKET_STATUS_VALUES }),
        assigneeId: nullableId('Assignee user id.'),
        statusChangedAt: { ...dateTimeSchema(), nullable: true },
        solvedAt: { ...dateTimeSchema(), nullable: true },
        closedAt: { ...dateTimeSchema(), nullable: true },
        reopenedAt: { ...dateTimeSchema(), nullable: true },
        sla: ref('TicketSla'),
      },
      { additionalProperties: true }
    ),
    TicketMessage: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        ticketId: idSchema(),
        conversationId: idSchema(),
        type: stringSchema({ enum: TICKET_MESSAGE_TYPE_VALUES }),
        bodyText: stringSchema({ maxLength: 50000 }),
        bodyHtml: nullableString({ maxLength: 50000 }),
        attachments: arrayOf(ref('File')),
        createdBy: { ...ref('UserSummary'), nullable: true },
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    TicketConversation: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        ticketId: idSchema(),
        mailboxId: idSchema(),
        mailbox: nullableRef('Mailbox'),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    TicketParticipant: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        ticketId: idSchema(),
        userId: idSchema(),
        type: stringSchema({ enum: TICKET_PARTICIPANT_TYPE_VALUES }),
        user: ref('UserSummary'),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    File: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        originalName: stringSchema(),
        storedName: stringSchema(),
        mimeType: stringSchema(),
        extension: stringSchema({ example: '.png' }),
        sizeBytes: integerSchema({ minimum: 0 }),
        kind: nullableString(),
        source: stringSchema(),
        uploadedByUserId: nullableId('Uploader user id.'),
        downloadUrl: stringSchema({
          example: '/api/files/64f1a6f3b7c9a0a1b2c3d4e5/download',
        }),
        isLinked: booleanSchema(),
        downloadCount: integerSchema({ minimum: 0 }),
        lastAccessedAt: { ...dateTimeSchema(), nullable: true },
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    FileDeleteAction: objectSchema(
      {
        fileId: idSchema(),
        deleted: booleanSchema(),
      },
      { additionalProperties: true }
    ),
    BusinessHoursWindow: objectSchema(
      {
        start: stringSchema({
          pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$',
          example: '09:00',
        }),
        end: stringSchema({
          pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$',
          example: '17:00',
        }),
      },
      { required: ['start', 'end'], additionalProperties: false }
    ),
    BusinessHoursDay: objectSchema(
      {
        dayOfWeek: integerSchema({ minimum: 0, maximum: 6 }),
        isOpen: booleanSchema(),
        windows: arrayOf(ref('BusinessHoursWindow')),
      },
      {
        required: ['dayOfWeek', 'isOpen', 'windows'],
        additionalProperties: false,
      }
    ),
    BusinessHours: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        name: stringSchema({ maxLength: 120 }),
        timezone: stringSchema({ example: 'Asia/Damascus' }),
        weeklySchedule: arrayOf(ref('BusinessHoursDay')),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    BusinessHoursOption: optionSchema({
      timezone: stringSchema(),
    }),
    SlaRule: objectSchema(
      {
        firstResponseMinutes: integerSchema({ minimum: 0, nullable: true }),
        resolutionMinutes: integerSchema({ minimum: 0, nullable: true }),
      },
      { additionalProperties: false }
    ),
    SlaRulesByPriority: objectSchema(
      Object.fromEntries(
        TICKET_PRIORITY_VALUES.map((priority) => [priority, ref('SlaRule')])
      ),
      { additionalProperties: false }
    ),
    SlaPolicy: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        name: stringSchema({ maxLength: 120 }),
        isActive: booleanSchema(),
        isDefault: booleanSchema(),
        businessHoursId: idSchema(),
        businessHours: nullableRef('BusinessHoursOption'),
        rulesByPriority: ref('SlaRulesByPriority'),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    SlaPolicyOption: optionSchema({
      isActive: booleanSchema(),
      isDefault: booleanSchema(),
    }),
    SlaPolicyAction: objectSchema(
      {
        ...idField,
        name: stringSchema(),
        isActive: booleanSchema(),
        isDefault: booleanSchema(),
      },
      { additionalProperties: true }
    ),
    SlaSummary: objectSchema(
      {
        businessHours: objectSchema(
          { total: integerSchema({ minimum: 0 }) },
          { additionalProperties: true }
        ),
        policies: objectSchema({}, { additionalProperties: true }),
        mailboxes: objectSchema({}, { additionalProperties: true }),
        runtime: objectSchema({}, { additionalProperties: true }),
      },
      { additionalProperties: true }
    ),
    WidgetBranding: objectSchema(
      {
        displayName: nullableString({ maxLength: 120 }),
        accentColor: nullableString({
          pattern: '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$',
        }),
        launcherLabel: nullableString({ maxLength: 80 }),
        welcomeTitle: nullableString({ maxLength: 160 }),
        welcomeMessage: nullableString({ maxLength: 1000 }),
      },
      { additionalProperties: false }
    ),
    WidgetBehavior: objectSchema(
      {
        defaultLocale: stringSchema({ enum: ['en', 'ar'] }),
        collectName: booleanSchema(),
        collectEmail: booleanSchema(),
      },
      { additionalProperties: false }
    ),
    Widget: objectSchema(
      {
        ...idField,
        workspaceId: idSchema(),
        mailboxId: idSchema(),
        mailbox: nullableRef('Mailbox'),
        publicKey: stringSchema({ pattern: '^wgt_[a-f0-9]{32}$' }),
        name: stringSchema({ maxLength: 120 }),
        isActive: booleanSchema(),
        branding: ref('WidgetBranding'),
        behavior: ref('WidgetBehavior'),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    WidgetOption: optionSchema({
      publicKey: stringSchema(),
      isActive: booleanSchema(),
    }),
    WidgetAction: objectSchema(
      {
        ...idField,
        name: stringSchema(),
        isActive: booleanSchema(),
      },
      { additionalProperties: true }
    ),
    PublicWidgetBootstrap: objectSchema(
      {
        publicKey: stringSchema(),
        branding: ref('WidgetBranding'),
        behavior: ref('WidgetBehavior'),
        realtime: objectSchema({}, { additionalProperties: true }),
      },
      { additionalProperties: true }
    ),
    PublicWidgetSession: objectSchema(
      {
        token: stringSchema({ pattern: '^wgs_[a-f0-9]{48}$' }),
        status: stringSchema(),
      },
      { additionalProperties: true }
    ),
    PublicWidgetMessage: objectSchema(
      {
        ...idField,
        type: stringSchema({
          enum: [
            TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
            TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
            TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          ],
        }),
        bodyText: stringSchema(),
        attachments: arrayOf(ref('File')),
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    PublicWidgetRecovery: objectSchema(
      {
        token: stringSchema({ pattern: '^wgr_[a-f0-9]{48}$' }),
        expiresAt: dateTimeSchema(),
        candidate: objectSchema(
          {},
          { additionalProperties: true, nullable: true }
        ),
      },
      { additionalProperties: true }
    ),
    BillingPlan: objectSchema(
      {
        key: stringSchema(),
        name: stringSchema(),
        price: numberSchema({ minimum: 0 }),
        currency: stringSchema(),
        interval: stringSchema(),
      },
      { additionalProperties: true }
    ),
    BillingAddon: objectSchema(
      {
        key: stringSchema(),
        name: stringSchema(),
        type: stringSchema(),
        price: numberSchema({ minimum: 0 }),
        currency: stringSchema(),
      },
      { additionalProperties: true }
    ),
    BillingSubscription: objectSchema(
      {
        status: stringSchema({ enum: BILLING_SUBSCRIPTION_STATUS_VALUES }),
        plan: nullableRef('BillingPlan'),
        addonItems: arrayOf(objectSchema({}, { additionalProperties: true })),
      },
      { additionalProperties: true }
    ),
    BillingEntitlements: objectSchema({}, { additionalProperties: true }),
    BillingUsage: objectSchema({}, { additionalProperties: true }),
    BillingSummary: objectSchema(
      {
        subscription: ref('BillingSubscription'),
        entitlements: ref('BillingEntitlements'),
        usage: ref('BillingUsage'),
      },
      { additionalProperties: true }
    ),
    BillingCheckoutSession: objectSchema(
      {
        url: stringSchema({ format: 'uri' }),
        sessionId: stringSchema(),
      },
      { additionalProperties: true }
    ),
    BillingPortalSession: objectSchema(
      {
        url: stringSchema({ format: 'uri' }),
      },
      { additionalProperties: true }
    ),
    BillingWebhookResult: objectSchema(
      {
        received: booleanSchema(),
        duplicate: booleanSchema(),
      },
      { additionalProperties: true }
    ),
    ReportFilters: objectSchema({}, { additionalProperties: true }),
    ReportOverview: objectSchema({}, { additionalProperties: true }),
    ReportTickets: objectSchema({}, { additionalProperties: true }),
    ReportSla: objectSchema({}, { additionalProperties: true }),
    ReportTeam: objectSchema({}, { additionalProperties: true }),
    RealtimeBootstrap: objectSchema({}, { additionalProperties: true }),
    PlatformAdmin: objectSchema(
      {
        ...idField,
        email: stringSchema({ format: 'email' }),
        name: nullableString(),
        role: stringSchema({ enum: PLATFORM_ROLE_VALUES }),
        roleKey: stringSchema({
          enum: PLATFORM_ROLE_VALUES,
          description:
            'Alias used by some clients; platform auth service returns role.',
        }),
      },
      { additionalProperties: true }
    ),
    AdminWorkspace: objectSchema(
      {
        ...idField,
        name: stringSchema(),
        status: stringSchema({ enum: WORKSPACE_STATUS_VALUES }),
        billingStatus: nullableString({
          enum: BILLING_SUBSCRIPTION_STATUS_VALUES,
        }),
        planKey: nullableString(),
        trialEndsAt: { ...dateTimeSchema(), nullable: true },
        ...timestampFields,
      },
      { additionalProperties: true }
    ),
    AdminOverview: objectSchema({}, { additionalProperties: true }),
    AdminMetrics: objectSchema({}, { additionalProperties: true }),
    AdminBillingOverview: objectSchema({}, { additionalProperties: true }),
    OtpPurpose: stringSchema({ enum: OTP_PURPOSE_VALUES }),
  },
};
