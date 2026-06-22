import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const defaultDatabaseUrl = "postgres://admin_base:admin_base@localhost:5432/admin_base";

export const sql = postgres(process.env.DATABASE_URL ?? defaultDatabaseUrl, {
  max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
  onnotice: () => {},
  prepare: false,
});

export const db = drizzle(sql, { schema });
export { schema };

export type QueryParam = string | number | boolean | null | Date | Uint8Array;
type QueryResultRow = Record<string, unknown>;
type SqlExecutor = postgres.Sql | postgres.TransactionSql;

const aliasMap: Record<string, string> = {
  abilitiesjson: "abilitiesJson",
  createdat: "createdAt",
  createdby: "createdBy",
  datascope: "dataScope",
  defaultauth: "defaultAuth",
  deletedat: "deletedAt",
  deletedby: "deletedBy",
  deptid: "deptId",
  deptname: "deptName",
  dictid: "dictId",
  displayname: "displayName",
  expiresat: "expiresAt",
  fromemail: "fromEmail",
  fromname: "fromName",
  groupid: "groupId",
  groupname: "groupName",
  haspassword: "hasPassword",
  hassecretkey: "hasSecretKey",
  i18nkey: "i18nKey",
  isdefault: "isDefault",
  issystem: "isSystem",
  lastusedat: "lastUsedAt",
  metadatajson: "metadataJson",
  originalname: "originalName",
  parentid: "parentId",
  passwordencrypted: "passwordEncrypted",
  passwordhash: "passwordHash",
  propsjson: "propsJson",
  optionsjson: "optionsJson",
  replyto: "replyTo",
  roleids: "roleIds",
  rolenames: "roleNames",
  ruleids: "ruleIds",
  secretkeyencrypted: "secretKeyEncrypted",
  storageid: "storageId",
  storagename: "storageName",
  thumbnailpath: "thumbnailPath",
  thumbnailurl: "thumbnailUrl",
  tokenhash: "tokenHash",
  updatedat: "updatedAt",
  updatedby: "updatedBy",
  uploaderid: "uploaderId",
  useragent: "userAgent",
  usercount: "userCount",
  userid: "userId",
};

function normalizeRowAliases(row: QueryResultRow) {
  for (const [key, value] of Object.entries(row)) {
    const alias = aliasMap[key];
    if (alias && !(alias in row)) {
      row[alias] = value;
    }
  }
  return row;
}

function toPostgresSql(query: string) {
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  return query.replace(/./g, (char, offset) => {
    const previous = query[offset - 1];
    if (char === "'" && !inDoubleQuote && previous !== "\\") {
      inSingleQuote = !inSingleQuote;
      return char;
    }
    if (char === '"' && !inSingleQuote && previous !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      return char;
    }
    if (char === "?" && !inSingleQuote && !inDoubleQuote) {
      index += 1;
      return `$${index}`;
    }
    return char;
  });
}

async function execute(client: SqlExecutor, query: string, params: QueryParam[] = []) {
  const rows = await client.unsafe<QueryResultRow[]>(toPostgresSql(query), params);
  return rows.map(normalizeRowAliases);
}

export type RunResult = {
  changes: number;
  lastInsertRowid: number;
};

export function createDbClient(client: SqlExecutor) {
  return {
    prepare(query: string) {
      return {
        all: async (...params: QueryParam[]) => (await execute(client, query, params)) as unknown[],
        get: async (...params: QueryParam[]) => {
          const rows = await execute(client, query, params);
          return rows[0] as unknown | undefined;
        },
        run: async (...params: QueryParam[]): Promise<RunResult> => {
          const rows = await execute(client, query, params);
          const result = rows as typeof rows & { count?: number };
          const firstRow = rows[0] as { id?: number } | undefined;
          return {
            changes: result.count ?? rows.length,
            lastInsertRowid: Number(firstRow?.id ?? 0),
          };
        },
      };
    },
    exec(query: string) {
      return client.unsafe<QueryResultRow[]>(query);
    },
  };
}

export type DbClient = ReturnType<typeof createDbClient>;

export const sqlite = {
  ...createDbClient(sql),
  transaction<T>(callback: (tx: DbClient) => Promise<T>) {
    return sql.begin((transaction) => callback(createDbClient(transaction)));
  },
};

export async function closeDb() {
  await sql.end({ timeout: 5 });
}

export function nowIso() {
  return new Date().toISOString();
}
