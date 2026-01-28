import { useEffect, useRef, useCallback } from 'react'
import { useAtom } from 'jotai'
import { isLeaderAtom } from '../atoms/todos'
import { useLogWriter } from './useEventLog'
import type { Todo } from '../types'

const TAB_ID = crypto.randomUUID().slice(0, 8)
const HEARTBEAT_MS = 2000
const TIMEOUT_MS = 5000

type MessageType = 'ping' | 'discover' | 'data'

interface BroadcastMessage {
  type: MessageType
  payload: Todo[] | null
  from: string
}

interface UseLeaderElectionOptions {
  onMessage?: (data: Todo[]) => void
}

/**
 * Leader election across browser tabs using BroadcastChannel.
 * Only one tab becomes leader; others receive data via broadcast.
 */
export function useLeaderElection(
  channelName: string,
  { onMessage }: UseLeaderElectionOptions = {}
) {
  const [isLeader, setIsLeader] = useAtom(isLeaderAtom)
  const addLog = useLogWriter()
  const channelRef = useRef<BroadcastChannel | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLeaderRef = useRef(false)

  useEffect(() => {
    isLeaderRef.current = isLeader
  }, [isLeader])

  const broadcast = useCallback((data: Todo[]) => {
    channelRef.current?.postMessage({ type: 'data', payload: data, from: TAB_ID })
  }, [])

  useEffect(() => {
    const channel = new BroadcastChannel(channelName)
    channelRef.current = channel

    const send = (type: MessageType, payload: Todo[] | null = null) =>
      channel.postMessage({ type, payload, from: TAB_ID })

    const becomeLeader = () => {
      if (isLeaderRef.current) return
      isLeaderRef.current = true
      setIsLeader(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      heartbeatRef.current = setInterval(() => send('ping'), HEARTBEAT_MS)
      send('ping')
      addLog('leader', 'Became leader')
    }

    const becomeFollower = () => {
      if (!isLeaderRef.current) return
      isLeaderRef.current = false
      setIsLeader(false)
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
      addLog('follower', 'Became follower (another tab has lower ID)')
    }

    const resetTimeout = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        if (!isLeaderRef.current) becomeLeader()
      }, TIMEOUT_MS)
    }

    channel.onmessage = ({ data }: MessageEvent<BroadcastMessage>) => {
      const { type, payload, from } = data
      if (from === TAB_ID) return
      if (type === 'ping') {
        if (isLeaderRef.current && from < TAB_ID) becomeFollower()
        resetTimeout()
      } else if (type === 'discover' && isLeaderRef.current) {
        send('ping')
        addLog('broadcast', `Responded to discover from ${from}`)
      } else if (type === 'data' && !isLeaderRef.current && onMessage && payload) {
        addLog('broadcast', 'Received data from leader')
        onMessage(payload)
      }
    }

    addLog('broadcast', `Joining channel "${channelName}"`)
    send('discover')
    setTimeout(() => {
      if (!isLeaderRef.current && !timeoutRef.current) becomeLeader()
    }, 500)

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      channel.close()
    }
  }, [channelName, onMessage, setIsLeader, addLog])

  return { isLeader, broadcast }
}
