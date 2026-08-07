/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse's old bundled pdf.js failed under Next.js ("bad XRef entry" on
  // valid PDFs). unpdf ships a serverless pdf.js build that IS meant to be
  // webpack-bundled — do NOT externalize it (externalized it extracts nothing).
  serverExternalPackages: [],
  // Self-contained server output for the Docker image (Dockerfile builds on
  // this): emits .next/standalone with a minimal server.js + node_modules.
  output: "standalone",
};

export default nextConfig;
