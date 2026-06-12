import { PageHeader } from "./PageHeader";

type PageScaffoldProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export function PageScaffold({ title, description, actions, children }: PageScaffoldProps) {
  return (
    <div className="admin-page">
      <PageHeader title={title} description={description} actions={actions} />
      <div className="admin-page-content">{children}</div>
    </div>
  );
}
