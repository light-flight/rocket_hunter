import { type FormEvent, type ReactNode, useState } from 'react'
import type { Auth, User } from './auth.ts'
import { Masthead, Palm } from './glove.tsx'
import { LanesPicker } from './Lanes.tsx'
import { Menu } from './Menu.tsx'
import {
  cleanName,
  createRace,
  lanesLabel,
  NAME_LIMIT,
  type Race,
  updateRace,
  useRaces,
  useRaceSync,
} from './races.ts'
import { StorageTrouble } from './Trouble.tsx'
import { ActionArea, BackLink, ChevronRight, MainAction, NotSent, Plus, TextField } from './ui.tsx'

// The app after signing in. All work is done inside one race; the app opens in the race
// chosen last, and the list of races is one step back from it.

const SELECTED_KEY = 'rocket-hunter.race'

function storedSelection(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY)
  } catch {
    // Storage is unavailable.
    return null
  }
}

function storeSelection(id: string) {
  try {
    localStorage.setItem(SELECTED_KEY, id)
  } catch {
    // Without storage the choice lasts until the app is closed.
  }
}

type Screen = 'race' | 'list' | 'new' | 'edit'

type RacesProps = { user: User; auth: Auth }

export function Races({ user, auth }: RacesProps) {
  const races = useRaces()
  const { sync, synced } = useRaceSync(auth.check, auth.expired)
  const [selectedId, setSelectedId] = useState(storedSelection)
  const [screen, setScreen] = useState<Screen>('race')
  // A race removed on the server leaves the list, and the app goes back to it.
  const selected = races?.find((race) => race.id === selectedId)

  function open(id: string) {
    storeSelection(id)
    setSelectedId(id)
    setScreen('race')
  }

  async function create(name: string, lanes: number) {
    open(await createRace(name, lanes))
    sync()
  }

  async function edit(name: string, lanes: number) {
    if (!selected) return
    await updateRace(selected.id, name, lanes)
    setScreen('race')
    sync()
  }

  if (races === undefined) return null
  if (races === null) return <StorageTrouble />

  // A phone with no races yet asks the server first: the team may have some already.
  if (races.length === 0) return <FirstRace waiting={!synced} onCreate={create} />

  if (screen === 'new') {
    return (
      <RaceForm
        title="Новая гонка"
        action="Создать гонку"
        onSubmit={create}
        onCancel={() => setScreen('list')}
      />
    )
  }
  if (screen === 'edit' && selected) {
    return (
      <RaceForm
        title="Изменить гонку"
        action="Сохранить"
        initial={selected}
        onSubmit={edit}
        onCancel={() => setScreen('race')}
      />
    )
  }
  if (screen === 'race' && selected) {
    return <RaceScreen race={selected} onBack={() => setScreen('list')} onEdit={() => setScreen('edit')} />
  }
  return (
    <RaceList
      races={races}
      selectedId={selected?.id}
      onOpen={open}
      onNew={() => setScreen('new')}
      user={user}
      auth={auth}
    />
  )
}

type RaceFieldsProps = {
  initial?: Pick<Race, 'name' | 'lanes'>
  action: string
  // Not on the first screen: the keyboard would cover the greeting.
  autoFocus?: boolean
  onSubmit: (name: string, lanes: number) => Promise<void>
  children: (field: ReactNode, lanes: ReactNode) => ReactNode
}

// The name of a race, its corridors and the key that saves them. The return key of the
// keyboard saves them too.
function RaceFields({ initial, action, autoFocus = false, onSubmit, children }: RaceFieldsProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [lanes, setLanes] = useState(initial?.lanes ?? 1)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const ready = cleanName(name) !== '' && !saving

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return

    setSaving(true)
    setFailed(false)
    try {
      await onSubmit(name, lanes)
    } catch {
      setFailed(true)
      setSaving(false)
    }
  }

  const field = (
    <TextField
      label="Название гонки"
      placeholder="Например, Этап 1 · Крылатское"
      value={name}
      onChange={(event) => setName(event.target.value)}
      maxLength={NAME_LIMIT}
      autoComplete="off"
      autoCapitalize="sentences"
      enterKeyHint="done"
      autoFocus={autoFocus}
    />
  )

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col">
      {children(field, <LanesPicker value={lanes} onChange={setLanes} />)}
      <ActionArea>
        {failed && (
          <p role="alert" className="text-center text-sm text-amber-400">
            Не удалось сохранить гонку на телефоне.
          </p>
        )}
        <MainAction submit disabled={!ready}>
          {action}
        </MainAction>
      </ActionArea>
    </form>
  )
}

type FirstRaceProps = { waiting: boolean; onCreate: (name: string, lanes: number) => Promise<void> }

// The first screen of a phone that has no races: the app greets the manager and asks for one.
function FirstRace({ waiting, onCreate }: FirstRaceProps) {
  if (waiting) {
    return (
      <div className="flex flex-1 flex-col">
        <Palm size="low" />
        <Masthead raised />
      </div>
    )
  }

  return (
    <RaceFields action="Создать гонку" onSubmit={onCreate}>
      {(field, lanes) => (
        <>
          <Palm size="low" />
          <Masthead raised />
          <div className="mt-13 flex flex-col gap-2.5 px-2 text-center text-balance">
            <h2 className="text-2xl/7 font-semibold">Первая гонка</h2>
            <p className="text-body text-fg-2">Назовите гонку этого уикенда — дальше вся работа идёт внутри неё.</p>
          </div>
          <div className="mt-6">{field}</div>
          <div className="mt-5">{lanes}</div>
        </>
      )}
    </RaceFields>
  )
}

type RaceFormProps = {
  title: string
  action: string
  initial?: Pick<Race, 'name' | 'lanes'>
  onSubmit: (name: string, lanes: number) => Promise<void>
  onCancel: () => void
}

// A new race, or a change to one. Nothing but the fields: the keyboard takes half the screen,
// and the corridors stay above it.
function RaceForm({ title, action, initial, onSubmit, onCancel }: RaceFormProps) {
  return (
    <RaceFields initial={initial} action={action} autoFocus onSubmit={onSubmit}>
      {(field, lanes) => (
        <>
          <BackLink onClick={onCancel}>Отмена</BackLink>
          <h1 className="mt-2 text-title font-bold">{title}</h1>
          <div className="mt-5">{field}</div>
          <div className="mt-5">{lanes}</div>
        </>
      )}
    </RaceFields>
  )
}

const DAY = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' })
const DAY_OF_YEAR = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' })

function made(race: Race): string {
  const date = new Date(race.createdAt)
  return (date.getFullYear() === new Date().getFullYear() ? DAY : DAY_OF_YEAR).format(date)
}

// The first letter of the name: Telegram names often start with an emoji.
function initial(name: string): string {
  return (name.match(/\p{L}/u)?.[0] ?? Array.from(name.trim())[0] ?? '').toUpperCase()
}

type RaceListProps = {
  races: Race[]
  selectedId: string | undefined
  onOpen: (id: string) => void
  onNew: () => void
  user: User
  auth: Auth
}

// Every race of the team, newest first: a new one each weekend.
function RaceList({ races, selectedId, onOpen, onNew, user, auth }: RaceListProps) {
  const [menu, setMenu] = useState(false)

  return (
    <div className="flex flex-1 flex-col">
      <Palm size="short" />
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-title font-bold">Гонки</h1>
        <button
          type="button"
          onClick={() => setMenu(true)}
          aria-label={`Менеджер: ${user.name}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sheet text-lg font-semibold ring-1 ring-line ring-inset active:opacity-70"
        >
          {initial(user.name)}
        </button>
      </div>

      <ul role="list" className="mt-3 flex flex-col">
        {races.map((race) => (
          <li key={race.id}>
            <button
              type="button"
              onClick={() => onOpen(race.id)}
              className="flex min-h-18 w-full items-center gap-3 border-b border-control py-3 text-left active:opacity-70"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-name font-semibold break-words">{race.name}</span>
                <span className="flex flex-wrap gap-x-3 text-sm text-fg-3">
                  <span className={race.id === selectedId ? 'text-fg-2' : ''}>
                    {made(race)}
                    {race.id === selectedId && ' · открыта сейчас'}
                  </span>
                  {race.pending === 1 && (
                    <span className="flex items-center gap-1">
                      <NotSent />
                      ждёт сети
                    </span>
                  )}
                </span>
              </span>
              <ChevronRight />
            </button>
          </li>
        ))}
      </ul>

      {/* Stays in reach when the list is longer than the screen. */}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+1rem)] mt-auto pt-6">
        <MainAction onClick={onNew}>
          <Plus />
          Новая гонка
        </MainAction>
      </div>

      {menu && <Menu user={user} auth={auth} onClose={() => setMenu(false)} />}
    </div>
  )
}

type RaceScreenProps = { race: Race; onBack: () => void; onEdit: () => void }

// Inside a race. For now only its name and corridors: the pit screen comes at a later stage.
function RaceScreen({ race, onBack, onEdit }: RaceScreenProps) {
  return (
    <div className="flex flex-1 flex-col">
      <Palm />
      <BackLink onClick={onBack} arrow>
        Все гонки
      </BackLink>
      <h1 className="mt-2 text-title font-bold break-words">{race.name}</h1>
      <div className="flex items-center gap-3.5 text-sm text-fg-3">
        <span data-testid="race-lanes">{lanesLabel(race.lanes)}</span>
        <button
          type="button"
          onClick={onEdit}
          className="flex h-11 items-center px-1 underline underline-offset-3 active:opacity-70"
        >
          Изменить
        </button>
      </div>
      <div className="mt-[14dvh] flex flex-col gap-1.5 px-2 text-center text-balance">
        <p className="text-name text-fg-2">Здесь будет экран пит-стопов</p>
        <p className="text-sm text-fg-3">Машины и коридоры появятся на следующем этапе</p>
      </div>
    </div>
  )
}
