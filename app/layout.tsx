import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vertex",
  description: "Vertex — Ask Peham's Docs",
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* Extensions may inject attributes on body */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
