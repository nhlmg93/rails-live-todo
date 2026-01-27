import { useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { logsAtom, clearLogsAtom } from '../atoms/logs'
import './EventLog.css'

export function EventLog() {
  const [logs] = useAtom(logsAtom)
  const clearLogs = useSetAtom(clearLogsAtom)
  const [isCollapsed, setIsCollapsed] = useState(false)

  if (isCollapsed) {
    return (
      <div className="event-log__collapsed">
        <button onClick={() => setIsCollapsed(false)} className="event-log__expand-btn">
          Show Logs ({logs.length})
        </button>
      </div>
    )
  }

  return (
    <div className="event-log">
      <div className="event-log__header">
        <span className="event-log__title">Event Log</span>
        <div className="event-log__buttons">
          <button onClick={clearLogs} className="event-log__btn">Clear</button>
          <button onClick={() => setIsCollapsed(true)} className="event-log__btn">Hide</button>
        </div>
      </div>
      <div className="event-log__list">
        {logs.length === 0 ? (
          <div className="event-log__empty">No events yet...</div>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className="event-log__entry">
              <span className="event-log__time">{entry.time}</span>
              <span className={`event-log__category event-log__category--${entry.category}`}>
                [{entry.category}]
              </span>
              <span className="event-log__message">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
