import { useEffect, useState } from "react";

export type PlatformBranding = {
  name: string;
  logo: string;
};

const API_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");

export const defaultBranding: PlatformBranding = {
  name: "Pushkar Clinic ERP",
  logo: "/branding/pushkar-logo.png",
};

export function usePlatformBranding() {
  const [branding, setBranding] = useState<PlatformBranding>(defaultBranding);

  useEffect(() => {
    fetch(`${API_URL}/api/v1/branding`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((value) => setBranding({
        name: String(value.name || defaultBranding.name),
        logo: String(value.logo || defaultBranding.logo),
      }))
      .catch(() => undefined);
  }, []);

  return { branding, setBranding };
}
