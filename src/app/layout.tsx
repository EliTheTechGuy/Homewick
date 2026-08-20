import type { Metadata } from "next";
import "./globals.css";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: "Homewick Cleaning. Home and apartment cleaning in Dallas-Fort Worth",
    template: "%s | Homewick Cleaning",
  },
  description:
    "House and apartment cleaning in the Dallas-Fort Worth metroplex. Flat published rates for apartments, houses quoted by square footage, and a membership if you want it handled every month.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Homewick Cleaning",
    description:
      "House and apartment cleaning in the Dallas-Fort Worth metroplex. Flat rates for apartments, houses quoted.",
    url: site.url,
    siteName: site.name,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Homewick Cleaning",
    description:
      "House and apartment cleaning in the Dallas-Fort Worth metroplex. Flat rates for apartments, houses quoted.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
