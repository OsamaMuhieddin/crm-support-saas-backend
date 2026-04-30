import { adminOpenApiPaths } from '../../modules/admin/docs/openapi.js';
import { authOpenApiPaths } from '../../modules/auth/docs/openapi.js';
import { billingOpenApiPaths } from '../../modules/billing/docs/openapi.js';
import { customersOpenApiPaths } from '../../modules/customers/docs/openapi.js';
import { filesOpenApiPaths } from '../../modules/files/docs/openapi.js';
import { healthOpenApiPaths } from '../../modules/health/docs/openapi.js';
import { mailboxesOpenApiPaths } from '../../modules/mailboxes/docs/openapi.js';
import { realtimeOpenApiPaths } from '../../modules/realtime/docs/openapi.js';
import { reportsOpenApiPaths } from '../../modules/reports/docs/openapi.js';
import { slaOpenApiPaths } from '../../modules/sla/docs/openapi.js';
import { ticketsOpenApiPaths } from '../../modules/tickets/docs/openapi.js';
import { usersOpenApiPaths } from '../../modules/users/docs/openapi.js';
import { widgetOpenApiPaths } from '../../modules/widget/docs/openapi.js';
import { workspacesOpenApiPaths } from '../../modules/workspaces/docs/openapi.js';
import {
  mergePaths,
  objectSchema,
  operation,
  stringSchema,
} from './helpers.js';
import { sharedOpenApiComponents } from './shared-schemas.js';

const documentationOpenApiPaths = {
  '/docs': {
    get: operation({
      tags: 'API Documentation',
      summary: 'Swagger UI',
      operationId: 'getSwaggerUi',
      security: 'public',
      includeLang: false,
      description:
        'Purpose: serve the interactive Swagger UI for browsing the OpenAPI representation.',
      responses: {
        200: {
          description: 'HTML Swagger UI.',
          content: {
            'text/html': {
              schema: stringSchema(),
            },
          },
        },
      },
    }),
  },
  '/docs.json': {
    get: operation({
      tags: 'API Documentation',
      summary: 'Raw OpenAPI document',
      operationId: 'getOpenApiDocument',
      security: 'public',
      includeLang: false,
      description:
        'Purpose: return the raw OpenAPI JSON document. This route intentionally bypasses the API success-envelope wrapper.',
      responses: {
        200: {
          description: 'OpenAPI document.',
          content: {
            'application/json': {
              schema: objectSchema({}, { additionalProperties: true }),
            },
          },
        },
      },
    }),
  },
  '/docs/realtime': {
    get: operation({
      tags: 'API Documentation',
      summary: 'Realtime AsyncAPI UI',
      operationId: 'getRealtimeAsyncApiUi',
      security: 'public',
      includeLang: false,
      description:
        'Purpose: serve a lightweight HTML viewer for the Socket.IO AsyncAPI realtime contract.',
      responses: {
        200: {
          description: 'HTML realtime AsyncAPI viewer.',
          content: {
            'text/html': {
              schema: stringSchema(),
            },
          },
        },
      },
    }),
  },
  '/docs/realtime.json': {
    get: operation({
      tags: 'API Documentation',
      summary: 'Raw realtime AsyncAPI document',
      operationId: 'getRealtimeAsyncApiDocument',
      security: 'public',
      includeLang: false,
      description:
        'Purpose: return the raw AsyncAPI JSON document for Socket.IO realtime events. This route intentionally bypasses the API success-envelope wrapper.',
      responses: {
        200: {
          description: 'AsyncAPI document.',
          content: {
            'application/json': {
              schema: objectSchema({}, { additionalProperties: true }),
            },
          },
        },
      },
    }),
  },
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'CRM Support SaaS Backend API',
    version: '1.0.0',
    description: [
      'Auth model & authorization model',
      '',
      'Most business endpoints are workspace-scoped. A normal user access token is tied to the current session and active workspace. The active workspace is switched only through POST /workspaces/switch, which returns a fresh access token. Workspace authorization is expressed with roleKey values: owner, admin, agent, and viewer.',
      '',
      'Platform admin endpoints under /admin use a separate platform bearer token and platform roles: super_admin, platform_admin, and platform_support.',
      '',
      'Shared headers',
      '',
      '- Authorization: Bearer access token for protected endpoints.',
      '- x-lang: optional en or ar response language; defaults to en.',
      '- Realtime Socket.IO contract: GET /docs/realtime or GET /docs/realtime.json.',
      '',
      'Quick Start Flows',
      '',
      '1. Sign up with POST /auth/signup, then verify with POST /auth/verify-email to receive tokens.',
      '2. Call GET /workspaces/mine to inspect memberships and the active workspace.',
      '3. Switch workspace explicitly with POST /workspaces/switch when needed and use the returned access token.',
      '4. Create support data such as mailboxes, contacts, tickets, files, SLA policies, and widgets using the active workspace token.',
      '5. Upload files with POST /files first, then attach returned file ids to ticket or widget message payloads.',
      '',
      'Response envelope',
      '',
      'JSON success responses include messageKey and localized message. JSON errors use { status, messageKey, message, errors }. Validation failures return status 422 with errors as an array.',
    ].join('\n'),
  },
  servers: [
    {
      url: '/api',
      description: 'API base path',
    },
  ],
  tags: [
    { name: 'API Documentation' },
    { name: 'Health' },
    { name: 'Auth' },
    { name: 'Workspaces' },
    { name: 'Workspace Invites' },
    { name: 'Users' },
    { name: 'Customer Contacts' },
    { name: 'Contact Identities' },
    { name: 'Customer Organizations' },
    { name: 'Tickets' },
    { name: 'Ticket Actions' },
    { name: 'Ticket Messages' },
    { name: 'Ticket Participants' },
    { name: 'Ticket Categories' },
    { name: 'Ticket Tags' },
    { name: 'Files' },
    { name: 'Mailboxes' },
    { name: 'SLA' },
    { name: 'Business Hours' },
    { name: 'SLA Policies' },
    { name: 'Widgets' },
    { name: 'Public Widget' },
    { name: 'Public Widget Recovery' },
    { name: 'Billing' },
    { name: 'Reports' },
    { name: 'Realtime' },
    { name: 'Admin Auth' },
    { name: 'Admin Workspaces' },
    { name: 'Admin Workspace Actions' },
    { name: 'Admin Analytics' },
  ],
  components: sharedOpenApiComponents,
  paths: mergePaths(
    documentationOpenApiPaths,
    healthOpenApiPaths,
    authOpenApiPaths,
    workspacesOpenApiPaths,
    usersOpenApiPaths,
    customersOpenApiPaths,
    ticketsOpenApiPaths,
    filesOpenApiPaths,
    mailboxesOpenApiPaths,
    slaOpenApiPaths,
    widgetOpenApiPaths,
    billingOpenApiPaths,
    reportsOpenApiPaths,
    realtimeOpenApiPaths,
    adminOpenApiPaths
  ),
};
