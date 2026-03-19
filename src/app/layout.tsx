import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Providers from "./providers";
import SideMenu from "./side-menu";
import NavTracker from "./nav-tracker";

// Local fonts (ضع الملفات داخل public/Fonts بنفس الأسماء)
const headingFont = localFont({
  src: "../../public/Fonts/Tajawal-Regular.ttf",
  variable: "--font-heading",
  display: "swap",
});

const bodyFont = localFont({
  src: "../../public/Fonts/majalla.ttf",
  variable: "--font-body",
  display: "swap",
});

const greetingFont = localFont({
  src: "../../public/Fonts/DTNASKH2.ttf",
  variable: "--font-greeting",
  display: "swap",
});

export const metadata: Metadata = {
  title: "مدرسة الشمامسة",
  description:
    "مدرسة الشمامسة بكاتدرائية مارمرقس الرسول بالكويت",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/Mdrstna.png",
    apple: "/Mdrstna.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body
        className={`${headingFont.variable} ${bodyFont.variable} ${greetingFont.variable} antialiased`}
        suppressHydrationWarning
      >
        <Providers>
          <div className="site-shell">
            <div className="site-content">
              <SideMenu />
              <NavTracker />
              {children}
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
