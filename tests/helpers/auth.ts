export function getAdminTestPassword() {
  return process.env.ADMIN_BASE_ADMIN_PASSWORD || "123456";
}
