import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/manage"],
      },
    ],
    sitemap: "https://gatewayforai.com/sitemap.xml",
  };
}
