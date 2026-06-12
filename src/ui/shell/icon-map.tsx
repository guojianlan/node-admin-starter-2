import {
  ApartmentOutlined,
  AppstoreOutlined,
  AreaChartOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileOutlined,
  FolderOutlined,
  FormOutlined,
  SafetyOutlined,
  SettingOutlined,
  TableOutlined,
  TagsOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";

const iconMap: Record<string, React.ReactNode> = {
  dashboard: <DashboardOutlined />,
  analysis: <AreaChartOutlined />,
  example: <AppstoreOutlined />,
  table: <TableOutlined />,
  form: <FormOutlined />,
  system: <SettingOutlined />,
  user: <UserOutlined />,
  role: <TeamOutlined />,
  rule: <SafetyOutlined />,
  dept: <ApartmentOutlined />,
  dict: <TagsOutlined />,
  config: <DatabaseOutlined />,
  file: <FileOutlined />,
};

export function renderMenuIcon(icon?: string | null) {
  if (!icon) return <FolderOutlined />;
  return iconMap[icon] ?? <FolderOutlined />;
}
