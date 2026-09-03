import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["mjml"],
  allowedDevOrigins: ["67b7-31-175-8-5.ngrok-free.app"],
};
export default config;
