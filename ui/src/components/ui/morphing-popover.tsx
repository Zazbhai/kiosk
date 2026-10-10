import {
  useState,
  useId,
  useRef,
  useEffect,
  createContext,
  useContext,
  isValidElement,
} from 'react'
import {
  AnimatePresence,
  MotionConfig,
  motion,
  type Transition,
  type Variants,
} from 'motion/react'
import './morphing-popover.css'

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ')
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return
      handler()
    }
    document.addEventListener('mousedown', listener)
    document.addEventListener('touchstart', listener)
    return () => {
      document.removeEventListener('mousedown', listener)
      document.removeEventListener('touchstart', listener)
    }
  }, [ref, handler])
}

const TRANSITION: Transition = {
  type: 'spring',
  bounce: 0.12,
  duration: 0.38,
}

type MorphingPopoverContextValue = {
  isOpen: boolean
  open: () => void
  close: () => void
  uniqueId: string
  variants?: Variants
}

const MorphingPopoverContext =
  createContext<MorphingPopoverContextValue | null>(null)

export function useMorphingPopover() {
  const context = useContext(MorphingPopoverContext)
  if (!context) {
    throw new Error('useMorphingPopover must be used within MorphingPopover')
  }
  return context
}

function usePopoverLogic({
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
}: {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
} = {}) {
  const uniqueId = useId()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)

  const isOpen = controlledOpen ?? uncontrolledOpen

  const open = () => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(true)
    }
    onOpenChange?.(true)
  }

  const close = () => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(false)
    }
    onOpenChange?.(false)
  }

  return { isOpen, open, close, uniqueId }
}

export type MorphingPopoverProps = {
  children: React.ReactNode
  transition?: Transition
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  variants?: Variants
  className?: string
} & React.ComponentProps<'div'>

function MorphingPopover({
  children,
  transition = TRANSITION,
  defaultOpen,
  open,
  onOpenChange,
  variants,
  className,
  ...props
}: MorphingPopoverProps) {
  const popoverLogic = usePopoverLogic({ defaultOpen, open, onOpenChange })

  return (
    <MorphingPopoverContext.Provider value={{ ...popoverLogic, variants }}>
      <MotionConfig transition={transition}>
        <div
          className={cn('morphing-popover-root', className)}
          key={popoverLogic.uniqueId}
          {...props}
        >
          {children}
        </div>
      </MotionConfig>
    </MorphingPopoverContext.Provider>
  )
}

export type MorphingPopoverTriggerProps = {
  asChild?: boolean
  children: React.ReactNode
  className?: string
} & React.ComponentProps<typeof motion.button>

function MorphingPopoverTrigger({
  children,
  className,
  asChild = false,
  ...props
}: MorphingPopoverTriggerProps) {
  const context = useContext(MorphingPopoverContext)
  if (!context) {
    throw new Error(
      'MorphingPopoverTrigger must be used within MorphingPopover'
    )
  }

  if (asChild && isValidElement(children)) {
    const Component = children.type as any
    const MotionComponent = motion.create ? motion.create(Component) : motion(Component)
    const childProps = children.props as Record<string, unknown>

    return (
      <MotionComponent
        {...childProps}
        onClick={(e: React.MouseEvent) => {
          if (typeof childProps.onClick === 'function') {
            (childProps.onClick as any)(e)
          }
          context.open()
        }}
        layoutId={`popover-trigger-${context.uniqueId}`}
        className={cn(childProps.className as string, className)}
        key={context.uniqueId}
        aria-expanded={context.isOpen}
        aria-controls={`popover-content-${context.uniqueId}`}
      />
    )
  }

  return (
    <motion.div
      key={context.uniqueId}
      layoutId={`popover-trigger-${context.uniqueId}`}
      onClick={context.open}
      className="morphing-popover-trigger-wrap"
    >
      <motion.button
        {...props}
        layoutId={`popover-label-${context.uniqueId}`}
        key={context.uniqueId}
        className={cn('morphing-popover-trigger-btn', className)}
        aria-expanded={context.isOpen}
        aria-controls={`popover-content-${context.uniqueId}`}
      >
        {children}
      </motion.button>
    </motion.div>
  )
}

export type MorphingPopoverContentProps = {
  children: React.ReactNode
  className?: string
} & React.ComponentProps<typeof motion.div>

function MorphingPopoverContent({
  children,
  className,
  ...props
}: MorphingPopoverContentProps) {
  const context = useContext(MorphingPopoverContext)
  if (!context) {
    throw new Error(
      'MorphingPopoverContent must be used within MorphingPopover'
    )
  }

  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, context.close)

  useEffect(() => {
    if (!context.isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') context.close()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [context.isOpen, context.close])

  return (
    <AnimatePresence>
      {context.isOpen && (
        <>
          {/* Subtle frosted backdrop to focus user attention */}
          <motion.div
            className="morphing-popover-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={context.close}
          />
          <motion.div
            {...props}
            ref={ref}
            layoutId={`popover-trigger-${context.uniqueId}`}
            key={context.uniqueId}
            id={`popover-content-${context.uniqueId}`}
            role="dialog"
            aria-modal="true"
            className={cn('morphing-popover-card', className)}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={context.variants}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export type MorphingPopoverCloseProps = {
  asChild?: boolean
  children: React.ReactNode
  className?: string
} & React.ComponentProps<'button'>

function MorphingPopoverClose({
  children,
  className,
  asChild = false,
  ...props
}: MorphingPopoverCloseProps) {
  const context = useContext(MorphingPopoverContext)
  if (!context) {
    throw new Error('MorphingPopoverClose must be used within MorphingPopover')
  }

  if (asChild && isValidElement(children)) {
    const Component = children.type as any
    const MotionComponent = motion.create ? motion.create(Component) : motion(Component)
    const childProps = children.props as Record<string, unknown>

    return (
      <MotionComponent
        {...childProps}
        onClick={(e: React.MouseEvent) => {
          if (typeof childProps.onClick === 'function') {
            (childProps.onClick as any)(e)
          }
          context.close()
        }}
        className={cn(childProps.className as string, className)}
      />
    )
  }

  return (
    <button
      type="button"
      {...props}
      onClick={(e) => {
        props.onClick?.(e)
        context.close()
      }}
      className={className}
    >
      {children}
    </button>
  )
}

export {
  MorphingPopover,
  MorphingPopoverTrigger,
  MorphingPopoverContent,
  MorphingPopoverClose,
}
