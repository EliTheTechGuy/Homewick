import type { Metadata } from "next";
import "./globals.css";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: "Homewick Cleaning. Apartment cleaning in Dallas-Fort Worth",
    template: "%s | Homewick Cleaning",
  },
  description:
    "Membership apartment cleaning in the Dallas-Fort Worth metroplex. Two cleanings a month, one flat charge, the same cleaner whenever scheduling allows.",
  openGraph: {
    title: "Homewick Cleaning",
    description:
      "Membership apartment cleaning in the Dallas-Fort Worth metroplex. Two cleanings a month, one flat charge.",
    url: site.url,
    siteName: site.name,
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
