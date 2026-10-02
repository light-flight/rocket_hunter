import { type FormEvent, type ReactNode, useState } from 'react'
import type { Auth, User } from './auth.ts'
import { Masthead, Palm } from './glove.tsx'
import { Menu } from './Menu.tsx'
import { cleanName, createRace, NAME_LIMIT, type Race, renameRace, useRaces, useRaceSync } from './races.ts'
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

type Screen = 'race' | 'list' | 'new' | 'rename'

type RacesProps = { user: User; auth: Auth }

export function Races({ user, auth }: RacesProps) {
  const races = useRaces()
  const { sync, synced } = useRaceSync(auth.markExpired)
  const [selectedId, setSelectedId] = useState(storedSelection)
  const [screen, setScreen] = useState<Screen>('race')
  // A race removed on the server leaves the list, and the app goes back to it.
  const selected = races?.find((race) => race.id === selectedId)

  function open(id: string) {
    storeSelection(id)
    setSelectedId(id)
    setScreen('race')
  }

  async function create(name: string) {
    open(await createRace(name))
    sync()
  }

  async function rename(name: string) {
    if (!selected) return
    await renameRace(selected.id, name)
    setScreen('race')
    sync()
  }

  if (races === undefined) return null

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
  if (screen === 'rename' && selected) {
    return (
      <RaceForm
        title="Переименовать гонку"
        action="Сохранить"
        initial={selected.name}
        onSubmit={rename}
        onCancel={() => setScreen('race')}
      />
    )
  }
  if (screen === 'race' && selected) {
    return (
      <RaceScreen race={selected} onBack={() => setScreen('list')} onRename={() => setScreen('rename')} />
    )
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

type NameFormProps = {
  initial?: string
  action: string
  // Not on the first screen: the keyboard would cover the greeting.
  autoFocus?: boolean
  onSubmit: (name: string) => Promise<void>
  children: (field: ReactNode) => ReactNode
}

// The name of a race and the key that saves it. The return key of the keyboard saves it too.
function NameForm({ initial = '', action, autoFocus = false, onSubmit, children }: NameFormProps) {
  const [name, setName] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const ready = cleanName(name) !== '' && !saving

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return

    setSaving(true)
    setFailed(false)
    try {
      await onSubmit(name)
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
      {children(field)}
      <ActionArea>
        {failed && <p className="text-center text-sm text-amber-400">Не удалось сохранить гонку на телефоне.</p>}
        <MainAction submit disabled={!ready}>
          {action}
        </MainAction>
      </ActionArea>
    </form>
  )
}

type FirstRaceProps = { waiting: boolean; onCreate: (name: string) => Promise<void> }

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
    <NameForm action="Создать гонку" onSubmit={onCreate}>
      {(field) => (
        <>
          <Palm size="low" />
          <Masthead raised />
          <div className="mt-13 flex flex-col gap-2.5 px-2 text-center text-balance">
            <h2 className="text-2xl/7 font-semibold">Первая гонка</h2>
            <p className="text-body text-fg-2">Назовите гонку этого уикенда — дальше вся работа идёт внутри неё.</p>
          </div>
          <div className="mt-6">{field}</div>
        </>
      )}
    </NameForm>
  )
}

type RaceFormProps = {
  title: string
  action: string
  initial?: string
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

// A new race or a new name for one. Nothing but the field: the keyboard takes half the screen.
function RaceForm({ title, action, initial, onSubmit, onCancel }: RaceFormProps) {
  return (
    <NameForm initial={initial} action={action} autoFocus onSubmit={onSubmit}>
      {(field) => (
        <>
          <BackLink onClick={onCancel}>Отмена</BackLink>
          <h1 className="mt-2 text-title font-bold">{title}</h1>
          <div className="mt-5">{field}</div>
        </>
      )}
    </NameForm>
  )
}

const DAY = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' })
const DAY_OF_YEAR = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' })

function made(race: Race): string {
  const date = new Date(race.createdAt)
  return (date.getFullYear() === new Date().getFullYear() ? DAY : DAY_OF_YEAR).format(date)
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
          {user.name.trim().charAt(0).toUpperCase()}
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

type RaceScreenProps = { race: Race; onBack: () => void; onRename: () => void }

// Inside a race. For now only its name: the pit screen comes at the next stage.
function RaceScreen({ race, onBack, onRename }: RaceScreenProps) {
  return (
    <div className="flex flex-1 flex-col">
      <Palm />
      <BackLink onClick={onBack} arrow>
        Все гонки
      </BackLink>
      <h1 className="mt-2 text-title font-bold break-words">{race.name}</h1>
      <button
        type="button"
        onClick={onRename}
        className="flex h-11 items-center self-start text-sm text-fg-3 underline underline-offset-3 active:opacity-70"
      >
        Переименовать
      </button>
      <div className="mt-[14dvh] flex flex-col gap-1.5 px-2 text-center text-balance">
        <p className="text-name text-fg-2">Здесь будет экран пит-стопов</p>
        <p className="text-sm text-fg-3">Машины и коридоры появятся на следующем этапе</p>
      </div>
    </div>
  )
}
