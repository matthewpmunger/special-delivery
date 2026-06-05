const WEBFLOW_BASE_PATH = "/games/special-delivery";

export function publicAssetUrl(path: string): string {
  if (!path.startsWith("/") || typeof window === "undefined") {
    return path;
  }

  return isWebflowMountedPath(window.location.pathname) ? `${WEBFLOW_BASE_PATH}${path}` : path;
}

function isWebflowMountedPath(pathname: string): boolean {
  return pathname === WEBFLOW_BASE_PATH || pathname.startsWith(`${WEBFLOW_BASE_PATH}/`);
}
