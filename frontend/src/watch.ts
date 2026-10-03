// Races whose files and pits the phone keeps up to date: the one open and the newest. A manager
// who opened neither while there was a network gets the others' once there is one again.
let watched: string[] = []

export function watchRaces(ids: string[]) {
  watched = [...new Set(ids)]
}

export function watchedRaces(): string[] {
  return watched
}
