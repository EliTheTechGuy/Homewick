import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

/** The public site. Admin deliberately sits outside this shell. */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {/* First thing in the tab order, hidden until focused. Without it a
          keyboard user tabs the whole header on every page before reaching
          anything they came for. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-navy focus:px-5 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}
