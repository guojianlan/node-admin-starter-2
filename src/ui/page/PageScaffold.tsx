import { PageHeader } from "./PageHeader";

type PageScaffoldProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  hideHeader?: boolean;
  children: React.ReactNode;
};

export function PageScaffold({
  title,
  description,
  actions,
  hideHeader = false,
  children,
}: PageScaffoldProps) {
  return (
    <div className="admin-page">
      {hideHeader ? null : <PageHeader title={title} description={description} actions={actions} />}
      <div className="admin-page-content">{children}</div>
    </div>
  );
}
