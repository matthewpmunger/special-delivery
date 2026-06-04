import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Special Delivery",
  description: "A real-time rival-branch draw-and-guess game."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
