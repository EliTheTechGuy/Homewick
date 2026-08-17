import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { StructuredData } from "@/components/StructuredData";

/** The public site. Admin deliberately sits outside this shell. */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <StructuredData />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
