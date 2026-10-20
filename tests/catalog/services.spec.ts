import { test, expect } from '../fixtures';
import { expectError, expectResponse } from '../../src/assertions';
import { parameterEnum } from '../../src/spec';
import type { Service } from '../../src/types';

const CREDENTIAL_SERVICES = parameterEnum('getServiceCredentials', 'service');

test.describe('GET /services', () => {
  test('lists every service once, with links that point at that service', { tag: '@SVC-01' }, async ({ api }) => {
    const services = await expectResponse<Service[]>(await api.getServices(), 'getServices', 200);
    expect(services.length).toBeGreaterThan(0);
    expect(new Set(services.map((s) => s.id)).size, 'unique ids').toBe(services.length);
    for (const service of services) {
      if (service.pages_url) expect(service.pages_url).toBe(`/api/v4/services/${service.id}/pages`);
      if (service.credentials_url) expect(service.credentials_url).toBe(`/api/v4/services/${service.id}/credentials`);
    }
  });

  test('the account is subscribed to at least one service', { tag: '@SVC-02' }, async ({ subscribedServices }) => {
    expect(subscribedServices.size).toBeGreaterThan(0);
  });
});

test.describe('GET /services/{service}/pages', () => {
  test('answers for every listed service, naming the service it was asked for', { tag: '@SVC-03' }, async ({ api, services }) => {
    for (const { id } of services) {
      const body = await expectResponse<{ service: string; count: number; pages: unknown[] }>(
        await api.getServicePages(id),
        'getServicePages',
        200,
      );
      expect(body.service, id).toBe(id);
      expect(body.count, id).toBe(body.pages.length);
    }
  });

  test('an unknown service answers 404', { tag: '@SVC-04' }, async ({ api }) => {
    await expectError(await api.getServicePages('playwright-no-such-service'), 'getServicePages', 404);
  });
});

test.describe('GET /services/{service}/credentials', () => {
  test('a subscribed service hands out its credentials', { tag: '@SVC-05' }, async ({ api, subscribedServices }) => {
    const service = [...subscribedServices].find((id) => CREDENTIAL_SERVICES.includes(id));
    test.skip(!service, 'No subscribed service documents credentials');
    const body = await expectResponse<{ id: string; credentials: object }>(
      await api.getServiceCredentials(service!),
      'getServiceCredentials',
      200,
    );
    expect(body.id).toBe(service);
  });

  test('a service the account is not subscribed to answers 503 E_SERVICE_NOT_AVAILABLE', { tag: '@SVC-06' }, async ({ api, services }) => {
    const service = services.find((s) => s.access.state !== 'subscribed' && CREDENTIAL_SERVICES.includes(s.id));
    test.skip(!service, 'The account is subscribed to every service');
    await expectError(await api.getServiceCredentials(service!.id), 'getServiceCredentials', 503, 'E_SERVICE_NOT_AVAILABLE');
  });

  test('an unknown service answers 404', { tag: '@SVC-07' }, async ({ api }) => {
    await expectError(await api.getServiceCredentials('playwright-no-such-service'), 'getServiceCredentials', 404);
  });
});
