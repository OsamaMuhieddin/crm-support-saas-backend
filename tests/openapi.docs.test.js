import request from 'supertest';

import app from '../src/app.js';
import { openApiDocument } from '../src/docs/openapi/index.js';

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

  it('documents the mounted API areas', () => {
    const requiredPaths = [
      '/health',
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
});
