import { Space } from "antd";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="admin-page-header">
      <div style={{ minWidth: 0 }}>
        <h1 className="admin-page-title">{title}</h1>
        {description ? <span className="admin-page-description">{description}</span> : null}
      </div>
      {actions ? <Space wrap>{actions}</Space> : null}
    </div>
  );
}
