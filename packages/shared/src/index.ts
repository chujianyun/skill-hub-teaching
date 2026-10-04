export const API_PREFIX = 'api';

export const HEALTH_PATH = `/${API_PREFIX}/health`;

export interface HealthResponse {
  status: 'ok' | 'error';
  db: 'up' | 'down';
}

export * from './auth';
export * from './tenant';
export * from './skill';
