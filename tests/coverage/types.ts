export type CoverageMode = "automated" | "environment" | "manual" | "planned";

export type ApiTestCase = {
  operation: string;
  area: string;
  success: string[];
  failures: string[];
  dataAssertions: string[];
  security: string[];
  sideEffects: string[];
  coverage: CoverageMode;
};

export type PageTestCase = {
  path: string;
  area: string;
  data: {
    success: string;
    loading: string;
    empty: string;
    error: string;
  };
  interaction: {
    success: string;
    failure: string;
    permission: string;
  };
  visual: {
    desktop: string;
    narrow: string;
    light: string;
    dark: string;
  };
  coverage: CoverageMode | "mixed";
};
