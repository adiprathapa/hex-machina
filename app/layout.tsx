import type { Metadata } from "next";
import { headers } from "next/headers";
import { Fira_Code, Inter } from "next/font/google";
import "./globals.css";

// Inter over a geometric display face: this is an operator's instrument, and a
// friendly rounded grotesk reads as consumer marketing rather than a tool.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
});

const title = "Hex Machina | Cooperative Spell Debugging";
const description =
  "Build executable spell graphs with an agent. Preserve what you love, repair what breaks, and cast again.";

function safeOrigin(host: string | null, forwardedProtocol: string | null) {
  const safeHost = host && /^[a-z0-9.-]+(?::[0-9]+)?$/i.test(host)
    ? host
    : "localhost:3000";
  const protocol = forwardedProtocol === "https" || !safeHost.startsWith("localhost")
    ? "https"
    : "http";
  return `${protocol}://${safeHost}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const origin = safeOrigin(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    requestHeaders.get("x-forwarded-proto"),
  );
  const imageUrl = `${origin}/og.png`;

  return {
    title,
    description,
    icons: {
      icon: "/favicon.png",
      shortcut: "/favicon.png",
    },
    openGraph: {
      type: "website",
      title,
      description,
      images: [{ url: imageUrl, width: 1200, height: 630, alt: "Hex Machina spell graph with umbrella-equipped ducks and a blooming moonflower" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${firaCode.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
