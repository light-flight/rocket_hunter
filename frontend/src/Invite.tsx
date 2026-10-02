import { useState } from 'react'
import { api } from './api.ts'

const INVITATION =
  'Приглашение в Rocket Hunter. Откройте ссылку в Telegram и нажмите «Запустить» — бот пришлёт ' +
  'инструкцию. Ссылка одноразовая, действует 3 дня.'

type InviteProps = { onSessionExpired: () => void }

// Two taps, because sharing and copying only work straight from a tap, not after a request.
export function Invite({ onSessionExpired }: InviteProps) {
  const [text, setText] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [failed, setFailed] = useState(false)
  const [canShare, setCanShare] = useState(() => 'share' in navigator)
  const [copied, setCopied] = useState(false)

  async function create() {
    setCreating(true)
    setFailed(false)
    const response = await api('POST', '/invitations')
    const body: { url?: unknown } | null =
      response?.status === 201 ? await response.json().catch(() => null) : null
    setCreating(false)

    if (typeof body?.url === 'string') setText(`${INVITATION}\n${body.url}`)
    else if (response?.status === 401) onSessionExpired()
    else setFailed(true)
  }

  function share(text: string) {
    navigator.share({ text }).catch((error: unknown) => {
      // Closing the share sheet is not a failure. Anything else leaves copying as the way out.
      if ((error as { name?: unknown }).name !== 'AbortError') setCanShare(false)
    })
  }

  function copy(text: string) {
    // navigator.clipboard is missing outside a secure context (plain http on a LAN address).
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => {},
    )
  }

  if (text === null) {
    return (
      <section className="flex flex-col gap-3 rounded-2xl bg-white/5 p-4">
        {failed && (
          <p className="text-amber-400">Не удалось создать приглашение. Попробуйте ещё раз.</p>
        )}
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="rounded-xl bg-white/10 px-4 py-3 active:opacity-70 disabled:opacity-50"
        >
          Пригласить менеджера
        </button>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-white/5 p-4">
      <p className="break-words whitespace-pre-line">{text}</p>
      <button
        type="button"
        onClick={() => (canShare ? share(text) : copy(text))}
        className="rounded-xl bg-white px-4 py-3 font-semibold text-black active:opacity-70"
      >
        {canShare ? 'Поделиться' : copied ? 'Скопировано' : 'Скопировать'}
      </button>
    </section>
  )
}
