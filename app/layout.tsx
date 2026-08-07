import "./globals.css";

export const metadata = {
  title: "Ask Peham's Docs — Vertex",
  description: "Internal docs assistant: RAG, OCR, citations, streaming",
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
