import { atom } from 'jotai'

// Core state atoms
export const todosAtom = atom([])
export const isLeaderAtom = atom(false)

// Derived atom for todo count
export const todoCountAtom = atom((get) => get(todosAtom).length)

// Derived atom for completed count
export const completedCountAtom = atom((get) => 
  get(todosAtom).filter(todo => todo.completed).length
)
