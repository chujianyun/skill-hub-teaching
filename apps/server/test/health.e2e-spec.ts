import { INestApplication } from '@nestjs/common';
import { HEALTH_PATH } from '@skill-hub/shared';
import request from 'supertest';
import { createTestApp } from './app';

describe('GET /api/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the API and database as up', async () => {
    const res = await request(app.getHttpServer()).get(HEALTH_PATH).expect(200);

    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });
});
