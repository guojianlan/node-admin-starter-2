export type PageTab = {
  path: string;
  href: string;
  title: string;
  closable: boolean;
};

const storageKey = "admin-base-page-tabs";

function isHrefForPath(href: string, path: string) {
  return href === path || href.startsWith(`${path}?`) || href.startsWith(`${path}#`);
}

export function readStoredPageTabs(): PageTab[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as PageTab[];
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item) =>
              item &&
              typeof item.path === "string" &&
              item.path.startsWith("/") &&
              typeof item.href === "string",
          )
          .map((item) => ({
            path: item.path,
            href: isHrefForPath(item.href, item.path) ? item.href : item.path,
            title: typeof item.title === "string" && item.title.trim() ? item.title : "页面",
            closable: Boolean(item.closable),
          }))
      : [];
  } catch {
    return [];
  }
}

export function writeStoredPageTabs(tabs: PageTab[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(tabs));
}

export function getRememberedPageHref(path: string) {
  return readStoredPageTabs().find((tab) => tab.path === path)?.href ?? path;
}
