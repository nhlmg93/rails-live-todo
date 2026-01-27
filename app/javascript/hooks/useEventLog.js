import { useCallback } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { atom } from 'jotai'

const MAX_LOGS = 50

// Core logs atom
export const logsAtom = atom([])

// Derived atom for log count
export const logCountAtom = atom((get) => get(logsAtom).length)

/**
 * Hook for managing event logs.
 * Returns utilities for adding, clearing, and reading logs.
 */
export function useEventLog() {
  const [logs, setLogs] = useAtom(logsAtom)

  const addLog = useCallback((category, message) => {
    const entry = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      }),
      category,
      message,
    }
    setLogs((currentLogs) => [entry, ...currentLogs].slice(0, MAX_LOGS))
  }, [setLogs])

  const clearLogs = useCallback(() => {
    setLogs([])
  }, [setLogs])

  return { logs, addLog, clearLogs }
}

/**
 * Lightweight hook that only provides the addLog function.
 * Use this in hooks/components that only need to write logs.
 */
export function useLogWriter() {
  const setLogs = useSetAtom(logsAtom)

  const addLog = useCallback((category, message) => {
    const entry = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      }),
      category,
      message,
    }
    setLogs((currentLogs) => [entry, ...currentLogs].slice(0, MAX_LOGS))
  }, [setLogs])

  return addLog
}
