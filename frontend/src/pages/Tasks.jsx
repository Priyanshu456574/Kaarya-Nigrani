import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../App'
import { useT } from '../strings'

/** The home screen for everyone except the DM: only what this person needs to do, most urgent first. */
export default function Tasks() {
  const { user } = useApp()
  const { L, lang, date } = useT()
  const [tasks, setTasks] = useState(null)
  useEffect(() => { api.get('/tasks').then(setTasks) }, [])
  if (!tasks) return <div className="page muted">{L.loading}</div>

  const first = user.name.replace(/^(Er\.|M\/s)\s*/, '').split(' ')[0]
  const groups = ['urgent', 'week', 'later'].map(p => [p, tasks.filter(t => t.priority === p)]).filter(([, ts]) => ts.length)

  return (
    <main className="page narrow">
      <header className="taskhead">
        <h1>{L.hello(user.role === 'CONTRACTOR' ? user.name : first)}</h1>
        <p className="lead">{tasks.length ? L.tasksSummary(tasks.length) : L.allClear}</p>
      </header>

      {tasks.length === 0 && (
        <div className="allclear" role="status">
          <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="var(--done-bg)" /><path d="M14 25l7 7 13-15" fill="none" stroke="var(--done)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <p>{L.allClearSub}</p>
        </div>
      )}

      {groups.map(([p, ts]) => (
        <section key={p} className="taskgroup" aria-labelledby={`g-${p}`}>
          <h2 id={`g-${p}`} className={`tg-${p}`}>{L.pr[p]} <span className="count">{ts.length}</span></h2>
          <ul className="tasklist">
            {ts.map((t, k) => (
              <li key={k}>
                <Link className={`task p-${p}`} to={`/works/${t.work.id}?tab=${t.tab}${t.focus ? `&focus=${t.focus}` : ''}`}>
                  <span className="task-main">
                    <b className="task-title">{lang === 'hi' ? t.title_hi : t.title}</b>
                    <span className="task-work">{t.work.name}, {t.work.block}</span>
                    <span className="task-detail">{lang === 'hi' ? t.detail_hi : t.detail}</span>
                  </span>
                  <span className="task-side">
                    {t.overdue_days > 0 ? <span className="due late">{L.overdueBy(t.overdue_days)}</span>
                      : t.due_date ? <span className="due">{L.dueBy(date(t.due_date))}</span> : null}
                    <span className={`btn ${p === 'urgent' ? '' : 'secondary'}`}>{L.open}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {L.roleTip[user.role] && <p className="roletip">{L.roleTip[user.role]}</p>}
    </main>
  )
}
