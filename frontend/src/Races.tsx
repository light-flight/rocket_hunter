import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { Auth, User } from './auth.ts'
import { Masthead, Palm } from './glove.tsx'
import { Menu } from './Menu.tsx'
import { lanesOf, standing } from './pitlane.ts'
import { Pits } from './Pits.tsx'
import { usePitLog } from './pits.ts'
import { Qualification } from './Qualification.tsx'
import { ACCEPT, addFiles, syncFiles, useFiles, useKarts } from './qualification.ts'
import { cleanName, createRace, NAME_LIMIT, type Race, updateRace, useRaces, useRaceSync } from './races.ts'
import { StorageTrouble } from './Trouble.tsx'
import { watchRaces } from './watch.ts'
import { ActionArea, BackLink, ChevronRight, MainAction, NotSent, Paperclip, Plus, TextField } from './ui.tsx'

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
  // The files of the race open now, and of this weekend's, are kept on the phone.
  const newest = races?.[0]?.id

  useEffect(() => {
    watchRaces([selected?.id, newest].filter((id) => id !== undefined))
  }, [selected?.id, newest])

  function open(id: string) {
    storeSelection(id)
    setSelectedId(id)
    setScreen('race')
    // Brings its files, should another phone have added some.
    watchRaces([id, newest].filter((race) => race !== undefined))
    sync()
  }

  async function create(name: string) {
    open(await createRace(name))
    sync()
  }

  async function edit(name: string) {
    if (!selected) return
    await updateRace(selected.id, name)
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
    return (
      <RaceScreen
        race={selected}
        onBack={() => setScreen('list')}
        onEdit={() => setScreen('edit')}
        onFilesAdded={sync}
        onSignedOut={auth.check}
      />
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

type RaceFieldsProps = {
  initial?: Pick<Race, 'name'>
  action: string
  // Not on the first screen: the keyboard would cover the greeting.
  autoFocus?: boolean
  onSubmit: (name: string) => Promise<void>
  children: (field: ReactNode) => ReactNode
}

// The name of a race and the key that saves it. The return key of the keyboard saves it too. The
// corridors of the pit lane are chosen in the pits, the first time they are opened.
function RaceFields({ initial, action, autoFocus = false, onSubmit, children }: RaceFieldsProps) {
  const [name, setName] = useState(initial?.name ?? '')
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
    <RaceFields action="Создать гонку" onSubmit={onCreate}>
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
    </RaceFields>
  )
}

type RaceFormProps = {
  title: string
  action: string
  initial?: Pick<Race, 'name'>
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

// A new race, or a new name for one. Nothing but the field: the keyboard takes half the screen.
function RaceForm({ title, action, initial, onSubmit, onCancel }: RaceFormProps) {
  return (
    <RaceFields initial={initial} action={action} autoFocus onSubmit={onSubmit}>
      {(field) => (
        <>
          <BackLink onClick={onCancel}>Отмена</BackLink>
          <h1 className="mt-2 text-title font-bold">{title}</h1>
          <div className="mt-5">{field}</div>
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

type RaceScreenProps = {
  race: Race
  onBack: () => void
  onEdit: () => void
  onFilesAdded: () => void
  onSignedOut: () => void
}

type Tab = 'pits' | 'qualification'

// How often the phone asks how the reading goes while a file is with the model: often at
// first, then now and then, for as long as anything is still being read.
const POLL_MS = 3000
const POLL_SLOWER_AFTER_MS = 5 * 60_000
const SLOW_POLL_MS = 30_000

// Inside a race. Before anything else, its qualification: the protocols to read and the karts
// they rank. Once there are karts, or its pits are set up, the race opens in its pits. The pits
// work before any protocol too: the numbers are typed in as the teams come in.
function RaceScreen({ race, onBack, onEdit, onFilesAdded, onSignedOut }: RaceScreenProps) {
  const files = useFiles(race.id)
  const karts = useKarts(race.id)
  const pitLog = usePitLog(race.id)
  // Picked once the karts and the pits are known: the pits when the race has karts or corridors,
  // else its qualification.
  const [tab, setTab] = useState<Tab | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  // The files with the model now. Another one joining, or one done, starts the quick asking anew.
  const reading = (files ?? [])
    .filter((file) => file.status === 'waiting' || file.status === 'reading')
    .map((file) => file.id)
    .join(' ')

  useEffect(() => {
    if (!reading) return
    const started = Date.now()
    let timer: number
    const ask = () => {
      if (document.visibilityState === 'visible') syncFiles(onSignedOut)
      timer = window.setTimeout(ask, Date.now() - started < POLL_SLOWER_AFTER_MS ? POLL_MS : SLOW_POLL_MS)
    }
    timer = window.setTimeout(ask, POLL_MS)
    return () => clearTimeout(timer)
  }, [reading, onSignedOut])

  // Decided once, as soon as both are known, so the screen never switches under the hand.
  if (tab === null && karts !== undefined && pitLog !== undefined) {
    const pitsSetUp = pitLog !== null && lanesOf(pitLog.lanes, standing(pitLog)) !== null
    setTab(karts.length > 0 || pitsSetUp ? 'pits' : 'qualification')
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])]
    // The camera hands over one photo per pick: the next pick starts afresh.
    event.target.value = ''
    if (picked.length === 0) return

    setSaveFailed(false)
    try {
      await addFiles(race.id, picked)
    } catch {
      setSaveFailed(true)
      return
    }
    setTab('qualification')
    onFilesAdded()
  }

  const empty = files?.length === 0
  // In the pits every bit of the screen goes to the corridors and the karts: the race is named
  // by the way back.
  const pits = tab === 'pits'
  // A blink of the qualification before the pits is worse than a blink of nothing.
  if (files === undefined || tab === null) return <div className="flex flex-1 flex-col" />

  return (
    <div className="flex flex-1 flex-col">
      {!pits && <Palm size={empty ? undefined : 'short'} />}
      {pits ? (
        <>
          <BackLink onClick={onBack} arrow label="Все гонки">
            <span className="truncate">{race.name}</span>
          </BackLink>
          <h1 className="sr-only">{race.name}</h1>
        </>
      ) : (
        <>
          <BackLink onClick={onBack} arrow>
            Все гонки
          </BackLink>
          <h1 className="mt-2 text-title font-bold break-words">{race.name}</h1>
          <button
            type="button"
            onClick={onEdit}
            className="-ml-1 flex h-11 items-center self-start px-1 text-sm text-fg-3 underline underline-offset-3 active:opacity-70"
          >
            Изменить
          </button>
        </>
      )}

      {/* The phone's own picker: Photos, the camera and Files. */}
      <input ref={picker} type="file" multiple accept={ACCEPT} onChange={pick} hidden />

      {files === null && (
        <p role="alert" className="mt-6 text-center text-sm text-amber-400">
          Не удалось прочитать протоколы на телефоне.
        </p>
      )}
      {saveFailed && (
        <p role="alert" className="mt-6 text-center text-sm text-amber-400">
          Не удалось сохранить файлы на телефоне. Попробуйте добавить их ещё раз.
        </p>
      )}

      {empty && !pits && (
        <>
          <div className="mt-[14dvh] flex flex-col gap-1.5 px-2 text-center text-balance">
            <p className="text-name text-fg-2">Добавьте протоколы квалификации</p>
            <p className="text-sm text-fg-3">Карты встанут от быстрого к медленному</p>
          </div>
          {/* A race already on, or protocols not out yet: the pits do not wait for them. */}
          <button
            type="button"
            onClick={() => setTab('pits')}
            className="mt-3 flex h-11 items-center self-center px-1 text-sm text-fg-3 underline underline-offset-3 active:opacity-70"
          >
            Пит-стопы без квалификации
          </button>
          <ActionArea>
            <p className="text-center text-sm text-fg-3">PDF или фото, можно несколько</p>
            <MainAction onClick={() => picker.current?.click()}>
              <Paperclip />
              Добавить квалификацию
            </MainAction>
          </ActionArea>
        </>
      )}

      {/* Without files only in the pits: its other tab leads back to adding them. */}
      {files && (files.length > 0 || pits) && (
        <>
          <div role="tablist" className="mt-2 grid grid-cols-2 border-b border-control">
            <RaceTab id="pits" current={tab} onSelect={setTab}>
              Пит-стопы
            </RaceTab>
            <RaceTab id="qualification" current={tab} onSelect={setTab}>
              Квалификация
            </RaceTab>
          </div>

          {tab !== 'pits' ? (
            <>
              <div role="tabpanel" aria-label="Квалификация" className="mt-3">
                <Qualification raceId={race.id} files={files} karts={karts ?? []} onSignedOut={onSignedOut} />
              </div>
              {/* Stays in reach when the list is longer than the screen. */}
              <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+1rem)] mt-auto pt-6">
                <MainAction onClick={() => picker.current?.click()}>
                  <Paperclip />
                  Добавить протоколы
                </MainAction>
              </div>
            </>
          ) : (
            <div role="tabpanel" aria-label="Пит-стопы" className="flex flex-1 flex-col">
              <Pits
                race={race}
                karts={karts ?? []}
                onQualification={() => setTab('qualification')}
                onSignedOut={onSignedOut}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

type RaceTabProps = { id: Tab; current: Tab | null; onSelect: (tab: Tab) => void; children: ReactNode }

function RaceTab({ id, current, onSelect, children }: RaceTabProps) {
  const selected = id === current

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(id)}
      className={`-mb-px flex h-12 items-center justify-center border-b-2 text-body active:opacity-70 ${
        selected ? 'border-fg font-semibold text-fg' : 'border-transparent text-fg-3'
      }`}
    >
      {children}
    </button>
  )
}
