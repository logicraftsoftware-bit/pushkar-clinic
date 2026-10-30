export function routeSlug(value: string) {
  return value.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function isPlainNavigationClick(event:{button:number;ctrlKey:boolean;metaKey:boolean;shiftKey:boolean;altKey:boolean;defaultPrevented:boolean}){
  return event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&!event.defaultPrevented;
}

export function pageFromPath<T extends string>(pages: readonly T[], offset: number): T | undefined {
  const slug = window.location.pathname.split("/").filter(Boolean)[offset];
  return pages.find((page) => routeSlug(page) === slug);
}

export function updateBrowserPath(path: string, replace = false) {
  if (window.location.pathname === path) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  window.dispatchEvent(new Event("access-updated"));
}
