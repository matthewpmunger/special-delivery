import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Special Delivery",
  description: "A real-time rival-branch draw-and-guess game."
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const rtServerUrl = readRuntimeEnv("RT_SERVER_URL") ?? readRuntimeEnv("NEXT_PUBLIC_RT_SERVER_URL") ?? "";
  const runtimeConfig = JSON.stringify({ rtServerUrl }).replace(/</g, "\\u003c");

  return (
    <html lang="en">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__SPECIAL_DELIVERY_CONFIG__=${runtimeConfig};`
          }}
        />
        {children}
      </body>
    </html>
  );
}

function readRuntimeEnv(name: "RT_SERVER_URL" | "NEXT_PUBLIC_RT_SERVER_URL"): string | undefined {
  const cloudflareValue = readCloudflareEnv(name);
  if (cloudflareValue) {
    return cloudflareValue;
  }

  const processValue = process.env[name];
  return processValue ? processValue : undefined;
}

function readCloudflareEnv(name: string): string | undefined {
  try {
    const value = (getCloudflareContext().env as Record<string, unknown>)[name];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}
