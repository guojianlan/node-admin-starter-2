export type AdminPagePersistenceMode = "disabled" | "tabs" | "tabs-cache";

/**
 * disabled: single-page navigation without a visited-page bar.
 * tabs: keep visited tabs, but remount pages when switching.
 * tabs-cache: keep visited tabs and retain mounted page state in memory.
 */
export const ADMIN_PAGE_PERSISTENCE_MODE = "tabs-cache" as AdminPagePersistenceMode;

export const ADMIN_PAGE_TABS_ENABLED = ["tabs", "tabs-cache"].includes(ADMIN_PAGE_PERSISTENCE_MODE);
export const ADMIN_PAGE_CACHE_ENABLED = ADMIN_PAGE_PERSISTENCE_MODE === "tabs-cache";
export const ADMIN_PAGE_TAB_LIMIT = 16;
export const ADMIN_PAGE_HOME_PATH = "/dashboard";
