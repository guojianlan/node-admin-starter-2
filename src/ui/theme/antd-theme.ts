import type { ThemeConfig } from "antd";
import { adminTokens } from "./tokens";

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: adminTokens.colorPrimary,
    colorBgLayout: adminTokens.colorBgLayout,
    colorBgContainer: adminTokens.colorBgContainer,
    colorText: adminTokens.colorText,
    colorTextSecondary: adminTokens.colorTextSecondary,
    colorBorder: adminTokens.colorBorder,
    colorSuccess: adminTokens.colorSuccess,
    colorWarning: adminTokens.colorWarning,
    colorError: adminTokens.colorError,
    borderRadius: adminTokens.borderRadius,
    fontSize: 14,
    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: adminTokens.colorBgContainer,
      siderBg: adminTokens.colorBgContainer,
      bodyBg: adminTokens.colorBgLayout,
    },
    Menu: {
      itemBorderRadius: 6,
      subMenuItemBorderRadius: 6,
      itemHeight: 42,
      itemMarginInline: 4,
      itemSelectedBg: "#e6f4ff",
      itemSelectedColor: adminTokens.colorPrimary,
    },
    Table: {
      headerBg: "#f8fafc",
      headerBorderRadius: 8,
      headerColor: "#172033",
      rowHoverBg: "#f8fbff",
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
