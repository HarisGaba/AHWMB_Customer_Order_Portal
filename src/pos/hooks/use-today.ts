import { useEffect, useState } from "react"
import { actions, dayKey } from "@/lib/store"

/**
 * Current local day key. Re-renders when the clock passes midnight, so the
 * POS automatically rolls over to a fresh day and old days get purged.
 */
export function useToday() {
  const [today, setToday] = useState(dayKey)
  useEffect(() => {
    actions.purgeOld()
    let current = dayKey()
    const t = setInterval(() => {
      const now = dayKey()
      if (now === current) return
      current = now
      actions.purgeOld()
      setToday(now)
    }, 30_000)
    return () => clearInterval(t)
  }, [])
  return today
}

export function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}
