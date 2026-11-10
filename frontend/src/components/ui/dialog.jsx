import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Maximize2, Minimize2, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { confirmCloseDialog, isDialogDirty } from "@/components/UnsavedChanges"

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

// Altura máxima com rolagem interna (10/11/2026): só quando o conteúdo não
// cabe em 90% da altura da tela. Ligar sempre cortaria as listas de busca
// (Autocomplete), que abrem dentro da própria janela, nas janelas pequenas.
// Mede a soma dos blocos da janela (sem os posicionados por cima), não o
// scrollHeight, que contaria a lista aberta. Janelas que já definem altura
// ou rolagem própria (max-h-*, overflow-*) ficam como estão.
const OWN_SCROLL = /(^|\s)(max-h-|overflow-|h-\[)/
const TALL_RATIO = 0.9

// `el` é o elemento da janela (estado, não ref): o DialogContent fica montado
// com a janela fechada, e a medição precisa recomeçar quando ela abre.
function useTooTall(el, enabled) {
  const [tooTall, setTooTall] = React.useState(false)
  React.useEffect(() => {
    if (!enabled || !el || typeof ResizeObserver === "undefined") return undefined
    const measure = () => {
      const style = getComputedStyle(el)
      const gap = parseFloat(style.rowGap) || 0
      let height = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
      let blocks = 0
      for (const child of el.children) {
        const position = getComputedStyle(child).position
        if (position === "absolute" || position === "fixed") continue
        height += child.offsetHeight
        blocks += 1
      }
      height += gap * Math.max(0, blocks - 1)
      setTooTall(height > window.innerHeight * TALL_RATIO)
    }
    const resize = new ResizeObserver(measure)
    const observeAll = () => {
      resize.disconnect()
      resize.observe(el)
      for (const child of el.children) resize.observe(child)
    }
    const mutation = new MutationObserver(() => { observeAll(); measure() })
    observeAll()
    mutation.observe(el, { childList: true })
    window.addEventListener("resize", measure)
    measure()
    return () => {
      resize.disconnect()
      mutation.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [el, enabled])
  return enabled && tooTall
}

const readMaximized = () => {
  try { return localStorage.getItem(MAXIMIZED_KEY) === "1" } catch { return false }
}

const DialogContent = React.forwardRef(({ className, children, expandable, onEscapeKeyDown, onPointerDownOutside, onFocusOutside, ...props }, ref) => {
  const canExpand = expandable ?? WIDE_DIALOG.test(className || "")
  const [maximized, setMaximized] = React.useState(() => canExpand && readMaximized())
  const contentRef = React.useRef(null)
  const closeRef = React.useRef(null)
  const closingRef = React.useRef(false)
  const [contentEl, setContentEl] = React.useState(null)
  const tooTall = useTooTall(contentEl, !maximized && !OWN_SCROLL.test(className || ""))

  // Estável entre renders: grava estado, então não pode ser recriada a cada vez
  const setRefs = React.useCallback((node) => {
    contentRef.current = node
    setContentEl(node)
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }, [ref])

  // Com alteração não salva, Esc / clique fora / X perguntam antes de fechar
  // (components/UnsavedChanges). Confirmado, fecha pelo próprio X.
  const guardDismiss = (event, handler) => {
    handler?.(event)
    if (event.defaultPrevented || closingRef.current || !isDialogDirty(contentRef.current)) return
    event.preventDefault()
    confirmCloseDialog(contentRef.current).then((ok) => {
      if (!ok) return
      closingRef.current = true
      closeRef.current?.click()
      closingRef.current = false
    })
  }

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
      ref={setRefs}
      onEscapeKeyDown={(event) => guardDismiss(event, onEscapeKeyDown)}
      onPointerDownOutside={(event) => guardDismiss(event, onPointerDownOutside)}
      onFocusOutside={(event) => {
        onFocusOutside?.(event)
        if (isDialogDirty(contentRef.current)) event.preventDefault()
      }}
      data-maximized={maximized || undefined}
      className={cn(
        "form-dense fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        // Nunca mais larga que 95% da tela (a largura máxima de cada janela
        // continua valendo abaixo disso)
        "sm:w-[95vw]",
        className,
        tooTall && "max-h-[90dvh] overflow-y-auto",
        maximized && "w-screen sm:w-screen max-w-none sm:max-w-none h-[100dvh] max-h-[100dvh] sm:h-[100dvh] sm:max-h-[100dvh] rounded-none sm:rounded-none"
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
        ref={closeRef}
        onClick={(event) => guardDismiss(event)}
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
