// Reusable CyberSentinel logo mark — the gradient hexagon + security shield.
// Backed by /public/icon.svg so it stays in sync with the favicon and brand assets.

interface LogoMarkProps {
  className?: string;
}

/** Just the mark (hexagon + shield). Size via className, e.g. "w-10 h-10". */
export function LogoMark({ className = "w-10 h-10" }: LogoMarkProps) {
  return <img src="/icon.svg" alt="CyberSentinel" className={className} draggable={false} />;
}

interface LogoProps {
  className?: string;
  markClassName?: string;
  /** wordmark text color class, e.g. "text-foreground" (light) or "text-background" (dark) */
  textClassName?: string;
}

/** Mark + "CyberSentinel" wordmark lockup. */
export function Logo({
  className = "flex items-center gap-2",
  markClassName = "w-10 h-10",
  textClassName = "text-foreground",
}: LogoProps) {
  return (
    <span className={className}>
      <LogoMark className={markClassName} />
      <span className={`font-heading font-bold text-xl ${textClassName}`}>CyberSentinel</span>
    </span>
  );
}
