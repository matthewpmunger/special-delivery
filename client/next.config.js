/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@special-delivery/shared"],
  images: {
    unoptimized: true
  }
};

export default nextConfig;
