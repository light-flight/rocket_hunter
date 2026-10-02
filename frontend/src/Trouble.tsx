import { Component, type ReactNode } from 'react'
import { MainAction } from './ui.tsx'

// Races are read from the phone's own database. Should it fail, the screen says so and offers
// a restart instead of going blank; the banners above it stay. Whatever was saved is still there.
export function StorageTrouble() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mt-[20dvh] flex flex-col gap-2.5 px-2 text-center text-balance">
        <h1 className="text-2xl/7 font-semibold">Не удалось прочитать данные на телефоне</h1>
        <p className="text-body text-fg-2">Записанное не потеряно. Перезапустите приложение.</p>
      </div>
      <div className="mt-auto pt-6">
        <MainAction onClick={() => window.location.reload()}>Перезапустить</MainAction>
      </div>
    </div>
  )
}

// The same screen for an error thrown while drawing the races.
export class Trouble extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <StorageTrouble /> : this.props.children
  }
}
