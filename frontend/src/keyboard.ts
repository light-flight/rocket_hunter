import { useEffect, useState } from 'react'

// How much of the screen the on-screen keyboard covers: the main action and a sheet stand above it.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    // Not when zoomed in by a pinch: that shrinks the visible area too. Nor by focus: a tap on
    // the key moves the focus to it before the click, and the key must not move away then.
    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      setInset(viewport.scale > 1.01 ? 0 : Math.max(0, Math.round(covered)))
    }
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
