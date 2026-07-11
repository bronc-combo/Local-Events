import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Daily Overview",
  description: "A simple daily dashboard starter for Houston, TX 77009.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
