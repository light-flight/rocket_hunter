import { useEffect, useState } from 'react'

// The time now, by this phone's clock, again and again while the screen that asks for it is on: often
// enough for a clock to the second not to skip one.
export function useNow(every = 250): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])

  return now
}
