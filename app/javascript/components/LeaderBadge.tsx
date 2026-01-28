import { useAtom } from 'jotai'
import { isLeaderAtom } from '../atoms/todos'
import './LeaderBadge.css'

export function LeaderBadge() {
  const [isLeader] = useAtom(isLeaderAtom)

  return (
    <div className={`leader-badge ${isLeader ? 'leader-badge--leader' : 'leader-badge--follower'}`}>
      <span className="leader-badge__icon">{isLeader ? '👑' : '👥'}</span>
      <span className="leader-badge__text">{isLeader ? 'LEADER' : 'FOLLOWER'}</span>
      <span className="leader-badge__pulse"></span>
    </div>
  )
}
