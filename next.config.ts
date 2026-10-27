import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "docx", "pdfkit"],
  poweredByHeader: false,
};

export default nextConfig;
