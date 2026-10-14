import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

// Rótulo padrão dos campos: 13px, peso médio. Quem fica acima do campo usa
// "mb-1.5 block" (ou um pai com space-y-1.5) - ver components/FormKit.jsx.
const labelVariants = cva(
  "text-[13px] font-medium leading-none text-slate-700 dark:text-slate-300 peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
)

// "Nome *" -> o asterisco de campo obrigatório sai na cor de erro, igual em
// todas as telas, sem cada uma precisar montar o próprio <span>.
const withRequiredMark = (children) => {
  if (typeof children !== "string" || !children.endsWith(" *")) return children
  return (
    <>
      {children.slice(0, -2)} <span className="text-destructive" aria-hidden="true">*</span>
    </>
  )
}

const Label = React.forwardRef(({ className, children, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props}>
    {withRequiredMark(children)}
  </LabelPrimitive.Root>
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
