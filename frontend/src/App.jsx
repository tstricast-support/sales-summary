import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Link, Navigate, Outlet, useSearchParams } from 'react-router-dom'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts'
import Calendar from 'react-calendar'
import 'react-calendar/dist/Calendar.css'
import { LayoutDashboard, Building2, Download, Printer, WifiOff, Save, CheckCircle2, AlertCircle, Lock, ChevronRight } from 'lucide-react'
/* ───────────── config & helpers ───────────── */
const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,59}$/
const DEPTS = [
  { slug: 'dd-engineering', name: 'DD ENGINEERING', page: 'dd-engineering' },
  { slug: 'i-lab', name: 'I LAB', page: 'i-lab-photobook' },
  { slug: 'i-lab-std', name: 'I LAB STD', page: 'i-lab-std' },
  { slug: 'i-photobook', name: 'I PHOTOBOOK', page: 'i-lab-photobook' },
  { slug: 'tricast', name: 'TRICAST', page: 'tricast' },
]
const PAGES = {
  'dd-engineering': { title: 'DD Engineering', slugs: ['dd-engineering'] },
  'i-lab-photobook': { title: 'I Lab & I Photobook', slugs: ['i-lab', 'i-photobook'] },
  'i-lab-std': { title: 'I Lab STD', slugs: ['i-lab-std'] },
  tricast: { title: 'Tricast Holding', slugs: ['tricast'] },
}
const deptName = s => DEPTS.find(d => d.slug === s)?.name || s
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const money = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const store = {
  get: (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f } catch { return f } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage full/blocked */ } },
}
const rangeFor = kind => {
  const end = new Date(), start = new Date()
  if (kind === 'weekly') start.setDate(end.getDate() - 6)
  if (kind === 'monthly') start.setDate(1)
  if (kind === 'yearly') start.setMonth(0, 1)
  return { start: iso(start), end: iso(end) }
}

// fetch wrapper: network failure => error WITHOUT .status (treated as offline)
async function call(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-admin-key': localStorage.getItem('adminKey') || '', ...opts.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const d = body.detail
    const msg = Array.isArray(d) ? d.map(x => x.msg).join('; ') : d || 'Request failed'
    throw Object.assign(new Error(msg), { status: res.status })
  }
  return res
}

// Offline queue: entries saved while offline are re-sent when the connection returns
async function flushQueue() {
  const q = store.get('queue', [])
  if (!q.length || !navigator.onLine) return 0
  const left = []
  for (const item of q) {
    try { await call('/api/records', { method: 'POST', body: JSON.stringify(item) }) }
    catch (e) { if (!e.status) left.push(item) } // keep only network failures; drop rejected items
  }
  store.set('queue', left)
  return q.length - left.length
}

function Logo({ slug, className = 'h-12 w-12' }) {
  return <img src={`/logos/${slug}.png`} alt={deptName(slug)} className={`${className} object-contain`}
    onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
}

function Notice({ m }) {
  if (!m) return null
  const cls = { ok: 'bg-emerald-50 text-emerald-800', err: 'bg-red-50 text-red-800', warn: 'bg-amber-50 text-amber-900' }[m.t]
  const Icon = m.t === 'ok' ? CheckCircle2 : m.t === 'warn' ? WifiOff : AlertCircle
  return <p role="alert" className={`flex items-start gap-2 rounded-md p-3 text-sm ${cls}`}><Icon size={18} className="mt-0.5 shrink-0" />{m.m}</p>
}

/* ───────────── department panel: calendar + form + history chart ───────────── */
function DeptPanel({ slug, defaultName = '' }) {
  const [date, setDate] = useState(new Date())
  const [mode, setMode] = useState('day')
  const [period, setPeriod] = useState({ month: iso(new Date()).slice(0, 7), year: String(new Date().getFullYear()) })
  const [hist, setHist] = useState(() => store.get('hist:' + slug, []))
  const [f, setF] = useState({ sales: '', collection: '', by: defaultName || localStorage.getItem('by') || '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const key = iso(date)

  const refresh = useCallback(async () => {
    try {
      const s = new Date(); s.setDate(s.getDate() - 364)
      const data = await (await call(`/api/records?department=${slug}&start=${iso(s)}&end=${iso(new Date())}`)).json()
      setHist(data); store.set('hist:' + slug, data)
    } catch { /* offline: keep cached history */ }
  }, [slug])

  useEffect(() => { setHist(store.get('hist:' + slug, [])); setMsg(null); refresh() }, [slug, refresh])
  useEffect(() => {
    if (mode !== 'day') return
    const r = hist.find(x => x.record_date === key)
    setF(p => ({ ...p, sales: r ? String(r.sales_amount) : '', collection: r ? String(r.collection_amount) : '' }))
  }, [key, hist, mode])

  const submit = async e => {
    e.preventDefault(); setMsg(null)
    const by = f.by.trim().replace(/\s+/g, ' ')
    if (!NAME_RE.test(by)) return setMsg({ t: 'err', m: "Enter your name: 2–60 characters, letters, spaces, . ' or - only." })
    const s = parseFloat(f.sales), c = parseFloat(f.collection)
    if (!(s >= 0) || !(c >= 0)) return setMsg({ t: 'err', m: 'Sales and collection must be numbers of 0 or more.' })
    localStorage.setItem('by', by)

    if (mode !== 'day') {
      const [y, m] = mode === 'month' ? period.month.split('-').map(Number) : [Number(period.year), null]
      if (!y || (mode === 'month' && !m)) return setMsg({ t: 'err', m: 'Choose a valid period.' })
      const label = mode === 'month' ? period.month : String(y)
      if (!window.confirm(`Spread ${money(s)} sales and ${money(c)} collection evenly over every day of ${label}?\nExisting daily entries in that period will be replaced.`)) return
      setBusy(true)
      try {
        const r = await (await call('/api/records/bulk', { method: 'POST',
          body: JSON.stringify({ department_slug: slug, year: y, month: m, sales_amount: s, collection_amount: c, submitted_by: by }) })).json()
        setMsg({ t: 'ok', m: `Saved ${label} for ${deptName(slug)} across ${r.days} days.` }); await refresh()
      } catch (err) {
        setMsg({ t: 'err', m: err.status ? err.message : 'You are offline. Month and year entries need an internet connection.' })
      }
      return setBusy(false)
    }

    const body = { department_slug: slug, record_date: key, sales_amount: s, collection_amount: c, submitted_by: by }
    setBusy(true)
    try {
      await call('/api/records', { method: 'POST', body: JSON.stringify(body) })
      setMsg({ t: 'ok', m: `Saved ${deptName(slug)} for ${key}.` }); await refresh()
    } catch (err) {
      if (err.status) setMsg({ t: 'err', m: err.message })
      else {
        store.set('queue', [...store.get('queue', []), body])
        const nh = [...hist.filter(x => x.record_date !== key), { record_date: key, sales_amount: s, collection_amount: c, submitted_by: by }]
        setHist(nh); store.set('hist:' + slug, nh)
        setMsg({ t: 'warn', m: 'You are offline. Entry stored on this device and will sync automatically.' })
      }
    }
    setBusy(false)
  }

  const rows = [...hist].sort((a, b) => b.record_date.localeCompare(a.record_date))
  const ym = key.slice(0, 7)
  const monthTotals = rows.filter(r => r.record_date.startsWith(ym))
    .reduce((t, r) => ({ sales: t.sales + Number(r.sales_amount), collection: t.collection + Number(r.collection_amount) }), { sales: 0, collection: 0 })
  const chart = [...hist].sort((a, b) => a.record_date.localeCompare(b.record_date))
    .map(r => ({ date: r.record_date.slice(5), Sales: r.sales_amount, Collection: r.collection_amount }))
  const heading = mode === 'day' ? `Entry for ${key}` : mode === 'month' ? 'Monthly total' : 'Yearly total'

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        {mode === 'day' && (
          <section className="card" aria-label="Pick a date">
            <Calendar value={date} onChange={setDate} maxDate={new Date()} locale="en-GB"
              tileClassName={({ date: d, view }) => view === 'month' && hist.some(x => x.record_date === iso(d)) ? 'has-rec' : null} />
          </section>
        )}
        <form onSubmit={submit} className="card space-y-3" noValidate>
          <div className="flex gap-2">
            {[['day', 'Day'], ['month', 'Month'], ['year', 'Year']].map(([k, l]) => (
              <button type="button" key={k} onClick={() => { setMode(k); setMsg(null); setF(p => ({ ...p, sales: '', collection: '' })) }}
                className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium ${mode === k ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white'}`}>{l}</button>
            ))}
          </div>
          <h2 className="font-semibold">{heading}</h2>
          {mode === 'month' && (
            <label className="block text-sm font-medium">Month
              <input className="input mt-1" type="month" max={iso(new Date()).slice(0, 7)} value={period.month}
                onChange={e => setPeriod({ ...period, month: e.target.value })} required /></label>
          )}
          {mode === 'year' && (
            <label className="block text-sm font-medium">Year
              <input className="input mt-1" type="number" min="2000" max={new Date().getFullYear()} value={period.year}
                onChange={e => setPeriod({ ...period, year: e.target.value })} required /></label>
          )}
          <label className="block text-sm font-medium">{mode === 'day' ? 'Sales amount' : 'Total sales for the period'}
            <input className="input mt-1" type="number" inputMode="decimal" min="0" step="0.01" value={f.sales}
              onChange={e => setF({ ...f, sales: e.target.value })} required /></label>
          <label className="block text-sm font-medium">{mode === 'day' ? 'Collection amount' : 'Total collection for the period'}
            <input className="input mt-1" type="number" inputMode="decimal" min="0" step="0.01" value={f.collection}
              onChange={e => setF({ ...f, collection: e.target.value })} required /></label>
          <label className="block text-sm font-medium">Your name
            <input className="input mt-1" value={f.by} maxLength={60} autoComplete="name" placeholder="e.g. Nimal Perera"
              onChange={e => setF({ ...f, by: e.target.value })} required /></label>
          {mode !== 'day' && <p className="text-xs text-ink/60">The total is spread evenly over each day up to today. Existing daily entries in this period are replaced.</p>}
          <Notice m={msg} />
          <button className="btn w-full" disabled={busy}><Save size={18} />{busy ? 'Saving…' : 'Save entry'}</button>
        </form>
      </div>

      <div className="space-y-4">
        <section className="card">
          <h2 className="mb-2 font-semibold">Totals for {ym}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md bg-emerald-50 p-3"><p className="text-xs text-ink/70">Sales</p><p className="text-xl font-bold text-sale">{money(monthTotals.sales)}</p></div>
            <div className="rounded-md bg-orange-50 p-3"><p className="text-xs text-ink/70">Collection</p><p className="text-xl font-bold text-coll">{money(monthTotals.collection)}</p></div>
          </div>
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">Recent entries – {deptName(slug)}</h2>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white"><tr className="border-b border-ink/10">
                <th className="py-2">Date</th><th className="text-right">Sales</th><th className="text-right">Collection</th><th className="pl-4">By</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.record_date} onClick={() => { setMode('day'); setDate(new Date(r.record_date + 'T00:00:00')) }}
                    className={`cursor-pointer border-b border-ink/5 hover:bg-ink/5 ${r.record_date === key ? 'bg-emerald-50' : ''}`}>
                    <td className="py-2 whitespace-nowrap">{r.record_date}</td>
                    <td className="text-right">{money(r.sales_amount)}</td>
                    <td className="text-right">{money(r.collection_amount)}</td>
                    <td className="pl-4">{r.submitted_by}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={4} className="py-6 text-center text-ink/60">No entries yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card min-h-[320px]">
          <h2 className="mb-2 font-semibold">Last 12 months – {deptName(slug)}</h2>
          {chart.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" fontSize={12} /><YAxis fontSize={12} width={60} /><Tooltip formatter={v => money(v)} /><Legend />
                <Line type="monotone" dataKey="Sales" stroke="#0f766e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Collection" stroke="#c2410c" strokeWidth={2} dot={false} /></LineChart>
            </ResponsiveContainer>
          ) : <p className="py-16 text-center text-ink/60">No entries yet. Pick a date and save your first entry.</p>}
        </section>
      </div>
    </div>
  )
}

/* ───────────── user page (single or combined departments) ───────────── */
function DepartmentPage({ page }) {
  const { title, slugs } = PAGES[page]
  const [sp] = useSearchParams()
  const [tab, setTab] = useState(slugs.includes(sp.get('tab')) ? sp.get('tab') : slugs[0])
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 pb-10">
      <header className="flex items-center gap-3">
        {slugs.map(s => <Logo key={s} slug={s} className="h-14 w-14 sm:h-16 sm:w-16" />)}
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
      </header>
      {slugs.length > 1 && (
        <div role="tablist" className="flex gap-2">
          {slugs.map(s => (
            <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 font-medium sm:flex-none ${tab === s ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white'}`}>
              <Logo slug={s} className="h-5 w-5 rounded bg-white" />{deptName(s)}</button>
          ))}
        </div>
      )}
      <DeptPanel key={tab} slug={tab} />
    </main>
  )
}

/* ───────────── admin ───────────── */
function AdminShell() {
  const link = ({ isActive }) => `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-white/15' : 'hover:bg-white/10'}`
  return (
    <>
      <nav className="no-print sticky top-0 z-10 flex items-center gap-2 bg-ink px-4 py-2 text-white">
        <span className="mr-auto text-lg font-bold">Summary</span>
        <NavLink to="/admin/departments" className={link}><Building2 size={18} />DEPARTMENTS</NavLink>
<NavLink to="/admin/dashboard" className={link}><LayoutDashboard size={18} />MANAGE</NavLink>
      </nav>
      <Outlet />
    </>
  )
}

function Departments() {
  const [totals, setTotals] = useState({})
  useEffect(() => {
    const today = iso(new Date())
    call(`/api/summary?start=${today}&end=${today}`).then(r => r.json())
      .then(s => setTotals(Object.fromEntries(s.departments.map(d => [d.slug, d]))))
      .catch(() => {})
  }, [])
  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="mb-1 text-2xl font-bold">Departments</h1>
      <p className="mb-4 text-sm text-ink/60">Today's totals. Tap a department to see its details.</p>
      <div className="space-y-3">
        {DEPTS.map(d => {
          const t = totals[d.slug] || { sales: 0, collection: 0 }
          return (
            <Link key={d.slug} to={`/department/${d.page}?tab=${d.slug}`} className="card flex items-center gap-4 hover:shadow-md">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-ink/10 bg-white p-1">
                <Logo slug={d.slug} className="h-full w-full" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{d.name}</span>
                <span className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
                  <span className="text-sale">Sales {money(t.sales)}</span>
                  <span className="text-coll">Collection {money(t.collection)}</span>
                </span>
              </span>
              <ChevronRight size={20} className="shrink-0 text-ink/40" />
            </Link>
          )
        })}
      </div>
    </main>
  )
}

function Dashboard() {
  const [kind, setKind] = useState('daily')
  const [range, setRange] = useState(rangeFor('daily'))
  const [sum, setSum] = useState(null)
  const [audit, setAudit] = useState([])
  const [dept, setDept] = useState('')
  const [err, setErr] = useState('')
  const [ov, setOv] = useState('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const q = `start=${range.start}&end=${range.end}`
      const [a, b] = await Promise.all([
        call(`/api/summary?${q}`).then(r => r.json()),
        call(`/api/audit?${q}${dept ? `&department=${dept}` : ''}`).then(r => r.json()),
      ])
      setSum(a); setAudit(b)
    } catch (e) { setErr(e.status ? e.message : 'Cannot reach the server. Check your connection.') }
  }, [range, dept])
  useEffect(() => { load() }, [load])

  const pick = k => { setKind(k); if (k !== 'custom') setRange(rangeFor(k)) }
  const exportXlsx = async slug => {
    try {
      const res = await call(`/api/export?start=${range.start}&end=${range.end}${slug ? `&department=${slug}` : ''}`)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(await res.blob()); a.download = `summary_${slug || 'all'}_${range.start}_${range.end}.xlsx`; a.click()
    } catch { setErr('Export failed. Try again.') }
  }
  const printLog = () => {
    document.body.classList.add('printing-log')
    window.onafterprint = () => document.body.classList.remove('printing-log')
    window.print()
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 pb-10">
      <div className="no-print flex flex-wrap items-end gap-2">
        {['daily', 'weekly', 'monthly', 'yearly', 'custom'].map(k => (
          <button key={k} onClick={() => pick(k)} className={`rounded-md border px-3 py-2 text-sm font-medium capitalize ${kind === k ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white'}`}>{k}</button>
        ))}
        <input type="date" className="input !w-auto" value={range.start} max={range.end}
          onChange={e => { setKind('custom'); setRange({ ...range, start: e.target.value }) }} aria-label="Start date" />
        <input type="date" className="input !w-auto" value={range.end} min={range.start}
          onChange={e => { setKind('custom'); setRange({ ...range, end: e.target.value }) }} aria-label="End date" />
        <button className="btn-ghost ml-auto" onClick={() => exportXlsx('')}><Download size={16} />Export all</button>
      </div>
      <Notice m={err && { t: 'err', m: err }} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card"><p className="text-sm text-ink/70">Total sales</p><p className="text-3xl font-bold text-sale">{money(sum?.totals.sales)}</p></div>
        <div className="card"><p className="text-sm text-ink/70">Total collections</p><p className="text-3xl font-bold text-coll">{money(sum?.totals.collection)}</p></div>
      </div>

      <section className="card no-print">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Add or override an entry</h2>
          <select className="input !w-auto" value={ov} onChange={e => setOv(e.target.value)}>
            <option value="">Choose department…</option>{DEPTS.map(d => <option key={d.slug} value={d.slug}>{d.name}</option>)}</select></div>
        {ov && <div className="mt-4"><DeptPanel key={ov} slug={ov} defaultName="Admin" /></div>}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Departments ({range.start} → {range.end})</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(sum?.departments || []).map(d => {
            const dp = DEPTS.find(x => x.slug === d.slug)
            return (
              <div key={d.slug} className="card">
                <Link to={`/department/${dp.page}?tab=${d.slug}`} className="flex items-center gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-ink/10 bg-white p-1"><Logo slug={d.slug} className="h-full w-full" /></span>
                  <span className="font-semibold">{d.name}</span>
                </Link>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-emerald-50 p-2"><p className="text-xs text-ink/70">Sales</p><p className="font-bold text-sale">{money(d.sales)}</p></div>
                  <div className="rounded-md bg-orange-50 p-2"><p className="text-xs text-ink/70">Collection</p><p className="font-bold text-coll">{money(d.collection)}</p></div>
                </div>
                <button className="btn-ghost no-print mt-3 w-full justify-center" onClick={() => exportXlsx(d.slug)}><Download size={14} />Excel</button>
              </div>
            )
          })}
        </div>
      </section>

      <section className="card log-area">
        <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Audit log ({range.start} → {range.end})</h2>
          <select className="input no-print !w-auto" value={dept} onChange={e => setDept(e.target.value)}>
            <option value="">All departments</option>{DEPTS.map(d => <option key={d.slug} value={d.slug}>{d.name}</option>)}</select>
          <button className="btn-ghost no-print" onClick={printLog}><Printer size={16} />Print log</button></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs sm:text-sm">
          <thead><tr className="border-b border-ink/10"><th className="py-2">When</th><th>User</th><th>Action</th><th>Department</th><th>Record date</th><th className="text-right">Sales (old → new)</th><th className="text-right">Collection (old → new)</th></tr></thead>
          <tbody>{audit.map(a => (
            <tr key={a.id} className="border-b border-ink/5"><td className="py-1.5 whitespace-nowrap">{new Date(a.timestamp).toLocaleString()}</td><td>{a.changed_by}</td><td>{a.action_type}</td><td>{a.department}</td><td>{a.record_date}</td>
              <td className="text-right whitespace-nowrap">{a.old_sales == null ? '—' : money(a.old_sales)} → {money(a.new_sales)}</td>
              <td className="text-right whitespace-nowrap">{a.old_collection == null ? '—' : money(a.old_collection)} → {money(a.new_collection)}</td></tr>))}
            {!audit.length && <tr><td colSpan={7} className="py-6 text-center text-ink/60">No changes in this period.</td></tr>}</tbody>
        </table></div>
      </section>
    </main>
  )
}

/* ───────────── app root ───────────── */
export default function App() {
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(store.get('queue', []).length)
  useEffect(() => {
    const sync = async () => { await flushQueue(); setPending(store.get('queue', []).length) }
    const on = () => { setOnline(true); sync() }, off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    const t = setInterval(() => setPending(store.get('queue', []).length), 3000)
    sync()
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t) }
  }, [])
  return (
    <BrowserRouter>
      {(!online || pending > 0) && (
        <div className="no-print flex items-center justify-center gap-2 bg-amber-100 px-3 py-1.5 text-sm text-amber-900">
          <WifiOff size={16} />{online ? 'Syncing' : 'Offline'} – {pending} entr{pending === 1 ? 'y' : 'ies'} waiting to sync</div>
      )}
      <Routes>
        <Route path="/" element={<Navigate to="/admin/departments" replace />} />
        <Route path="/admin" element={<AdminShell />}>
          <Route index element={<Navigate to="departments" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="departments" element={<Departments />} />
        </Route>
        {Object.keys(PAGES).map(p => <Route key={p} path={`/department/${p}`} element={<DepartmentPage page={p} />} />)}
        <Route path="*" element={<Navigate to="/admin/departments" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
