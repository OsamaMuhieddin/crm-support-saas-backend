import { readFileSync } from 'node:fs';

import request from 'supertest';

import app from '../src/app.js';
import { realtimeAsyncApiDocument } from '../src/docs/asyncapi/index.js';
import { openApiDocument } from '../src/docs/openapi/index.js';
import apiRouter from '../src/routes/index.js';

const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
]);

const joinPaths = (...parts) => {
  const joined = parts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join('/');

  const normalized = `/${joined}`.replace(/\/+/g, '/').replace(/\/$/, '');

  return normalized || '/';
};

const mountPathFromLayer = (layer) => {
  if (!layer?.regexp || layer.regexp.fast_slash) {
    return '';
  }

  let keyIndex = 0;
  return layer.regexp.source
    .replace(/\(\?:\\\/\(\[\^\/\]\+\?\)\)/g, () => {
      const keyName = layer.keys?.[keyIndex++]?.name || 'param';
      return `\\/:${keyName}`;
    })
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\/\?\$$/, '')
    .replace(/\\\//g, '/')
    .replace(/\$$/, '');
};

const normalizeDocumentedPath = (routePath) =>
  joinPaths(routePath).replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const collectExpressRoutes = (router, prefix = '') => {
  const routes = [];

  for (const layer of router.stack || []) {
    if (layer.route) {
      const routePath = normalizeDocumentedPath(
        joinPaths(prefix, layer.route.path)
      );

      for (const method of Object.keys(layer.route.methods || {})) {
        if (HTTP_METHODS.has(method)) {
          routes.push(`${method.toUpperCase()} ${routePath}`);
        }
      }

      continue;
    }

    if (layer.handle?.stack) {
      routes.push(
        ...collectExpressRoutes(
          layer.handle,
          joinPaths(prefix, mountPathFromLayer(layer))
        )
      );
    }
  }

  return [...new Set(routes)].sort();
};

const collectOpenApiRoutes = () => {
  const routes = [];

  for (const [path, pathItem] of Object.entries(openApiDocument.paths)) {
    for (const method of Object.keys(pathItem)) {
      if (HTTP_METHODS.has(method)) {
        routes.push(`${method.toUpperCase()} ${normalizeDocumentedPath(path)}`);
      }
    }
  }

  return [...new Set(routes)].sort();
};

const operationSource = () =>
  readFileSync(
    new URL('../src/docs/openapi/helpers.js', import.meta.url),
    'utf8'
  );

describe('OpenAPI docs', () => {
  it('serves Swagger UI at /api/docs', async () => {
    const redirectResponse = await request(app).get('/api/docs').expect(301);

    expect(redirectResponse.headers.location).toBe('/api/docs/');

    const response = await request(app).get('/api/docs/').expect(200);

    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('swagger-ui');
  });

  it('serves Swagger UI static assets under /api/docs', async () => {
    const response = await request(app)
      .get('/api/docs/swagger-ui-bundle.js')
      .expect(200);

    expect(response.headers['content-type']).toMatch(/javascript/);
  });

  it('serves raw OpenAPI JSON without the success envelope', async () => {
    const response = await request(app).get('/api/docs.json').expect(200);

    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.openapi).toBe('3.0.3');
    expect(response.body.info.title).toBe('CRM Support SaaS Backend API');
    expect(response.body.messageKey).toBeUndefined();
    expect(response.body.message).toBeUndefined();
    expect(response.body.components.securitySchemes.bearerAuth).toBeDefined();
    expect(response.body.components.parameters.LangHeader).toBeDefined();
  });

  it('serves realtime AsyncAPI JSON and HTML without the success envelope', async () => {
    const jsonResponse = await request(app)
      .get('/api/docs/realtime.json')
      .expect(200);

    expect(jsonResponse.headers['content-type']).toMatch(/application\/json/);
    expect(jsonResponse.body.asyncapi).toBe('2.6.0');
    expect(jsonResponse.body.messageKey).toBeUndefined();
    expect(jsonResponse.body.channels['ticket.subscribe']).toBeDefined();
    expect(jsonResponse.body.channels['widget.message.created']).toBeDefined();

    const htmlResponse = await request(app)
      .get('/api/docs/realtime')
      .expect(200);

    expect(htmlResponse.headers['content-type']).toMatch(/text\/html/);
    expect(htmlResponse.text).toContain('CRM Support SaaS Realtime API');
    expect(htmlResponse.text).toContain('Acknowledgements');
    expect(htmlResponse.text).toContain('Payload schema');
    expect(htmlResponse.text).toContain(
      'Search events, rooms, auth, ack codes'
    );
  });

  it('documents the mounted API areas', () => {
    const requiredPaths = [
      '/health',
      '/docs/realtime',
      '/docs/realtime.json',
      '/auth/login',
      '/workspaces/mine',
      '/customers/contacts',
      '/tickets',
      '/tickets/{id}/messages',
      '/files/{fileId}/download',
      '/mailboxes/{id}/set-default',
      '/sla/policies/{id}/deactivate',
      '/widgets/public/{publicKey}/messages',
      '/billing/checkout-session',
      '/reports/overview',
      '/realtime/bootstrap',
      '/admin/auth/login',
      '/admin/workspaces/{id}/suspend',
      '/users',
    ];

    for (const path of requiredPaths) {
      expect(openApiDocument.paths[path]).toBeDefined();
    }
  });

  it('keeps mounted HTTP routes in sync with OpenAPI paths', () => {
    expect(collectOpenApiRoutes()).toEqual(collectExpressRoutes(apiRouter));
  });

  it('gives every documented operation core OpenAPI fields', () => {
    const methods = new Set([
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'options',
      'head',
      'trace',
    ]);

    for (const [path, pathItem] of Object.entries(openApiDocument.paths)) {
      expect(path).not.toContain(':');

      for (const [method, operation] of Object.entries(pathItem)) {
        if (!methods.has(method)) {
          continue;
        }

        expect(operation.summary).toBeTruthy();
        expect(operation.operationId).toBeTruthy();
        expect(operation.responses).toBeDefined();
      }
    }
  });

  it('documents auth scope and role requirements for protected operations', () => {
    const methods = new Set([
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'options',
      'head',
      'trace',
    ]);

    for (const pathItem of Object.values(openApiDocument.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!methods.has(method)) {
          continue;
        }

        expect(operation['x-auth']).toBeDefined();

        if (!operation['x-auth'].protected) {
          continue;
        }

        expect(operation.description).toMatch(/Authorization:/);

        if (
          operation['x-auth'].scope === 'workspace' ||
          operation['x-auth'].scope === 'platform'
        ) {
          expect(operation['x-auth'].allowedRoleKeys).toEqual(
            expect.any(Array)
          );
          expect(operation['x-auth'].allowedRoleKeys.length).toBeGreaterThan(0);
        }
      }
    }

    expect(
      openApiDocument.paths['/billing/catalog'].get['x-auth']
    ).toMatchObject({
      scope: 'workspace',
      allowedRoleKeys: ['owner', 'admin'],
    });
    expect(openApiDocument.paths['/tickets'].post['x-auth']).toMatchObject({
      scope: 'workspace',
      allowedRoleKeys: ['owner', 'admin', 'agent'],
    });
    expect(
      openApiDocument.paths['/auth/profile'].patch['x-auth']
    ).toMatchObject({
      scope: 'user',
      requiresActiveMember: false,
    });
    expect(
      openApiDocument.paths['/admin/billing-overview'].get['x-auth']
    ).toMatchObject({
      scope: 'platform',
      allowedRoleKeys: ['super_admin'],
    });
  });

  it('uses explicit auth profiles for restricted operations', () => {
    const source = operationSource();

    expect(source).not.toContain('inferAuthProfileName');
    expect(openApiDocument.paths['/billing/catalog'].get.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(
      openApiDocument.paths['/billing/catalog'].get['x-auth']
    ).toMatchObject({
      allowedRoleKeys: ['owner', 'admin'],
    });
    expect(openApiDocument.paths['/tickets'].post['x-auth']).toMatchObject({
      allowedRoleKeys: ['owner', 'admin', 'agent'],
    });
  });

  it('includes concrete examples for high-use HTTP operations', () => {
    const loginExample =
      openApiDocument.paths['/auth/login'].post.responses[200].content[
        'application/json'
      ].example;
    const ticketCreateExample =
      openApiDocument.paths['/tickets'].post.responses[200].content[
        'application/json'
      ].example;
    const uploadExample =
      openApiDocument.paths['/files'].post.responses[200].content[
        'application/json'
      ].example;
    const checkoutExample =
      openApiDocument.paths['/billing/checkout-session'].post.responses[200]
        .content['application/json'].example;

    expect(loginExample).toMatchObject({
      messageKey: 'success.auth.loggedIn',
      tokens: {
        accessToken: expect.any(String),
      },
    });
    expect(ticketCreateExample).toMatchObject({
      messageKey: 'success.ticket.created',
      ticket: {
        subject: 'Cannot access billing portal',
      },
    });
    expect(uploadExample).toMatchObject({
      messageKey: 'success.file.uploaded',
      file: {
        originalName: 'invoice.pdf',
      },
    });
    expect(checkoutExample).toMatchObject({
      messageKey: 'success.billing.checkoutSessionCreated',
      checkoutSession: {
        url: expect.stringContaining('stripe.com'),
      },
    });
  });

  it('documents the actual Socket.IO event surface in AsyncAPI', () => {
    const expectedChannels = [
      'workspace.subscribe',
      'workspace.unsubscribe',
      'ticket.subscribe',
      'ticket.unsubscribe',
      'ticket.presence.set',
      'ticket.typing.start',
      'ticket.typing.stop',
      'ticket.soft_claim.set',
      'ticket.soft_claim.clear',
      'widget.subscribe',
      'widget.unsubscribe',
      'ticket.created',
      'ticket.updated',
      'ticket.assigned',
      'ticket.unassigned',
      'ticket.status_changed',
      'ticket.solved',
      'ticket.closed',
      'ticket.reopened',
      'message.created',
      'conversation.updated',
      'ticket.participant_changed',
      'user.notice',
      'widget.message.created',
      'widget.conversation.updated',
    ];

    for (const channel of expectedChannels) {
      expect(realtimeAsyncApiDocument.channels[channel]).toBeDefined();
    }

    expect(
      realtimeAsyncApiDocument.channels['ticket.subscribe'].subscribe['x-ack']
        .successCodes
    ).toContain('realtime.ticket.subscribed');
    expect(
      realtimeAsyncApiDocument.channels['widget.subscribe'].subscribe['x-auth']
    ).toMatchObject({
      mode: 'widget_session',
      tokenPrefix: 'wgs_',
    });
    expect(
      realtimeAsyncApiDocument.components.schemas.RealtimeAck
    ).toBeDefined();
    expect(
      realtimeAsyncApiDocument.components.schemas.RealtimeErrorAck
    ).toBeDefined();
  });
});
