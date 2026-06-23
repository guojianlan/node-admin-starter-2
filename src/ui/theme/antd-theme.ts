import { theme, type ThemeConfig } from "antd";
import { adminTokens } from "./tokens";
import type { AdminThemeMode } from "@/ui/preferences";

export function createAntdTheme(mode: AdminThemeMode): ThemeConfig {
  const isDark = mode === "dark";
  return {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
  token: {
    colorPrimary: adminTokens.colorPrimary,
      colorBgLayout: isDark ? "#10131a" : adminTokens.colorBgLayout,
      colorBgContainer: isDark ? "#171b24" : adminTokens.colorBgContainer,
      colorText: isDark ? "rgba(245, 247, 250, 0.92)" : adminTokens.colorText,
      colorTextSecondary: isDark ? "rgba(245, 247, 250, 0.62)" : adminTokens.colorTextSecondary,
      colorBorder: isDark ? "#2a3140" : adminTokens.colorBorder,
    colorSuccess: adminTokens.colorSuccess,
    colorWarning: adminTokens.colorWarning,
    colorError: adminTokens.colorError,
    borderRadius: adminTokens.borderRadius,
    fontSize: 14,
    wireframe: false,
  },
  components: {
    Layout: {
        headerBg: isDark ? "#171b24" : adminTokens.colorBgContainer,
        siderBg: isDark ? "#171b24" : adminTokens.colorBgContainer,
        bodyBg: isDark ? "#10131a" : adminTokens.colorBgLayout,
    },
    Menu: {
      itemBorderRadius: 6,
      subMenuItemBorderRadius: 6,
      itemHeight: 42,
      itemMarginInline: 4,
        itemSelectedBg: isDark ? "rgba(22, 119, 255, 0.18)" : "#e6f4ff",
      itemSelectedColor: adminTokens.colorPrimary,
    },
    Table: {
        headerBg: isDark ? "#1f2633" : "#f8fafc",
      headerBorderRadius: 8,
        headerColor: isDark ? "rgba(245, 247, 250, 0.9)" : "#172033",
        rowHoverBg: isDark ? "#1b2230" : "#f8fbff",
    },
    Card: {
      borderRadiusLG: adminTokens.borderRadius,
      paddingLG: 20,
    },
    Modal: {
      borderRadiusLG: adminTokens.borderRadius,
    },
    Button: {
      borderRadius: 6,
      controlHeight: 32,
    },
    Input: {
      borderRadius: 6,
    },
    Select: {
      borderRadius: 6,
    },
    Drawer: {
      paddingLG: 20,
    },
  },
};
}
