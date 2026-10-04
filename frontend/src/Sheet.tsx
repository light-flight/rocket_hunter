import {
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { useKeyboardInset } from './keyboard.ts'
import { dimStatusBar } from './theme.ts'

// A sheet that slides up from the bottom of the screen, as in the phone's own apps. It has no title:
// its top is a bar, and a wide place round the bar to take it by: pulled up it opens a long sheet to
// the whole screen, pulled down it closes. It also closes by a tap on the dimmed screen above it and
// by Escape; it has no key to close it but for those who listen to the screen. The screen under it
// stays still, and the sheet stands above the keyboard.

// How long a sheet takes to move, and how it moves: fast at first, then easing in, as the phone's own.
const MOVE_MS = 300
const MOVE = 'duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]'
// A long sheet opens to this much of the screen first, and to all but its top edge when pulled up.
const HALF = 0.6
const full = (keyboard: number) => `calc(100dvh - env(safe-area-inset-top) - 0.75rem - ${keyboard}px)`
// How far ahead a flick of the finger carries the sheet, in milliseconds of its speed at the end.
const FLICK_MS = 120
// A pull shorter than this is a tap on the bar.
const TAP_PX = 4

export type SheetHandle = { close: () => void }

type SheetProps = {
  // What the sheet is called, for those who listen to the screen.
  label: string
  // A field typed in at once: it has the keyboard from the tap that opened the sheet, so the sheet
  // is there at once rather than sliding in.
  focus?: RefObject<HTMLElement | null>
  children: ReactNode
  onClose: () => void
  ref?: Ref<SheetHandle>
}

type Pull = { pointer: number; from: number; height: number; trail: { y: number; t: number }[] }

export function Sheet({ label, focus, children, onClose, ref }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const pull = useRef<Pull | null>(null)
  // Below the screen until it has slid in, and again on its way out.
  const [shown, setShown] = useState(focus !== undefined)
  const keyboard = useKeyboardInset()
  // A sheet stands above the keyboard once a field in it has had the focus: a sheet with no field
  // has no keyboard, and a strip the browser keeps at the bottom of the screen is none (Chrome on
  // iPhone). It follows the keyboard down as it goes, not the focus: a tap on a key takes the focus
  // from the field before the click, and the key must not move away under the finger then.
  const [typing, setTyping] = useState(false)
  const lift = typing ? keyboard : 0
  const dimmed = useRef(false)
  const [expanded, setExpanded] = useState(false)
  // How far the finger has taken the sheet from the height it had: down by its offset, up by the
  // height it adds.
  const [moved, setMoved] = useState<{ down: number; up: number; height: number } | null>(null)
  const closing = useRef(false)

  useImperativeHandle(ref, () => ({ close }))

  useEffect(() => {
    dialog.current?.showModal()
    lockScroll()
    dimStatusBar(true)
    dimmed.current = true
    focus?.current?.focus({ preventScroll: true })
    // Laid out below the screen first, so that it slides in from there.
    panel.current?.getBoundingClientRect()
    const frame = requestAnimationFrame(() => setShown(true))
    return () => {
      cancelAnimationFrame(frame)
      unlockScroll()
      undim()
    }
  }, [focus])

  // The status bar of an Android phone lightens as the sheet goes, with the screen.
  function undim() {
    if (!dimmed.current) return
    dimmed.current = false
    dimStatusBar(false)
  }

  function close() {
    if (closing.current) return
    closing.current = true
    setMoved(null)
    setShown(false)
    undim()
    window.setTimeout(() => dialog.current?.close(), MOVE_MS)
  }

  // The sheet's height with nothing cut off, and the height a long one opens to.
  function natural(): number {
    const sheet = panel.current
    const inside = body.current
    return sheet && inside ? sheet.offsetHeight - inside.clientHeight + inside.scrollHeight : 0
  }
  const half = () => window.innerHeight * HALF

  function start(event: PointerEvent<HTMLDivElement>) {
    if (pull.current || (event.pointerType === 'mouse' && event.button !== 0)) return
    // A key in it is pressed, not pulled.
    if ((event.target as Element).closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const y = event.clientY
    pull.current = {
      pointer: event.pointerId,
      from: y,
      height: panel.current?.offsetHeight ?? 0,
      trail: [{ y, t: event.timeStamp }],
    }
  }

  function follow(event: PointerEvent<HTMLDivElement>) {
    const now = pull.current
    if (!now || event.pointerId !== now.pointer) return
    now.trail = [...now.trail, { y: event.clientY, t: event.timeStamp }].filter((point) => event.timeStamp - point.t < 100)
    const dy = event.clientY - now.from
    setMoved({ down: Math.max(0, dy), up: Math.max(0, -dy), height: now.height })
  }

  function release(event: PointerEvent<HTMLDivElement>) {
    const now = pull.current
    if (!now || event.pointerId !== now.pointer) return
    pull.current = null
    setMoved(null)
    if (event.type === 'pointercancel') return

    const dy = event.clientY - now.from
    // How fast the finger went at the end: one that stood still before letting go threw nothing.
    const first = now.trail.find((point) => event.timeStamp - point.t < 100)
    const speed = first && event.timeStamp > first.t ? (event.clientY - first.y) / (event.timeStamp - first.t) : 0
    const ahead = dy + speed * FLICK_MS
    const long = natural() > half() + 1

    if (Math.abs(dy) < TAP_PX) {
      // A tap on the bar of a long sheet opens it up, or back to half.
      if (long) setExpanded(!expanded)
    } else if (ahead < 0) {
      if (long) setExpanded(true)
    } else if (expanded && long && ahead < now.height - half() * 0.7) {
      // Pulled down from the whole screen, a long sheet stops at half, unless thrown further.
      if (ahead > 40) setExpanded(false)
    } else if (ahead > Math.min(100, now.height * 0.25)) {
      close()
    }
  }

  const down = moved?.down ?? 0

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      // Escape slides it away too.
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClose={onClose}
      // Not a box that scrolls or clips: the sheet's colour and the dim go on below its bottom edge.
      className="fixed inset-0 m-0 size-full max-h-none max-w-none overflow-visible border-0 bg-transparent p-0 text-fg backdrop:bg-transparent"
    >
      <div
        aria-hidden="true"
        onClick={close}
        className={`absolute inset-x-0 top-0 -bottom-[50dvh] bg-scrim ${moved ? '' : `transition-opacity ${MOVE}`}`}
        style={{ opacity: shown ? Math.max(0, 1 - down / Math.max(1, moved?.height ?? 1)) : 0 }}
      />
      <div
        ref={panel}
        data-testid="sheet"
        data-expanded={expanded}
        // Its colour goes on below its edge: should a browser keep a strip at the bottom of the screen
        // below the box it gives the app, the strip is the sheet, not a gap.
        className={`absolute inset-x-0 bottom-0 mx-auto flex max-w-md flex-col rounded-t-2xl bg-sheet shadow-[var(--shadow-sheet)] after:absolute after:inset-x-0 after:top-full after:h-[50dvh] after:bg-sheet ${
          moved ? '' : `transition-[translate,max-height,bottom] ${MOVE} motion-reduce:transition-none`
        }`}
        style={{
          bottom: lift,
          translate: `0 ${shown ? `${down}px` : '100%'}`,
          maxHeight: moved?.up
            ? `min(${moved.height + moved.up}px, ${full(lift)})`
            : expanded
              ? full(lift)
              : `min(${HALF * 100}dvh, ${full(lift)})`,
        }}
        onFocus={(event) => event.target.matches('input, textarea, [contenteditable]') && setTyping(true)}
      >
        <div
          data-testid="sheet-handle"
          onPointerDown={start}
          onPointerMove={follow}
          onPointerUp={release}
          onPointerCancel={release}
          // The bar is small, the place to take it by is not: the whole width, and a little above the
          // sheet's edge too.
          className="-mt-4 flex shrink-0 cursor-grab touch-none justify-center pt-6 pb-4 select-none active:cursor-grabbing"
        >
          <div aria-hidden="true" className="h-1.25 w-9 rounded-full bg-cap-edge" />
          <button type="button" onClick={close} className="sr-only">
            Закрыть
          </button>
        </div>
        <div
          ref={body}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
        >
          {children}
        </div>
      </div>
    </dialog>
  )
}

// The screen under the sheets open now is pinned where it was, so that a finger on a sheet never
// scrolls it: the phone would carry a scroll that ends inside the sheet on to the screen behind.
let locks = 0
let scrolled = 0

function lockScroll() {
  if (locks++ > 0) return
  scrolled = window.scrollY
  Object.assign(document.body.style, { position: 'fixed', top: `-${scrolled}px`, left: '0', right: '0' })
  // The root takes the sheet's colour while one is open (index.css).
  document.documentElement.toggleAttribute('data-sheet', true)
}

function unlockScroll() {
  if (--locks > 0) return
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '' })
  document.documentElement.toggleAttribute('data-sheet', false)
  window.scrollTo(0, scrolled)
}
