export type SeedRule = {
  id: number;
  parentId: number;
  type: "menu" | "route" | "action";
  key: string;
  name: string;
  path?: string | null;
  icon?: string | null;
  order: number;
  hidden?: number;
};

const moduleRules = [
  {
    route: {
      id: 10,
      parentId: 2,
      key: "system.user",
      name: "管理员",
      path: "/system/user",
      icon: "user",
      order: 10,
    },
    actions: [
      ["query", "查询用户"],
      ["create", "新增用户"],
      ["update", "编辑用户"],
      ["delete", "删除用户"],
      ["resetPassword", "重置密码"],
    ],
  },
  {
    route: {
      id: 20,
      parentId: 2,
      key: "system.role",
      name: "角色管理",
      path: "/system/role",
      icon: "role",
      order: 20,
    },
    actions: [
      ["query", "查询角色"],
      ["create", "新增角色"],
      ["update", "编辑角色"],
      ["delete", "删除角色"],
      ["setRule", "分配权限"],
      ["status", "切换状态"],
    ],
  },
  {
    route: {
      id: 30,
      parentId: 2,
      key: "system.rule",
      name: "菜单权限",
      path: "/system/rule",
      icon: "rule",
      order: 30,
    },
    actions: [
      ["query", "查询菜单"],
      ["create", "新增菜单"],
      ["update", "编辑菜单"],
      ["delete", "删除菜单"],
      ["hidden", "切换显隐"],
      ["status", "切换状态"],
    ],
  },
  {
    route: {
      id: 40,
      parentId: 2,
      key: "system.dept",
      name: "部门管理",
      path: "/system/dept",
      icon: "dept",
      order: 40,
    },
    actions: [
      ["query", "查询部门"],
      ["create", "新增部门"],
      ["update", "编辑部门"],
      ["delete", "删除部门"],
    ],
  },
  {
    route: {
      id: 50,
      parentId: 2,
      key: "system.dict",
      name: "字典管理",
      path: "/system/dict",
      icon: "dict",
      order: 50,
    },
    actions: [
      ["query", "查询字典"],
      ["create", "新增字典"],
      ["update", "编辑字典"],
      ["delete", "删除字典"],
    ],
  },
  {
    route: {
      id: 60,
      parentId: 2,
      key: "system.config",
      name: "系统配置",
      path: "/system/config",
      icon: "config",
      order: 60,
    },
    actions: [
      ["query", "查询配置"],
      ["create", "新增配置"],
      ["update", "编辑配置"],
      ["delete", "删除配置"],
      ["save", "保存配置"],
    ],
  },
  {
    route: {
      id: 70,
      parentId: 2,
      key: "system.file",
      name: "文件管理",
      path: "/system/file",
      icon: "file",
      order: 70,
    },
    actions: [
      ["query", "查询文件"],
      ["upload", "上传文件"],
      ["delete", "删除文件"],
      ["download", "下载文件"],
    ],
  },
] as const;

export const seedRules: SeedRule[] = [
  {
    id: 1,
    parentId: 0,
    type: "menu",
    key: "dashboard",
    name: "仪表盘",
    icon: "dashboard",
    order: 1,
  },
  {
    id: 3,
    parentId: 1,
    type: "route",
    key: "dashboard.analysis",
    name: "分析页",
    path: "/dashboard",
    icon: "analysis",
    order: 1,
  },
  {
    id: 4,
    parentId: 0,
    type: "menu",
    key: "example",
    name: "示例组件",
    icon: "example",
    order: 5,
  },
  {
    id: 5,
    parentId: 4,
    type: "menu",
    key: "example.table",
    name: "高级表格",
    icon: "table",
    order: 1,
  },
  {
    id: 6,
    parentId: 4,
    type: "menu",
    key: "example.form",
    name: "高级表单",
    icon: "form",
    order: 2,
  },
  {
    id: 2,
    parentId: 0,
    type: "menu",
    key: "system",
    name: "系统管理",
    icon: "system",
    order: 10,
  },
  ...moduleRules.flatMap((moduleItem) => {
    const route: SeedRule = {
      ...moduleItem.route,
      type: "route",
    };
    const actions: SeedRule[] = moduleItem.actions.map(([action, name], index) => ({
      id: moduleItem.route.id + index + 1,
      parentId: moduleItem.route.id,
      type: "action",
      key: `${moduleItem.route.key}.${action}`,
      name,
      order: index + 1,
      hidden: 0,
    }));
    return [route, ...actions];
  }),
];

export const seedDicts = [
  {
    id: 1,
    name: "状态",
    code: "status",
    items: [
      { label: "启用", value: "1", color: "green", sort: 1 },
      { label: "停用", value: "0", color: "red", sort: 2 },
    ],
  },
  {
    id: 2,
    name: "性别",
    code: "sex",
    items: [
      { label: "未知", value: "0", color: "default", sort: 1 },
      { label: "男", value: "1", color: "blue", sort: 2 },
      { label: "女", value: "2", color: "magenta", sort: 3 },
    ],
  },
  {
    id: 3,
    name: "菜单类型",
    code: "rule_type",
    items: [
      { label: "目录", value: "menu", color: "blue", sort: 1 },
      { label: "页面", value: "route", color: "green", sort: 2 },
      { label: "按钮", value: "action", color: "orange", sort: 3 },
    ],
  },
];
