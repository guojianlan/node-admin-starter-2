import { PageHeader } from "./PageHeader";

type PageScaffoldProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  hideHeader?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function PageScaffold({
  title,
  description,
  actions,
  hideHeader = false,
  className,
  children,
}: PageScaffoldProps) {
  return (
    <div className={className ? `admin-page ${className}` : "admin-page"}>
      {hideHeader ? (
        <h1 className="admin-page-title admin-page-title-hidden">{title}</h1>
      ) : (
        <PageHeader title={title} description={description} actions={actions} />
      )}
      <div className="admin-page-content">{children}</div>
    </div>
  );
}
