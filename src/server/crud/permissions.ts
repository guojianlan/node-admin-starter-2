import type { CrudAction, CrudMeta, CrudPermissions } from "./types";

const defaultActionPermissions: Partial<Record<CrudAction, string>> = {
  query: "query",
  get: "query",
  create: "create",
  update: "update",
  delete: "delete",
  batchDelete: "delete",
  restore: "delete",
  forceDelete: "delete",
  status: "status",
  export: "export",
  import: "import",
};

export function resolveCrudPermission(permissions: CrudPermissions, action: CrudAction) {
  const configured = permissions.actions?.[action];
  if (configured === false) return false;
  if (configured) return configured;

  const suffix = defaultActionPermissions[action];
  if (!suffix) return undefined;
  return `${permissions.prefix}.${suffix}`;
}

export function createCrudMeta(input: {
  basePath: string;
  permissions: CrudPermissions;
  actions: CrudAction[];
}): CrudMeta {
  const actions: Record<string, string | false> = {};
  input.actions.forEach((action) => {
    const permission = resolveCrudPermission(input.permissions, action);
    if (permission === undefined) {
      throw new Error(`CRUD action ${input.basePath}:${action} is missing permission`);
    }
    actions[action] = permission;
  });
  return {
    basePath: input.basePath,
    permissionPrefix: input.permissions.prefix,
    actions,
  };
}

export function validateCrudMeta(meta: CrudMeta) {
  if (!meta.basePath.startsWith("/")) {
    throw new Error(`CRUD basePath must start with "/": ${meta.basePath}`);
  }
  if (!meta.permissionPrefix) {
    throw new Error(`CRUD ${meta.basePath} is missing permissions.prefix`);
  }
  Object.entries(meta.actions).forEach(([action, permission]) => {
    if (permission === false) return;
    if (!permission) {
      throw new Error(`CRUD action ${meta.basePath}:${action} is missing permission`);
    }
    if (!/^system\.[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)+$/.test(permission)) {
      throw new Error(`CRUD permission has invalid format: ${permission}`);
    }
  });
}
