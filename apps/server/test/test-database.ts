// e2e 一律打真实 Postgres 测试库（docker-compose.dev.yml 中的 skill_hub_demo_test）。
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/skill_hub_demo_test';
