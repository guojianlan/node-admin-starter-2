"use client";

import { LeftOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useNavigationAdapter } from "@/platform/navigation";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { DictItemTable } from "./DictItemTable";

export function DictItemPage() {
  const navigation = useNavigationAdapter();
  const searchParams = new URLSearchParams(navigation.search);
  const dictId = Number(searchParams.get("dictId") || 0);
  const dictName = searchParams.get("dictName")
    ? decodeURIComponent(searchParams.get("dictName") || "")
    : "";
  const dictCode = searchParams.get("dictCode") || "";

  if (!dictId) {
    return (
      <PageScaffold title="字典项管理" description="请选择字典后再管理字典项">
        <div className="admin-card system-empty-tip admin-fill-workspace">未选择字典</div>
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      title="字典项管理"
      description="维护当前字典下的枚举项"
      actions={
        <Button type="link" icon={<LeftOutlined />} onClick={() => navigation.push("/system/dict")}>
          返回字典列表
        </Button>
      }
    >
      <DictItemTable dict={{ id: dictId, name: dictName, code: dictCode }} />
    </PageScaffold>
  );
}
