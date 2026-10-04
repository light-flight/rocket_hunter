import { type ComponentProps, type ReactNode, useId } from 'react'
import { useKeyboardInset } from './keyboard.ts'

// The building blocks every screen is made of. The rules they follow are in STYLE.md.

type MainActionProps = {
  // Renders a link that looks like the key: only a real link hands over to another app.
  href?: string
  newTab?: boolean
  // Sends the form it is in: the return key of the keyboard does the same.
  submit?: boolean
  // Not the main action of the screen it is on: drawn without the pink.
  secondary?: boolean
  children: ReactNode
  onClick?: () => void
} & Pick<ComponentProps<'button'>, 'disabled'>

// The one main action of a screen.
export function MainAction({
  href,
  newTab = false,
  submit = false,
  secondary = false,
  children,
  onClick,
  disabled,
}: MainActionProps) {
  const className =
    'flex h-15 w-full shrink-0 items-center justify-center gap-2.5 rounded-lg px-4 text-key font-semibold ' +
    'tracking-key uppercase active:opacity-70 disabled:opacity-50 ' +
    (secondary ? 'bg-control text-fg ring-1 ring-line ring-inset' : 'bg-action text-on-action shadow-key')

  if (href !== undefined) {
    return (
      <a
        href={href}
        {...(newTab && { target: '_blank', rel: 'noopener' })}
        onClick={onClick}
        className={className}
      >
        {children}
      </a>
    )
  }
  return (
    <button type={submit ? 'submit' : 'button'} className={className} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

// The bottom of a screen that holds its main action, above the keyboard when there is one.
export function ActionArea({ children }: { children: ReactNode }) {
  const keyboard = useKeyboardInset()

  return (
    <div className="mt-auto flex flex-col gap-3 pt-6" style={{ paddingBottom: keyboard }}>
      {children}
    </div>
  )
}

type TextFieldProps = { label: string } & Omit<ComponentProps<'input'>, 'id' | 'className'>

// A field with its label above it.
export function TextField({ label, ...input }: TextFieldProps) {
  const id = useId()

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-fg-3">
        {label}
      </label>
      <input
        id={id}
        {...input}
        className="h-14 rounded-lg bg-field px-4 text-name ring-1 ring-line outline-none ring-inset placeholder:text-fg-3 focus:ring-fg-2"
      />
    </div>
  )
}

type BackLinkProps = { children: ReactNode; onClick: () => void; arrow?: boolean; label?: string }

// A way back, at the top left of a screen. label names where it goes when the text says
// something else (the race it leaves).
export function BackLink({ children, onClick, arrow = false, label }: BackLinkProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`-ml-3 flex h-11 items-center self-start pr-3 text-body text-fg-2 active:opacity-70 ${arrow ? 'pl-1.5' : 'pl-3'}`}
    >
      {arrow && <ChevronLeft />}
      {children}
    </button>
  )
}

// A menu raised over the screen, by the key or the corridor it opens from.
export const SHEET = 'rounded-xl bg-sheet text-fg shadow-[0_0_0_1px_var(--color-line),0_18px_40px_rgb(0_0_0/0.8)]'

const ICON = 'shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round]'

export function Plus() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-5 stroke-[2.4] ${ICON}`}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-5.5 stroke-2 ${ICON}`}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}

export function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-5 stroke-2 text-fg-3 ${ICON}`}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

// A cloud with an exclamation mark: made here, not on the server yet.
export function NotSent() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-4 stroke-[1.8] ${ICON}`}>
      <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.5 4.25 4.25 0 0 0 7 18z" />
      <path d="M12 10.5v3.5M12 16.5v.01" />
    </svg>
  )
}

// The paper plane of the Telegram logo without its circle, in the colour of the text around it.
export function TelegramMark() {
  return (
    <svg viewBox="4.536 7.224 13.032 10.8" aria-hidden="true" className="h-4 shrink-0 fill-current">
      <path d="M16.906 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

// A paperclip: files are attached.
export function Paperclip() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-5 stroke-[2.2] ${ICON}`}>
      <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </svg>
  )
}

// A page with a corner turned down: a protocol.
export function Protocol() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-5 stroke-[1.8] ${ICON}`}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  )
}

export function Check() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-4 stroke-2 ${ICON}`}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

// Work going on elsewhere: a quarter of a ring that turns.
export function Spinner() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-4 animate-spin stroke-2 ${ICON}`}>
      <circle cx="12" cy="12" r="8" strokeOpacity={0.3} />
      <path d="M12 4a8 8 0 0 1 8 8" />
    </svg>
  )
}

// Something the manager should look at: a triangle with an exclamation mark.
export function Attention() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-4 stroke-[1.8] ${ICON}`}>
      <path d="M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17v.01" />
    </svg>
  )
}

export function Undo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-5.5 stroke-2 ${ICON}`}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}

export function Redo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-5.5 stroke-2 ${ICON}`}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </svg>
  )
}

// A clock with an arrow going back round it: what was done, and when.
export function History() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-5.5 stroke-2 ${ICON}`}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
      <path d="M3.5 4v4.5H8" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

// Three dots: more that does not fit on the screen.
export function More() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-6 stroke-[2.6] ${ICON}`}>
      <path d="M5 12h.01M12 12h.01M19 12h.01" />
    </svg>
  )
}

export function ArrowUp() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-4 stroke-2 ${ICON}`}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  )
}
