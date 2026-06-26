export type AdminUserContext = {
  id: number;
  username: string;
  nickname: string;
  email?: string | null;
  mobile?: string | null;
  deptId?: number | null;
  status: number;
  mustChangePassword?: boolean;
};

export type HonoVariables = {
  user: AdminUserContext;
  abilities: string[];
  tokenHash: string;
  requestId: string;
};
