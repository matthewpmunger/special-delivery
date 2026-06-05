import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Special Delivery",
  description: "A real-time rival-branch draw-and-guess game."
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const rtServerUrl = process.env.RT_SERVER_URL ?? process.env.NEXT_PUBLIC_RT_SERVER_URL ?? "";
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
