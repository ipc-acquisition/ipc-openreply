/**
 * Brand Logo
 *
 * IPC wordmark set in Inter, with the product label in mono as on the Media
 * Kit header ("ipc. / MEDIA KIT"). Text-only until the official logo file
 * lands in public/brand/.
 */

interface BrandLogoProps {
  product?: string;
  size?: "sm" | "lg";
}

export default function BrandLogo({ product = "Reply", size = "sm" }: BrandLogoProps) {
  const wordmark = size === "lg" ? "text-4xl" : "text-[1.375rem]";
  return (
    <span className="inline-flex items-baseline gap-2 select-none">
      <span className={`${wordmark} font-extrabold leading-none tracking-[-0.06em] text-foreground`}>
        ipc<span className="text-accent">.</span>
      </span>
      {product && (
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted">
          / {product}
        </span>
      )}
    </span>
  );
}
