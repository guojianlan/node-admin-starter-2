import type { CrudMeta } from "./types";

export const crudMetas: CrudMeta[] = [];

export function registerCrudMeta(meta: CrudMeta) {
  const index = crudMetas.findIndex((item) => item.basePath === meta.basePath);
  if (index >= 0) {
    crudMetas[index] = meta;
    return;
  }
  crudMetas.push(meta);
}
