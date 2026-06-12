import { Button, Result } from "antd";

export function ForbiddenPage() {
  return (
    <Result
      status="403"
      title="403"
      subTitle="你没有当前页面或操作权限"
      extra={
        <Button type="primary" href="/dashboard">
          返回首页
        </Button>
      }
    />
  );
}
