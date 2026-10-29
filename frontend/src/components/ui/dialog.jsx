import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Maximize2, Minimize2, X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

// Janelas largas (tabelas, formulários grandes) ganham o botão "Tela cheia".
// A escolha fica lembrada no navegador e vale para as próximas janelas.
const WIDE_DIALOG = /(^|\s)(sm:|md:|lg:)?max-w-(4xl|5xl|6xl|7xl)(\s|$)/
const MAXIMIZED_KEY = "dialog-maximized"

const readMaximized = () => {
  try { return localStorage.getItem(MAXIMIZED_KEY) === "1" } catch { return false }
}

const DialogContent = React.forwardRef(({ className, children, expandable, ...props }, ref) => {
  const canExpand = expandable ?? WIDE_DIALOG.test(className || "")
  const [maximized, setMaximized] = React.useState(() => canExpand && readMaximized())

  const toggleMaximized = () => {
    setMaximized((prev) => {
      try { localStorage.setItem(MAXIMIZED_KEY, prev ? "0" : "1") } catch { /* sem armazenamento: só vale nesta janela */ }
      return !prev
    })
  }

  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-maximized={maximized || undefined}
      className={cn(
        "form-dense fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className,
        maximized && "w-screen max-w-none sm:max-w-none h-[100dvh] max-h-[100dvh] sm:h-[100dvh] sm:max-h-[100dvh] rounded-none sm:rounded-none"
      )}
      {...props}>
      {children}
      {canExpand && (
        <button
          type="button"
          onClick={toggleMaximized}
          title={maximized ? "Sair da tela cheia" : "Tela cheia"}
          aria-label={maximized ? "Sair da tela cheia" : "Tela cheia"}
          data-testid="dialog-maximize"
          className="absolute right-11 top-4 hidden sm:block rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      )}
      <DialogPrimitive.Close
        className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Fechar</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
