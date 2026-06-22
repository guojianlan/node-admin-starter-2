process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ??
  "postgres://admin_base:admin_base@localhost:5432/admin_base_test";
process.env.ADMIN_BASE_SECRET_KEY = "test-admin-base-secret";
process.env.ADMIN_BASE_TOKEN_TTL_DAYS = "7";
process.env.LOG_LEVEL = "silent";
