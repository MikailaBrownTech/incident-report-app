import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CopyProvider } from "@/copy/provider";
import { getCopy } from "@/copy";
import { getSkin } from "@/lib/skin";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = getCopy(await getSkin());
  return { title: brand.name, description: brand.tagline };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const skin = await getSkin();
  return (
    <html
      lang="en"
      data-skin={skin}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <CopyProvider skin={skin}>{children}</CopyProvider>
      </body>
    </html>
  );
}
