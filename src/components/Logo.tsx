import { Link } from "@tanstack/react-router";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-10 w-10" : "h-8 w-8";
  const text = size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";

  return (
    <Link to="/" className="flex items-center gap-2.5 group">
      <div
        className={`${dim} rounded-lg bg-gradient-primary shadow-glow flex items-center justify-center font-mono font-bold text-primary-foreground`}
      >
        IQ
      </div>
      <div className="flex flex-col leading-none">
        <span className={`${text} font-semibold tracking-tight`}>Invoice IQ</span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          GST Compliance
        </span>
      </div>
    </Link>
  );
}
