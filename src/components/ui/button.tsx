import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const variants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[transform,filter,background-color,border-color,color] duration-150 ease-out active:not-disabled:scale-[0.96] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
  {
    variants: {
      variant: {
        primary: "bg-primary text-bg shadow-glow hover:brightness-110",
        glass: "glass text-fg hover:border-primary",
        quiet: "text-muted hover:text-fg",
      },
      size: {
        md: "h-11 px-4 text-sm",
        lg: "h-12 px-5 text-base",
      },
    },
    defaultVariants: { variant: "glass", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof variants>) {
  return <button type={type} className={cn(variants({ variant, size }), className)} {...props} />;
}
