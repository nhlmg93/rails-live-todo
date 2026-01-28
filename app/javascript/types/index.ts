export interface Todo {
  id: number
  title: string
  completed: boolean
  created_at?: string
  updated_at?: string
}

export interface LogEntry {
  id: number
  time: string
  category: string
  message: string
}

export type LogCategory = 'cable' | 'broadcast' | 'leader' | 'follower'

export interface PageProps {
  todos: Todo[]
  [key: string]: unknown
}
