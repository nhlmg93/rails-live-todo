import { useEffect, useRef, useCallback } from 'react'
import { useAtom } from 'jotai'
import { isLeaderAtom } from '../atoms/todos'
import { useLogWriter } from './useEventLog'

const TAB_ID = crypto.randomUUID().slice(0, 8)
const HEARTBEAT_MS = 2000
const TIMEOUT_MS = 5000

/**
 * Leader election across browser tabs using BroadcastChannel.
 * Only one tab becomes leader; others receive data via broadcast.
 */
export function useLeaderElection(channelName, { onMessage } = {}) {
  const [isLeader, setIsLeader] = useAtom(isLeaderAtom)
  const addLog = useLogWriter()
  const channelRef = useRef(null)
  const heartbeatRef = useRef(null)
  const timeoutRef = useRef(null)
  const isLeaderRef = useRef(false)

  useEffect(() => { isLeaderRef.current = isLeader }, [isLeader])

  const broadcast = useCallback((data) => {
    channelRef.current?.postMessage({ type: 'data', payload: data, from: TAB_ID })
  }, [])

  useEffect(() => {
    const channel = new BroadcastChannel(channelName)
    channelRef.current = channel

    const send = (type, payload = null) => channel.postMessage({ type, payload, from: TAB_ID })

    const becomeLeader = () => {
      if (isLeaderRef.current) return
      isLeaderRef.current = true
      setIsLeader(true)
      clearTimeout(timeoutRef.current)
      heartbeatRef.current = setInterval(() => send('ping'), HEARTBEAT_MS)
      send('ping')
      addLog('leader', 'Became leader')
    }

    const becomeFollower = () => {
      if (!isLeaderRef.current) return
      isLeaderRef.current = false
      setIsLeader(false)
      clearInterval(heartbeatRef.current)
      addLog('follower', 'Became follower (another tab has lower ID)')
    }

    const resetTimeout = () => {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        if (!isLeaderRef.current) becomeLeader()
      }, TIMEOUT_MS)
    }

    channel.onmessage = ({ data: { type, payload, from } }) => {
      if (from === TAB_ID) return
      if (type === 'ping') {
        if (isLeaderRef.current && from < TAB_ID) becomeFollower()
        resetTimeout()
      } else if (type === 'discover' && isLeaderRef.current) {
        send('ping')
        addLog('broadcast', `Responded to discover from ${from}`)
      } else if (type === 'data' && !isLeaderRef.current && onMessage) {
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
      clearInterval(heartbeatRef.current)
      clearTimeout(timeoutRef.current)
      channel.close()
    }
  }, [channelName, onMessage, setIsLeader, addLog])

  return { isLeader, broadcast }
}
