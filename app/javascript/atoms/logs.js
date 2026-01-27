import { atom } from 'jotai'

const MAX_LOGS = 50

// Core logs atom
export const logsAtom = atom([])

// Write-only atom for adding a log entry
export const addLogAtom = atom(
  null,
  (get, set, { category, message }) => {
    const entry = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit', 
        fractionalSecondDigits: 3 
      }),
      category,
      message,
    }
    
    const currentLogs = get(logsAtom)
    const newLogs = [entry, ...currentLogs].slice(0, MAX_LOGS)
    set(logsAtom, newLogs)
  }
)

// Write-only atom for clearing logs
export const clearLogsAtom = atom(
  null,
  (_get, set) => set(logsAtom, [])
)
