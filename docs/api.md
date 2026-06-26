# Admin Base API

All API routes are served under `/api`. Responses use a shared envelope:

```ts
type ApiResponse<T> = {
  success: boolean;
  msg: string;
  data?: T;
};
```

Paged list APIs return:

```ts
type PageResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};
```

Authenticated APIs require:

```http
Authorization: Bearer <token>
```

## Auth

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Basic health check |
| GET | `/api/ready` | Readiness checks without authentication |
| GET | `/api/system/login/options` | Login policy, captcha flag, public OAuth providers |
| GET | `/api/system/login/captcha` | Captcha SVG payload |
| POST | `/api/system/login` | Password login |
| POST | `/api/system/logout` | Logout current token |
| GET | `/api/system/info` | Current user, access codes, data scope |
| GET | `/api/system/menu` | Current user menus |
| POST | `/api/system/password-reset/request` | Request password reset mail |
| POST | `/api/system/password-reset/confirm` | Confirm password reset |

## System Modules

CRUD factory modules use the standard list/create/update/delete contract:

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/system/<resource>` | Paged query |
| POST | `/api/system/<resource>` | Create |
| PUT | `/api/system/<resource>/:id` | Update |
| DELETE | `/api/system/<resource>/:id` | Delete |
| POST | `/api/system/<resource>/batch-delete` | Batch delete |

Common query parameters:

```text
page=1&pageSize=20&keyword=admin&sortField=id&sortOrder=desc
```

Implemented resources:

- `/api/system/user`
- `/api/system/role`
- `/api/system/rule`
- `/api/system/dept`
- `/api/system/dict/list`
- `/api/system/dict/item`
- `/api/system/config/group`
- `/api/system/config/items`
- `/api/system/storage`
- `/api/system/mail/account`
- `/api/system/notice`

## Non-CRUD System APIs

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/system/doctor` | Authenticated production readiness check |
| PUT | `/api/system/config/items/save` | Save typed config values by key |
| POST | `/api/system/config/items/refreshCache` | Refresh config cache placeholder |
| PUT | `/api/system/user/password` | Admin reset user password |
| GET | `/api/system/role/:id/rules` | Role permission tree |
| PUT | `/api/system/role/rules` | Assign role permissions |
| PUT | `/api/system/rule/status/:id` | Toggle menu status |
| PUT | `/api/system/rule/hidden/:id` | Toggle menu visibility |
| POST | `/api/system/file/list/upload` | Upload file |
| GET | `/api/system/file/list/download/:id` | Download file |
| GET | `/api/system/file/list/trash` | Query file trash |
| PUT | `/api/system/file/list/rename/:id` | Rename file |
| PUT | `/api/system/file/list/move` | Move files |
| POST | `/api/system/file/list/copy` | Copy files |
| DELETE | `/api/system/file/list/clean-trash` | Clean file trash |
| PUT | `/api/system/storage/status/:id` | Toggle storage status |
| PUT | `/api/system/storage/default/:id` | Set default storage |
| POST | `/api/system/storage/test` | Test storage connection |
| PUT | `/api/system/mail/account/status/:id` | Toggle mail account status |
| PUT | `/api/system/mail/account/default/:id` | Set default mail account |
| POST | `/api/system/mail/account/test` | Send test mail |
| GET | `/api/system/operation/log` | Query operation logs |
| GET | `/api/system/login/log` | Query login logs |
| DELETE | `/api/system/login/log/clean` | Clean login logs |
| GET | `/api/system/online/user` | Query online sessions |
| DELETE | `/api/system/online/user/:id` | Force token offline |
| DELETE | `/api/system/online/user/clean-expired` | Clean expired tokens |
| GET | `/api/system/profile` | Current user profile |
| PUT | `/api/system/profile` | Update current user profile |
| PUT | `/api/system/profile/password` | Change current password |
| POST | `/api/system/profile/avatar` | Upload current avatar |
| GET | `/api/system/profile/login-records` | Current user login records |
| PUT | `/api/system/notice/publish/:id` | Publish notice |
| PUT | `/api/system/notice/revoke/:id` | Revoke notice |
| GET | `/api/system/notice/my` | Current user notices |
| GET | `/api/system/notice/my/unread-count` | Current user unread count |
| POST | `/api/system/notice/my/:id/read` | Mark one notice read |
| POST | `/api/system/notice/my/read-all` | Mark visible notices read |

## Permission Rules

- `sys_rule` is the source of truth for menu and action permissions.
- `src/router/route-manifest.ts` binds frontend pages to permission codes.
- CRUD routes must declare permissions through the CRUD factory config.
- `pnpm admin:check-routes` fails if route manifest, seed rules, or CRUD permissions diverge.
