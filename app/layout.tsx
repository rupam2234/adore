import type { Metadata } from "next";
import { Geist, Geist_Mono, Roboto } from "next/font/google";
import { CartProvider, CartDrawer } from "@/components";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const roboto = Roboto({
  variable: "--font-geist-roboto",
  subsets: ["latin"],
  preload: true,
  weight: ["400", "200"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Adore | Wear Love",
    template: "%s | Adore",
  },
  description: "Clothes that become more yours with every wear",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${roboto.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <CartProvider>
          {children}
          <CartDrawer />
        </CartProvider>
      </body>
    </html>
  );
}
