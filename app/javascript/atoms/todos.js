import { atom } from 'jotai'

// Leader election state (client-side tab coordination only)
export const isLeaderAtom = atom(false)
