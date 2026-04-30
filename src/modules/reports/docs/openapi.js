import {
  idSchema,
  operation,
  queryParam,
  ref,
  stringSchema,
} from '../../../docs/openapi/helpers.js';

const reportFilterParams = [
  queryParam('from', stringSchema({ format: 'date' })),
  queryParam('to', stringSchema({ format: 'date' })),
  queryParam('groupBy', stringSchema({ enum: ['day', 'week', 'month'] })),
  queryParam('mailboxId', idSchema('Mailbox id.')),
  queryParam('assigneeId', idSchema('Assignee user id.')),
  queryParam(
    'priority',
    stringSchema({ enum: ['low', 'normal', 'high', 'urgent'] })
  ),
  queryParam('categoryId', idSchema('Category id.')),
  queryParam('tagId', idSchema('Tag id.')),
];

export const reportsOpenApiPaths = {
  '/reports/overview': {
    get: operation({
      tags: 'Reports',
      summary: 'Get reports overview',
      operationId: 'getReportsOverview',
      description:
        'Purpose: return dashboard report overview for the active workspace. Date range defaults to the recent reporting window and may not exceed 366 days.',
      parameters: reportFilterParams,
      success: {
        payload: {
          filters: ref('ReportFilters'),
          overview: ref('ReportOverview'),
        },
      },
    }),
  },
  '/reports/tickets': {
    get: operation({
      tags: 'Reports',
      summary: 'Get tickets report',
      operationId: 'getReportsTickets',
      description:
        'Purpose: return ticket reporting metrics for the active workspace. Date range may not exceed 366 days.',
      parameters: reportFilterParams,
      success: {
        payload: {
          filters: ref('ReportFilters'),
          tickets: ref('ReportTickets'),
        },
      },
    }),
  },
  '/reports/sla': {
    get: operation({
      tags: 'Reports',
      summary: 'Get SLA report',
      operationId: 'getReportsSla',
      description:
        'Purpose: return SLA reporting metrics for the active workspace. Date range may not exceed 366 days.',
      parameters: reportFilterParams,
      success: {
        payload: {
          filters: ref('ReportFilters'),
          sla: ref('ReportSla'),
        },
      },
    }),
  },
  '/reports/team': {
    get: operation({
      tags: 'Reports',
      summary: 'Get team report',
      operationId: 'getReportsTeam',
      security: 'workspaceOwnerAdmin',
      description:
        'Purpose: return team reporting metrics for the active workspace. Authorization: owner or admin roleKey required. Date range may not exceed 366 days.',
      parameters: reportFilterParams,
      success: {
        payload: {
          filters: ref('ReportFilters'),
          team: ref('ReportTeam'),
        },
      },
    }),
  },
};
