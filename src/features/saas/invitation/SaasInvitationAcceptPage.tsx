"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Space, Typography } from "antd";
import { request } from "@/lib/request";
import { useNavigationAdapter } from "@/platform/navigation";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

export function SaasInvitationAcceptPage() {
  const navigation = useNavigationAdapter();
  const queryClient = useQueryClient();
  const queryToken = useMemo(
    () => new URLSearchParams(navigation.search).get("token") ?? "",
    [navigation.search],
  );
  const [token, setToken] = useState(queryToken);
  const [accepted, setAccepted] = useState(false);
  const mutation = useMutation({
    mutationFn: () =>
      request<{ tenantId: number; workspaceId: number | null }>("/api/saas/invitations/accept", {
        method: "POST",
        body: { token: token.trim() },
      }),
    onSuccess: async () => {
      setAccepted(true);
      feedback.success("邀请已接受");
      await queryClient.invalidateQueries({ queryKey: ["saas"] });
    },
  });

  return (
    <PageScaffold title="接受 SaaS 邀请" description="将邀请绑定到当前已登录且邮箱一致的系统账号">
      <Space direction="vertical" size="middle" style={{ width: "100%", maxWidth: 720 }}>
        {accepted ? (
          <Alert
            type="success"
            showIcon
            message="邀请已接受"
            description="新的 Tenant/Workspace 上下文已加入当前账号。"
          />
        ) : (
          <Alert
            type="info"
            showIcon
            message="安全校验"
            description="服务端只接受未过期、未撤销的邀请；当前账号必须已绑定与邀请完全一致的邮箱。"
          />
        )}
        <Typography.Text strong>邀请 Token</Typography.Text>
        <Input.TextArea
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoSize={{ minRows: 3, maxRows: 6 }}
          disabled={accepted}
        />
        <Button
          type="primary"
          loading={mutation.isPending}
          disabled={accepted || token.trim().length < 20}
          onClick={() => mutation.mutate()}
        >
          接受邀请
        </Button>
      </Space>
    </PageScaffold>
  );
}
