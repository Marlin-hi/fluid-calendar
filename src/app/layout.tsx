import { Providers } from "@/components/providers";
import { metadata as baseMetadata, viewport as baseViewport } from "./metadata";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

export const metadata = baseMetadata;
export const viewport = baseViewport;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full overflow-x-hidden" suppressHydrationWarning>
      <body className="flex h-full flex-col bg-background antialiased overflow-x-hidden">
        <Providers>{children}</Providers>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
