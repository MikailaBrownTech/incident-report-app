import type { Metadata } from "next";
import { IBM_Plex_Sans, IM_Fell_English } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { CopyProvider } from "@/copy/provider";
import { getCopy } from "@/copy";
import { getSkin } from "@/lib/skin";
import "./globals.css";

const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const fell = IM_Fell_English({
  variable: "--font-fell",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = getCopy(await getSkin());
  return { title: brand.name, description: brand.tagline };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const skin = await getSkin();
  return (
    <html lang="en" data-skin={skin} className={`${plex.variable} ${fell.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <CopyProvider skin={skin}>
          <ToastProvider>{children}</ToastProvider>
        </CopyProvider>
      </body>
    </html>
  );
}
