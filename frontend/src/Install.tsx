import { type ReactNode, useEffect, useState } from 'react'
import { Masthead, Palm } from './glove.tsx'
import { install, type Situation, useInstallOffer } from './install.ts'
import { MainAction } from './ui.tsx'

// The step before signing in on a phone: getting the app onto the Home Screen. Depending on
// the browser it is one key, a way out to a browser that can install, or steps to follow.

// The name must not break across lines.
const APP = 'Rocket Hunter'

// How long a browser on Android gets to offer the install before the page stops waiting.
const OFFER_WAIT_MS = 3000

type MessageProps = { title: string; children: ReactNode; note?: string; action?: ReactNode }

// One thing to do, said in a heading and a line, with the key for it at the bottom.
function Message({ title, children, note, action }: MessageProps) {
  return (
    <div className="flex flex-1 flex-col">
      <Palm size="low" />
      <Masthead raised />
      {/* Well clear of the name above, so that the two do not read as one block. */}
      <div className="mt-13 flex flex-col gap-2.5 px-2 text-center text-balance">
        <h2 className="text-2xl/7 font-semibold">{title}</h2>
        <p className="text-body text-fg-2">{children}</p>
        {note && <p className="mt-2 text-sm text-fg-3">{note}</p>}
      </div>
      {action && <div className="mt-auto pt-6">{action}</div>}
    </div>
  )
}

// Steps taken in the browser's own menus. All on screen at once: the hands are on the
// browser, not on this page, and the next step must be in sight.
function Steps({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <Palm size="short" />
      <Masthead compact />
      <div className="mt-10 flex flex-col gap-6 px-2">
        <h2 className="text-center text-2xl/7 font-semibold">Установите приложение</h2>
        {/* Safari drops the list role from a list without markers. */}
        <ol role="list" className="flex flex-col">
          {children}
        </ol>
      </div>
    </div>
  )
}

type StepProps = { number: number; hint?: string; children: ReactNode }

// A plain stepper: the number in a ring, a hairline down to the next one.
function Step({ number, hint, children }: StepProps) {
  return (
    <li className="group relative flex gap-3 pb-6 last:pb-0">
      <div className="absolute top-9.5 bottom-0.5 left-4 w-px bg-line group-last:hidden" />
      <span
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-[0.9375rem]/none font-semibold ring-1 ring-cap-edge ring-inset"
      >
        {number}
      </span>
      <div className="flex flex-col gap-1.5">
        {/* Wraps on a narrow phone rather than run off the screen. */}
        <div className="flex flex-wrap items-center gap-2">{children}</div>
        {hint && <p className="text-sm/[1.125rem] text-fg-2">{hint}</p>}
      </div>
    </li>
  )
}

// A control of the browser, drawn as the key to press.
function Cap({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-9 min-w-9 items-center justify-center gap-2 rounded-[10px] bg-cap px-2.25 text-[0.9375rem]/none font-semibold whitespace-nowrap ring-1 ring-cap-edge ring-inset">
      {children}
    </span>
  )
}

// The glyphs are look-alikes of the browsers' own, drawn here.
const LINE = 'size-5 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]'

type GlyphProps = { name: string }

// A glyph that stands alone on its cap has to be named for a screen reader.
function Glyph({ name, children }: GlyphProps & { children: ReactNode }) {
  return (
    <>
      {children}
      <span className="sr-only">{name}</span>
    </>
  )
}

function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={LINE}>
      <path d="M12 15V3.5" />
      <path d="M8.2 7 12 3.2 15.8 7" />
      <path d="M8 10.5H6.8A1.8 1.8 0 0 0 5 12.3v6.9A1.8 1.8 0 0 0 6.8 21h10.4a1.8 1.8 0 0 0 1.8-1.8v-6.9a1.8 1.8 0 0 0-1.8-1.8H16" />
    </svg>
  )
}

function AddGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={LINE}>
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <path d="M12 8.5v7" />
      <path d="M8.5 12h7" />
    </svg>
  )
}

function PageMenuGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={LINE}>
      <path d="M5 7.5h14" />
      <path d="M5 12h14" />
      <path d="M5 16.5h8" />
    </svg>
  )
}

function DotsGlyph({ upright = false }: { upright?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-5 fill-current ${upright ? 'rotate-90' : ''}`}>
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  )
}

// The last step of any list: the app itself, drawn as it looks among the other icons.
function OpenApp({ number, where }: { number: number; where: string }) {
  return (
    <Step number={number} hint={where}>
      <Cap>
        <img src="/logo.svg" alt="" className="size-5 rounded-[5px]" />
        {APP}
      </Cap>
    </Step>
  )
}

function Then() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5 fill-none stroke-fg-3 stroke-[2.2] [stroke-linecap:round] [stroke-linejoin:round]">
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

// Apple moved Share twice: it sat in the toolbar up to Safari 18, behind the dots in 26 and
// behind the page menu in 27. The row to tap in the share sheet was renamed in 26, where it
// also gained a switch that has to stay on, or the icon becomes a bookmark. Another browser
// (safari is null) does not tell the version of the system: it gets the words common to all.
function IphoneSteps({ safari }: { safari: number | null }) {
  const renamed = safari !== null && safari >= 26
  const where =
    safari === null ? 'в меню браузера' : safari >= 27 ? 'слева от адресной строки' : 'в панели Safari'

  return (
    <Steps>
      <Step number={1} hint={where}>
        {renamed && (
          <>
            <Cap>
              {safari !== null && safari >= 27 ? (
                <Glyph name="Меню страницы">
                  <PageMenuGlyph />
                </Glyph>
              ) : (
                <Glyph name="Ещё">
                  <DotsGlyph />
                </Glyph>
              )}
            </Cap>
            <Then />
          </>
        )}
        <Cap>
          <ShareGlyph />
          Поделиться
        </Cap>
      </Step>
      <Step number={2} hint="пролистайте список вниз">
        <Cap>
          <AddGlyph />
          {renamed ? 'Добавить на экран «Домой»' : 'На экран «Домой»'}
        </Cap>
      </Step>
      <Step number={3} hint={renamed ? 'переключатель оставьте включённым' : undefined}>
        <Cap>Добавить</Cap>
      </Step>
      <OpenApp number={4} where="на экране «Домой»" />
    </Steps>
  )
}

// Chrome that made no offer (a private tab, a phone without Google services) installs from its menu.
function ChromeSteps() {
  return (
    <Steps>
      <Step number={1} hint="меню Chrome, вверху справа">
        <Cap>
          <Glyph name="Меню">
            <DotsGlyph upright />
          </Glyph>
        </Cap>
        <Then />
        <Cap>Установить и создать ярлык</Cap>
      </Step>
      <Step number={2}>
        <Cap>Установить</Cap>
      </Step>
      <OpenApp number={3} where="на главном экране" />
    </Steps>
  )
}

type LeaveProps = Extract<Situation, { step: 'leave' }>

// A browser that cannot install the app hands the page over to one that can.
function Leave({ to, href, fromTelegram }: LeaveProps) {
  // The key relies on behaviour of Telegram that was read from its code and not yet tried on
  // a phone; the note is the way out by hand until it has been.
  const byHand =
    to === 'Safari'
      ? 'Если кнопка не сработала: нажмите ⋯ вверху экрана и выберите «Открыть в Safari».'
      : 'Если кнопка не сработала: нажмите ⋮ вверху экрана, затем «Открыть в...» и «Открыть».'

  return (
    <Message
      title={`Откройте в ${to}`}
      note={fromTelegram ? byHand : undefined}
      action={<MainAction href={href}>Открыть в {to}</MainAction>}
    >
      {fromTelegram ? 'Внутри Telegram приложение не установить.' : `Приложение ставится из ${to}.`}
    </Message>
  )
}

type AndroidProps = Extract<Situation, { step: 'android' }>

function Android({ chrome, toChrome }: AndroidProps) {
  const offer = useInstallOffer()
  const [waiting, setWaiting] = useState(true)
  const [present, setPresent] = useState(false)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setWaiting(false), OFFER_WAIT_MS)
    // An installed app gets no offer; Chrome can tell that it is there.
    navigator.getInstalledRelatedApps?.().then(
      (apps) => setPresent(apps.length > 0),
      () => {},
    )
    return () => clearTimeout(timer)
  }, [])

  async function ask() {
    setAsking(true)
    await install()
    setAsking(false)
  }

  if (offer === 'accepted') {
    return (
      <Message title="Приложение устанавливается">
        Через несколько секунд {APP} появится на главном экране. Откройте его оттуда и войдите.
      </Message>
    )
  }
  if (offer === 'offered') {
    return (
      <Message
        title="Установите приложение"
        action={
          <MainAction onClick={ask} disabled={asking}>
            Установить
          </MainAction>
        }
      >
        Оно работает без сети и открывается с главного экрана.
      </Message>
    )
  }
  if (present) {
    return <Message title="Приложение уже установлено">Откройте {APP} с главного экрана.</Message>
  }
  if (waiting) {
    return (
      <div className="flex flex-1 flex-col">
        <Palm size="low" />
        <Masthead raised />
      </div>
    )
  }
  return chrome ? <ChromeSteps /> : <Leave {...toChrome} />
}

export function Install({ situation }: { situation: Exclude<Situation, { step: 'none' }> }) {
  if (situation.step === 'leave') return <Leave {...situation} />
  if (situation.step === 'iphone') return <IphoneSteps safari={situation.safari} />
  return <Android {...situation} />
}
