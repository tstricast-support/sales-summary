import { useCallback, useEffect, useState,useRef } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Link, Navigate, Outlet, useSearchParams, useLocation } from 'react-router-dom'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts'
import { LayoutDashboard, Building2, Download, Printer, WifiOff, Save, CheckCircle2, AlertCircle, Lock, ChevronRight, ArrowLeft, Briefcase, Pencil, MoreVertical, Trash2 } from 'lucide-react'
import Calendar from 'react-calendar'
import 'react-calendar/dist/Calendar.css'

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
// dd/mm/yyyy — the date format used in Sri Lanka
const sriDate = isoStr => { const [y, m, d] = isoStr.split('-'); return `${d}/${m}/${y}` }
const within24h = createdAt => createdAt && (Date.now() - new Date(createdAt).getTime()) < 86400000
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

async function flushDamageQueue() {
  const q = store.get('damageQueue', [])
  if (!q.length || !navigator.onLine) return 0
  const left = []
  for (const item of q) {
    try { await call('/api/damages', { method: 'POST', body: JSON.stringify(item) }) }
    catch (e) { if (!e.status) left.push(item) }
  }
  store.set('damageQueue', left)
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
  const isAdmin = defaultName === 'Admin'
  const todayStr = iso(new Date())
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('day')
  const [date, setDate] = useState(todayStr)
  const [period, setPeriod] = useState({ month: todayStr.slice(0, 7), year: String(new Date().getFullYear()) })
  const [range, setRange] = useState('monthly')
  const [entMonth, setEntMonth] = useState(todayStr.slice(0, 7))
  const [tMode, setTMode] = useState('month')
  const [tDate, setTDate] = useState(todayStr)
  const [tMonth, setTMonth] = useState(todayStr.slice(0, 7))
  const [tYear, setTYear] = useState(String(new Date().getFullYear()))
  const [tot, setTot] = useState({ sales: 0, collection: 0, days: 0 })
  const [hist, setHist] = useState(() => store.get('hist:' + slug, []))
  const [f, setF] = useState({ sales: '', collection: '', by: defaultName || localStorage.getItem('by') || '' })
  const [msg, setMsg] = useState(null)
  const [toast, setToast] = useState(null)
  const [busy, setBusy] = useState(false)


  const refresh = useCallback(async () => {
    try {
      const s = new Date(); s.setDate(s.getDate() - 364)
      const data = await (await call(`/api/records?department=${slug}&start=${iso(s)}&end=${iso(new Date())}`)).json()
      setHist(data); store.set('hist:' + slug, data)
    } catch { /* offline: keep cached history */ }
  }, [slug])

  useEffect(() => { setHist(store.get('hist:' + slug, [])); setToast(null); refresh() }, [slug, refresh])

  // prefill the form when an existing day is selected
  useEffect(() => {
    if (!open || mode !== 'day') return
    const r = hist.find(x => x.record_date === date)
    setF(p => ({ ...p, sales: r ? String(r.sales_amount) : '', collection: r ? String(r.collection_amount) : '' }))
  }, [open, date, hist, mode])

  useEffect(() => {
    if (!open) return
    const h = e => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open])

  const openEntry = d => { setMode('day'); setDate(d || todayStr); setMsg(null); setOpen(true) }

  const removeEntry = async r => {
  if (!window.confirm(`Delete the entry for ${r.record_date}?`)) return
  try {
    await call(isAdmin ? `/api/admin/records/${r.id}` : `/api/records/${r.id}`, { method: 'DELETE' })
    await refresh()
  } catch (e) { setToast({ t: 'err', m: e.status ? e.message : 'Could not delete. Check your connection.' }) }
}

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
        setToast({ t: 'ok', m: `Saved ${label} for ${deptName(slug)} across ${r.days} days.` }); setOpen(false); await refresh()
      } catch (err) {
        setMsg({ t: 'err', m: err.status ? err.message : 'You are offline. Month and year entries need an internet connection.' })
      }
      return setBusy(false)
    }

    if (!date || date > todayStr) return setMsg({ t: 'err', m: 'Choose a date that is today or earlier.' })
    const body = { department_slug: slug, record_date: date, sales_amount: s, collection_amount: c, submitted_by: by }
    setBusy(true)
    try {
      await call('/api/records', { method: 'POST', body: JSON.stringify(body) })
      setToast({ t: 'ok', m: `Saved ${deptName(slug)} for ${date}.` }); setOpen(false); await refresh()
    } catch (err) {
      if (err.status) setMsg({ t: 'err', m: err.message })
      else {
        store.set('queue', [...store.get('queue', []), body])
        const nh = [...hist.filter(x => x.record_date !== date), { record_date: date, sales_amount: s, collection_amount: c, submitted_by: by }]
        setHist(nh); store.set('hist:' + slug, nh)
        setToast({ t: 'warn', m: 'You are offline. Entry stored on this device and will sync automatically.' }); setOpen(false)
      }
    }
    setBusy(false)
  }
  // TOTAL section: work out the selected period (a week is Monday to Sunday)
const totalRange = (() => {
  const d = new Date((tDate || todayStr) + 'T00:00:00')
  if (tMode === 'date') return { start: iso(d), end: iso(d), label: iso(d) }
  if (tMode === 'week') {
    const s = new Date(d); s.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    const e = new Date(s); e.setDate(s.getDate() + 6)
    return { start: iso(s), end: iso(e), label: `${iso(s)} → ${iso(e)}` }
  }
  if (tMode === 'month') {
    const [y, m] = tMonth.split('-').map(Number)
    return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)), label: tMonth }
  }
  return { start: `${tYear}-01-01`, end: `${tYear}-12-31`, label: tYear }
})()

useEffect(() => {
  const { start, end } = totalRange
  const ok = /^\d{4}-\d{2}-\d{2}$/
  if (!ok.test(start) || !ok.test(end)) return
  const sum = list => list.reduce((t, r) => ({ sales: t.sales + Number(r.sales_amount), collection: t.collection + Number(r.collection_amount), days: t.days + 1 }), { sales: 0, collection: 0, days: 0 })
  let live = true
  call(`/api/records?department=${slug}&start=${start}&end=${end}`).then(r => r.json())
    .then(l => live && setTot(sum(l)))
    .catch(() => live && setTot(sum(hist.filter(r => r.record_date >= start && r.record_date <= end)))) // offline fallback
  return () => { live = false }
}, [slug, totalRange.start, totalRange.end, hist])

  // chart data: weekly = last 7 days, monthly = last 30 days, yearly = per month (last 12)
  const chartData = (() => {
    if (range === 'yearly') {
      const m = {}
      hist.forEach(r => {
        const k = r.record_date.slice(0, 7)
        m[k] = m[k] || { date: k, Sales: 0, Collection: 0 }
        m[k].Sales += Number(r.sales_amount); m[k].Collection += Number(r.collection_amount)
      })
      return Object.values(m).sort((a, b) => a.date.localeCompare(b.date)).slice(-12)
    }
    const from = new Date(); from.setDate(from.getDate() - (range === 'weekly' ? 6 : 29))
    return hist.filter(r => r.record_date >= iso(from)).sort((a, b) => a.record_date.localeCompare(b.record_date))
      .map(r => ({ date: r.record_date.slice(5), Sales: Number(r.sales_amount), Collection: Number(r.collection_amount) }))
  })()
  const rangeLabel = { weekly: 'LAST 7 DAYS', monthly: 'LAST 30 DAYS', yearly: 'LAST 12 MONTHS' }[range]

  const rows = hist.filter(r => r.record_date.startsWith(entMonth)).sort((a, b) => b.record_date.localeCompare(a.record_date))
  const seg = on => `rounded-md border px-3 py-1.5 text-sm font-medium ${on ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white'}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold uppercase">{deptName(slug)}</h2>
        <button className="btn" onClick={() => openEntry()}>+ ENTRY</button>
      </div>
      <Notice m={toast} />

      {/* 1. GRAPH */}
      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold uppercase">Sales & Collection Trend – {rangeLabel}</h2>
          <div className="flex gap-2">
            {['weekly', 'monthly', 'yearly'].map(k => <button key={k} onClick={() => setRange(k)} className={`${seg(range === k)} capitalize`}>{k}</button>)}
          </div>
        </div>
        {chartData.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" fontSize={12} /><YAxis fontSize={12} width={60} /><Tooltip formatter={v => money(v)} /><Legend />
              <Line type="monotone" dataKey="Sales" stroke="#0f766e" strokeWidth={2} dot={chartData.length < 15} />
              <Line type="monotone" dataKey="Collection" stroke="#c2410c" strokeWidth={2} dot={chartData.length < 15} /></LineChart>
          </ResponsiveContainer>
        ) : <p className="py-16 text-center text-ink/60">No entries in this period. Tap + ENTRY to add one.</p>}
      </section>

      {/* 2. RECENT ENTRIES */}
      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold uppercase">Recent Entries</h2>
          <input type="month" className="input !w-auto" value={entMonth} max={todayStr.slice(0, 7)}
            onChange={e => e.target.value && setEntMonth(e.target.value)} aria-label="Filter by month" />
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white"><tr className="border-b border-ink/10">
                <th className="py-2">Date</th><th className="text-right">Sales</th><th className="text-right">Collection</th><th className="pl-4">By</th><th className="pl-2 no-print" /></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.record_date} className="border-b border-ink/5 hover:bg-ink/5">
                  <td className="cursor-pointer py-2 whitespace-nowrap" onClick={() => openEntry(r.record_date)}>{r.record_date}</td>
                  <td className="text-right">{money(r.sales_amount)}</td>
                  <td className="text-right">{money(r.collection_amount)}</td>
                  <td className="pl-4">{r.submitted_by}</td>
                  <td className="pl-2 text-right">
                    {(isAdmin || within24h(r.created_at)) && r.id && <RowMenu onDelete={() => removeEntry(r)} />}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4} className="py-6 text-center text-ink/60">No entries in {entMonth}.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink/60">Tap a row to edit that day. Only the last 12 months are loaded.</p>
      </section>

      {/* 3. TOTAL */}
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold uppercase">Total – {totalRange.label}</h2>
        <div className="flex gap-2">
          {[['date', 'Date'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']].map(([k, l]) => (
            <button key={k} onClick={() => setTMode(k)} className={seg(tMode === k)}>{l}</button>
          ))}
        </div>
      </div>
      {(tMode === 'date' || tMode === 'week') && (
        <label className="mb-3 block text-sm font-medium">{tMode === 'date' ? 'Date' : 'Pick any day in the week'}
          <input className="input mt-1 !w-auto" type="date" max={todayStr} value={tDate} onChange={e => e.target.value && setTDate(e.target.value)} /></label>
      )}
      {tMode === 'month' && (
        <label className="mb-3 block text-sm font-medium">Month
          <input className="input mt-1 !w-auto" type="month" max={todayStr.slice(0, 7)} value={tMonth} onChange={e => e.target.value && setTMonth(e.target.value)} /></label>
      )}
      {tMode === 'year' && (
        <label className="mb-3 block text-sm font-medium">Year
          <input className="input mt-1 !w-auto" type="number" min="2000" max={new Date().getFullYear()} value={tYear} onChange={e => setTYear(e.target.value)} /></label>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md bg-emerald-50 p-3"><p className="text-xs uppercase text-ink/70">Sales</p><p className="text-xl font-bold text-sale">{money(tot.sales)}</p></div>
        <div className="rounded-md bg-orange-50 p-3"><p className="text-xs uppercase text-ink/70">Collection</p><p className="text-xl font-bold text-coll">{money(tot.collection)}</p></div>
      </div>
      <p className="mt-2 text-xs text-ink/60">{tot.days} day{tot.days === 1 ? '' : 's'} with entries in this period.</p>
    </section>

      {/* +ENTRY POPUP */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <form role="dialog" aria-modal="true" aria-label="New entry" onClick={e => e.stopPropagation()} onSubmit={submit} noValidate
            className="max-h-[92vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-xl bg-white p-4 sm:rounded-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold uppercase">New Entry – {deptName(slug)}</h2>
              <button type="button" className="rounded p-1 text-2xl leading-none text-ink/60 hover:bg-ink/5" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="flex gap-2">
              {[['day', 'Day'], ['month', 'Month'], ['year', 'Year']].map(([k, l]) => (
                <button type="button" key={k} className={`${seg(mode === k)} flex-1`}
                  onClick={() => { setMode(k); setMsg(null); if (k !== 'day') setF(p => ({ ...p, sales: '', collection: '' })) }}>{l}</button>
              ))}
            </div>
            {mode === 'day' && (
              <div>
                <p className="mb-1 text-sm font-medium">Date <span className="font-normal text-ink/60">— {date}</span></p>
                <Calendar
                  value={new Date(date + 'T00:00:00')}
                  onChange={d => setDate(iso(d))}
                  maxDate={new Date()}
                  locale="en-GB"
                  calendarType="iso8601"
                  className="mini-cal"
                  tileClassName={({ date: d, view }) => {
                    if (view !== 'month') return null
                    const cls = []
                    if (hist.some(x => x.record_date === iso(d))) cls.push('has-rec')
                    if (d.getDay() === 6) cls.push('sat-col')
                    if (d.getDay() === 0) cls.push('sun-col')
                    return cls.join(' ')
                  }}
                />
              </div>
            )}
            {mode === 'month' && (
              <label className="block text-sm font-medium">Month
                <input className="input mt-1" type="month" max={todayStr.slice(0, 7)} value={period.month} onChange={e => setPeriod({ ...period, month: e.target.value })} required /></label>
            )}
            {mode === 'year' && (
              <label className="block text-sm font-medium">Year
                <input className="input mt-1" type="number" min="2000" max={new Date().getFullYear()} value={period.year} onChange={e => setPeriod({ ...period, year: e.target.value })} required /></label>
            )}
            <label className="block text-sm font-medium">{mode === 'day' ? 'Sales amount' : 'Total sales for the period'}
              <input className="input mt-1" type="number" inputMode="decimal" min="0" step="0.01" value={f.sales} onChange={e => setF({ ...f, sales: e.target.value })} required /></label>
            <label className="block text-sm font-medium">{mode === 'day' ? 'Collection amount' : 'Total collection for the period'}
              <input className="input mt-1" type="number" inputMode="decimal" min="0" step="0.01" value={f.collection} onChange={e => setF({ ...f, collection: e.target.value })} required /></label>
            <label className="block text-sm font-medium">Your name
              <input className="input mt-1" value={f.by} maxLength={60} autoComplete="name" placeholder="e.g. Nimal Perera" onChange={e => setF({ ...f, by: e.target.value })} required /></label>
            {mode !== 'day' && <p className="text-xs text-ink/60">The total is spread evenly over each day up to today. Existing daily entries in this period are replaced.</p>}
            <Notice m={msg} />
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1 justify-center" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn flex-1" disabled={busy}><Save size={18} />{busy ? 'Saving…' : 'Save entry'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

/* ───────────── user page (single or combined departments) ───────────── */
function DepartmentPage({ page }) {
  const { title, slugs } = PAGES[page]
  const [sp] = useSearchParams()
  const [tab, setTab] = useState(slugs.includes(sp.get('tab')) ? sp.get('tab') : slugs[0])
  const fromAdmin = useLocation().state?.admin

  useEffect(() => {
  const link = document.querySelector('link[rel="manifest"]')
  const old = link?.getAttribute('href')
  link?.setAttribute('href', `/manifests/${page}.json`)
  return () => { if (old) link?.setAttribute('href', old) }
}, [page])

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 pb-10">
      {fromAdmin && (
        <Link to="/admin/departments" className="btn-ghost w-fit">
          <ArrowLeft size={16} />Back to home
        </Link>
      )}
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

function RowMenu({ onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])
  return (
    <span ref={ref} className="relative inline-block">
      <button className="rounded p-1.5 text-ink/50 hover:bg-ink/10 hover:text-ink" onClick={() => setOpen(o => !o)} aria-label="More actions" aria-haspopup="true" aria-expanded={open}>
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-md border border-ink/10 bg-white shadow-lg">
          {onEdit && <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink/5" onClick={() => { setOpen(false); onEdit() }}><Pencil size={14} />Edit</button>}
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50" onClick={() => { setOpen(false); onDelete() }}><Trash2 size={14} />Delete</button>
        </div>
      )}
    </span>
  )
}

function DamagePage() {
  const fromAdmin = useLocation().state?.admin
  const todayStr = iso(new Date())
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [date, setDate] = useState(todayStr)
  const [rows, setRows] = useState(() => store.get('damages', []))
  const [f, setF] = useState({ printing: '', accubind: '', binding: '', by: localStorage.getItem('by') || '' })
  const [msg, setMsg] = useState(null)
  const [toast, setToast] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await (await call('/api/damages')).json()
      setRows(data); store.set('damages', data)
    } catch { /* offline: keep cached history */ }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const openEdit = r => {
    setEditing(r); setDate(r.record_date)
    setF({ printing: String(r.printing_damage), accubind: String(r.accubind_damage), binding: String(r.binding_damage), by: r.submitted_by })
    setMsg(null); setOpen(true)
  }
  const removeDamage = async r => {
    if (!window.confirm(`Delete the damage entry for ${sriDate(r.record_date)}?`)) return
    try {
      await call(fromAdmin ? `/api/admin/damages/${r.id}` : `/api/damages/${r.id}`, { method: 'DELETE' })
      await refresh()
    } catch (e) { setToast({ t: 'err', m: e.status ? e.message : 'Could not delete. Check your connection.' }) }
  }

  const submit = async e => {
    e.preventDefault(); setMsg(null)
    const by = f.by.trim().replace(/\s+/g, ' ')
    if (!NAME_RE.test(by)) return setMsg({ t: 'err', m: "Enter your name: 2–60 characters, letters, spaces, . ' or - only." })
    const p = parseFloat(f.printing) || 0, a = parseFloat(f.accubind) || 0, b = parseFloat(f.binding) || 0
    if (p < 0 || a < 0 || b < 0) return setMsg({ t: 'err', m: 'Damage values must be 0 or more.' })
    if (!date || date > todayStr) return setMsg({ t: 'err', m: 'Choose a date that is today or earlier.' })
    localStorage.setItem('by', by)
    const body = { record_date: date, printing_damage: p, accubind_damage: a, binding_damage: b, submitted_by: by }
    setBusy(true)
    try {
      if (editing) await call(`/api/damages/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      else await call('/api/damages', { method: 'POST', body: JSON.stringify(body) })
      setToast({ t: 'ok', m: `Damage entry saved for ${sriDate(date)}.` })
      setOpen(false); setEditing(null); setF({ printing: '', accubind: '', binding: '', by })
      await refresh()
    } catch (err) {
      if (err.status) setMsg({ t: 'err', m: err.message })
      else {
        const q = store.get('damageQueue', []); store.set('damageQueue', [...q, body])
        setRows([{ ...body, id: 'local-' + Date.now() }, ...rows])
        setToast({ t: 'warn', m: 'You are offline. Entry stored on this device and will sync automatically.' }); setOpen(false)
      }
    }
    setBusy(false)
  }

  return (
    <>
      {fromAdmin && <AdminNav />}
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold uppercase">
            <Logo slug="i-photobook" className="h-8 w-8" />I Photobook — Damage Log
          </h1>
          <button className="btn" onClick={() => { setEditing(null); setDate(todayStr); setMsg(null); setOpen(true) }}>+ ADD DAMAGE</button>
        </div>
        <Notice m={toast} />

        <section className="card">
          <h2 className="mb-2 font-semibold uppercase">Damage History</h2>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white"><tr className="border-b border-ink/10">
                <th className="py-2">Date</th><th className="text-right">Printing</th><th className="text-right">Accubind</th><th className="text-right">Binding</th><th className="pl-4">By</th><th className="pl-2 no-print" /></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-ink/5 hover:bg-ink/5">
                    <td className="py-2 whitespace-nowrap">{sriDate(r.record_date)}</td>
                    <td className="text-right">{money(r.printing_damage)}</td>
                    <td className="text-right">{money(r.accubind_damage)}</td>
                    <td className="text-right">{money(r.binding_damage)}</td>
                    <td className="pl-4">{r.submitted_by}</td>
                    <td className="pl-2 text-right">
                      {(fromAdmin || within24h(r.created_at)) && <RowMenu onEdit={() => openEdit(r)} onDelete={() => removeDamage(r)} />}
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} className="py-6 text-center text-ink/60">No damage entries yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {open && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
            <form role="dialog" aria-modal="true" aria-label="Add damage entry" onClick={e => e.stopPropagation()} onSubmit={submit} noValidate
              className="max-h-[92vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-xl bg-white p-4 sm:rounded-xl">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold uppercase">{editing ? 'Edit Damage Entry' : 'Add Damage Entry'}</h2>
                <button type="button" className="rounded p-1 text-2xl leading-none text-ink/60 hover:bg-ink/5" onClick={() => setOpen(false)} aria-label="Close">×</button>
              </div>
              <label className="block text-sm font-medium">Date
                <input className="input mt-1" type="date" max={todayStr} value={date} onChange={e => setDate(e.target.value)} required /></label>
              <label className="block text-sm font-medium">Printing damage
                <input className="input mt-1" type="number" inputMode="decimal" min="0" step="0.01" value={f.printing} onChange={e => setF({ ...f, printing: e.target.value })} /></label>
              <label className="block text-sm font-medium">Accubind damage
                <input className="input mt-1" type="number" inputMode="decimal" min="0" step="0.01" value={f.accubind} onChange={e => setF({ ...f, accubind: e.target.value })} /></label>
              <label className="block text-sm font-medium">Binding damage
                <input className="input mt-1" type="number" inputMode="decimal" min="0" step="0.01" value={f.binding} onChange={e => setF({ ...f, binding: e.target.value })} /></label>
              <label className="block text-sm font-medium">Your name
                <input className="input mt-1" value={f.by} maxLength={60} autoComplete="name" placeholder="e.g. Nimal Perera" onChange={e => setF({ ...f, by: e.target.value })} required /></label>
              <Notice m={msg} />
              <div className="flex gap-2">
                <button type="button" className="btn-ghost flex-1 justify-center" onClick={() => setOpen(false)}>Cancel</button>
                <button className="btn flex-1" disabled={busy}><Save size={18} />{busy ? 'Saving…' : 'Save entry'}</button>
              </div>
            </form>
          </div>
        )}
      </main>
    </>
  )
}
function ProjectsPage() {
  const todayStr = iso(new Date())
  const empty = { good_name: '', cost: '', expense_date: todayStr }
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null) // null = new, else the row being edited
  const [f, setF] = useState(empty)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try { setRows(await (await call('/api/projects')).json()) }
    catch (e) { setErr(e.status ? e.message : 'Cannot reach the server. Check your connection.') }
  }, [])
  useEffect(() => { load() }, [load])

  const openNew = () => { setEditing(null); setF(empty); setMsg(null); setOpen(true) }
  const openEdit = r => { setEditing(r); setF({ good_name: r.good_name, cost: String(r.cost), expense_date: r.expense_date }); setMsg(null); setOpen(true) }

  const submit = async e => {
    e.preventDefault(); setMsg(null)
    const name = f.good_name.trim()
    if (!name) return setMsg({ t: 'err', m: 'Enter the item or good name.' })
    const cost = parseFloat(f.cost)
    if (!(cost >= 0)) return setMsg({ t: 'err', m: 'Cost must be a number of 0 or more.' })
    const expense_date = f.expense_date || todayStr // blank date auto-fills to today
    setBusy(true)
    try {
      if (editing) await call(`/api/projects/${editing.id}`, { method: 'PUT', body: JSON.stringify({ good_name: name, cost, expense_date }) })
      else await call('/api/projects', { method: 'POST', body: JSON.stringify({ good_name: name, cost, expense_date }) })
      setOpen(false); await load()
    } catch (e) { setMsg({ t: 'err', m: e.status ? e.message : 'Cannot reach the server. Check your connection.' }) }
    setBusy(false)
  }

  const remove = async r => {
    if (!window.confirm(`Delete "${r.good_name}"?`)) return
    try { await call(`/api/projects/${r.id}`, { method: 'DELETE' }); await load() }
    catch (e) { setErr(e.status ? e.message : 'Could not delete. Check your connection.') }
  }

  const total = rows.reduce((t, r) => t + Number(r.cost), 0)

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold uppercase"><Briefcase size={24} />Project Expenses</h1>
        <button className="btn" onClick={openNew}>+ CREATE PROJECT</button>
      </div>
      <Notice m={err && { t: 'err', m: err }} />

      <section className="card">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold uppercase">History</h2>
          <p className="text-sm font-semibold">Total: {money(total)}</p></div>
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white"><tr className="border-b border-ink/10">
              <th className="py-2">Date</th><th>Item</th><th className="text-right">Cost</th><th className="pl-4 no-print" /></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-ink/5 hover:bg-ink/5">
                  <td className="py-2 whitespace-nowrap">{sriDate(r.expense_date)}</td>
                  <td>{r.good_name}</td>
                  <td className="text-right">{money(r.cost)}</td>
                  <td className="pl-4 text-right">
                    <RowMenu onEdit={() => openEdit(r)} onDelete={() => remove(r)} />
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4} className="py-6 text-center text-ink/60">No entries yet. Tap + CREATE PROJECT to add one.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <form role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onSubmit={submit} noValidate
            className="w-full max-w-md space-y-3 rounded-t-xl bg-white p-4 sm:rounded-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold uppercase">{editing ? 'Edit entry' : 'New project expense'}</h2>
              <button type="button" className="rounded p-1 text-2xl leading-none text-ink/60 hover:bg-ink/5" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>
            <label className="block text-sm font-medium">Good / item name
              <input className="input mt-1" value={f.good_name} maxLength={150} placeholder="ADD YOUR ITEM NAME"
                onChange={e => setF({ ...f, good_name: e.target.value })} required /></label>
            <label className="block text-sm font-medium">Cost
              <input className="input mt-1" type="number" inputMode="decimal" min="0" step="0.01" value={f.cost}
                onChange={e => setF({ ...f, cost: e.target.value })} required /></label>
            <label className="block text-sm font-medium">Date <span className="font-normal text-ink/60">(leave as today, or pick a past date)</span>
              <input className="input mt-1" type="date" max={todayStr} value={f.expense_date}
                onChange={e => setF({ ...f, expense_date: e.target.value })} /></label>
            <Notice m={msg} />
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1 justify-center" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn flex-1" disabled={busy}><Save size={18} />{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}

function AdminNav() {
  const link = ({ isActive }) => `flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium sm:flex-none ${isActive ? 'bg-white/15' : 'hover:bg-white/10'}`
  return (
    <nav className="no-print sticky top-0 z-10 bg-ink px-4 py-2 text-white">
      <Link to="/admin/departments" className="mb-2 inline-block text-lg font-bold">Summary</Link>
      <div className="flex flex-wrap gap-2">
        <NavLink to="/admin/departments" className={link}><Building2 size={18} />Departments</NavLink>
        <NavLink to="/admin/dashboard" className={link}><LayoutDashboard size={18} />MANAGE</NavLink>
        <NavLink to="/department/i-photobook-damage" state={{ admin: true }} className={link}><Logo slug="i-photobook" className="h-[18px] w-[18px]" />I PHO. DAM</NavLink>
        <NavLink to="/admin/projects" className={link}><Briefcase size={18} />PROJECT</NavLink>
      </div>
    </nav>
  )
}

function AdminShell() {
  return (
    <>
      <AdminNav />
      <Outlet />
    </>
  )
}

function TotalsCard() {
  const todayStr = iso(new Date())
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('monthly')
  const [from, setFrom] = useState(todayStr.slice(0, 8) + '01')
  const [to, setTo] = useState(todayStr)
  const [tot, setTot] = useState({ sales: 0, collection: 0 })

  const range = kind === 'today' ? { start: todayStr, end: todayStr }
    : kind === 'custom' ? { start: from, end: to } : rangeFor(kind)
  const invalid = kind === 'custom' && (!from || !to || from > to)

  useEffect(() => {
    if (invalid) return
    let live = true
    call(`/api/summary?start=${range.start}&end=${range.end}`).then(r => r.json())
      .then(s => live && setTot(s.totals)).catch(() => {})
    return () => { live = false }
  }, [range.start, range.end, invalid])

  const names = { today: 'Today', weekly: 'Last 7 days', monthly: 'This month', yearly: 'This year', custom: 'Custom' }

  return (
    <section className="card mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold uppercase">Total – All Departments</h2>
          <p className={`text-xs ${invalid ? 'text-red-700' : 'text-ink/60'}`}>
            {invalid ? 'From date must be on or before the To date.' : `${names[kind]} · ${range.start} → ${range.end}`}
          </p>
        </div>
        <button className="btn-ghost" onClick={() => setOpen(o => !o)} aria-expanded={open}>DATE FILTER</button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 rounded-md border border-ink/10 bg-paper p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {Object.entries(names).map(([k, l]) => (
              <button key={k} onClick={() => { setKind(k); if (k !== 'custom') setOpen(false) }}
                className={`rounded-md border px-3 py-2 text-sm font-medium ${kind === k ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white'}`}>{l}</button>
            ))}
          </div>
          {kind === 'custom' && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                <label className="block min-w-0 text-xs font-medium">From
                  <input type="date" className="input mt-1 min-w-0" value={from} max={to || todayStr} onChange={e => setFrom(e.target.value)} /></label>
                <label className="block min-w-0 text-xs font-medium">To
                  <input type="date" className="input mt-1 min-w-0" value={to} min={from} max={todayStr} onChange={e => setTo(e.target.value)} /></label>
              </div>
              <button className="btn w-full sm:w-auto" onClick={() => setOpen(false)}>Done</button>
            </>
          )}
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md bg-emerald-50 p-3"><p className="text-xs uppercase text-ink/70">Total sales</p><p className="text-2xl font-bold text-sale">{money(tot.sales)}</p></div>
        <div className="rounded-md bg-orange-50 p-3"><p className="text-xs uppercase text-ink/70">Total collection</p><p className="text-2xl font-bold text-coll">{money(tot.collection)}</p></div>
      </div>
    </section>
  )
}

function Departments() {
  const todayStr = iso(new Date())
  const [kind, setKind] = useState('today')
  const [from, setFrom] = useState(todayStr.slice(0, 8) + '01') // 1st of this month
  const [to, setTo] = useState(todayStr)
  const [totals, setTotals] = useState({})

  const range = kind === 'today' ? { start: todayStr, end: todayStr } : { start: from, end: to }
  const invalid = kind === 'custom' && (!from || !to || from > to)

  useEffect(() => {
    if (invalid) return
    let live = true
    call(`/api/summary?start=${range.start}&end=${range.end}`).then(r => r.json())
      .then(s => live && setTotals(Object.fromEntries(s.departments.map(d => [d.slug, d]))))
      .catch(() => {})
    return () => { live = false }
  }, [range.start, range.end, invalid])

  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="mb-3 text-2xl font-bold">Departments</h1>
      <div className="mb-3 space-y-3">
      <div className="flex gap-2">
        {[['today', 'TODAY'], ['custom', 'CUSTOM']].map(([k, l]) => (
          <button key={k} onClick={() => setKind(k)}
            className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium sm:flex-none ${kind === k ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white'}`}>{l}</button>
        ))}
      </div>
      {kind === 'custom' && (
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <label className="block min-w-0 text-xs font-medium">From
            <input type="date" className="input mt-1 min-w-0" value={from} max={to || todayStr} onChange={e => setFrom(e.target.value)} /></label>
          <label className="block min-w-0 text-xs font-medium">To
            <input type="date" className="input mt-1 min-w-0" value={to} min={from} max={todayStr} onChange={e => setTo(e.target.value)} /></label>
        </div>
      )}
    </div>
      <p className={`mb-4 text-sm ${invalid ? 'text-red-700' : 'text-ink/60'}`}>
        {invalid ? 'Choose a From date that is on or before the To date.'
          : kind === 'today' ? "Today's totals. Tap a department to see its details."
          : `Totals from ${from} to ${to}. Tap a department to see its details.`}
      </p>
      <div className="space-y-3">
        {DEPTS.map(d => {
          const t = totals[d.slug] || { sales: 0, collection: 0 }
          return (
            <Link key={d.slug} to={`/department/${d.page}?tab=${d.slug}`} state={{ admin: true }} className="card flex items-center gap-4 hover:shadow-md">
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
      <TotalsCard />
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

  const [filterOpen, setFilterOpen] = useState(false)
  const [depOpen, setDepOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

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
  setLogOpen(true)
  setTimeout(() => {
    document.body.classList.add('printing-log')
    window.onafterprint = () => document.body.classList.remove('printing-log')
    window.print()
  }, 150)
}

    const names = { daily: 'Today', weekly: 'Last 7 days', monthly: 'This month', yearly: 'This year', custom: 'Custom' }
  const chev = open => <ChevronRight size={20} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 pb-10">
      {/* FILTER BAR: DATE FILTER + EXPORT ALL only */}
      <div className="no-print space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={() => setFilterOpen(o => !o)} aria-expanded={filterOpen}>DATE FILTER</button>
          <button className="btn-ghost" onClick={() => exportXlsx('')}><Download size={16} />EXPORT ALL</button>
          <p className="w-full text-xs text-ink/60 sm:ml-2 sm:w-auto">{names[kind]} · {range.start} → {range.end}</p>
        </div>
        {filterOpen && (
          <div className="space-y-3 rounded-md border border-ink/10 bg-white p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {Object.entries(names).map(([k, l]) => (
                <button key={k} onClick={() => { pick(k); if (k !== 'custom') setFilterOpen(false) }}
                  className={`rounded-md border px-3 py-2 text-sm font-medium ${kind === k ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white'}`}>{l}</button>
              ))}
            </div>
            {kind === 'custom' && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                  <label className="block min-w-0 text-xs font-medium">From
                    <input type="date" className="input mt-1 min-w-0" value={range.start} max={range.end}
                      onChange={e => e.target.value && setRange({ ...range, start: e.target.value })} /></label>
                  <label className="block min-w-0 text-xs font-medium">To
                    <input type="date" className="input mt-1 min-w-0" value={range.end} min={range.start}
                      onChange={e => e.target.value && setRange({ ...range, end: e.target.value })} /></label>
                </div>
                <button className="btn w-full sm:w-auto" onClick={() => setFilterOpen(false)}>Done</button>
              </>
            )}
          </div>
        )}
      </div>
      <Notice m={err && { t: 'err', m: err }} />

      <section className="card no-print">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold uppercase">Add or Override an Entry</h2>
          <select className="input !w-auto" value={ov} onChange={e => setOv(e.target.value)}>
            <option value="">Choose department…</option>{DEPTS.map(d => <option key={d.slug} value={d.slug}>{d.name}</option>)}</select></div>
        {ov && <div className="mt-4"><DeptPanel key={ov} slug={ov} defaultName="Admin" /></div>}
      </section>

      {/* DEPARTMENTS (fold up) */}
      <section className="card">
        <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setDepOpen(o => !o)} aria-expanded={depOpen}>
          <h2 className="font-semibold uppercase">Departments ({range.start} → {range.end})</h2>{chev(depOpen)}
        </button>
        {depOpen && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(sum?.departments || []).map(d => {
              const dp = DEPTS.find(x => x.slug === d.slug)
              return (
                <div key={d.slug} className="rounded-lg border border-ink/10 p-3">
                  <Link to={`/department/${dp.page}?tab=${d.slug}`} state={{ admin: true }} className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-ink/10 bg-white p-1"><Logo slug={d.slug} className="h-full w-full" /></span>
                    <span className="font-semibold">{d.name}</span>
                  </Link>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-md bg-emerald-50 p-2"><p className="text-xs uppercase text-ink/70">Sales</p><p className="font-bold text-sale">{money(d.sales)}</p></div>
                    <div className="rounded-md bg-orange-50 p-2"><p className="text-xs uppercase text-ink/70">Collection</p><p className="font-bold text-coll">{money(d.collection)}</p></div>
                  </div>
                  <button className="btn-ghost no-print mt-3 w-full justify-center" onClick={() => exportXlsx(d.slug)}><Download size={14} />Excel</button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* AUDIT LOG (fold up) */}
      <section className="card log-area">
        <div className="flex items-center gap-2">
          <button className="flex flex-1 items-center justify-between gap-2 text-left" onClick={() => setLogOpen(o => !o)} aria-expanded={logOpen}>
            <h2 className="font-semibold uppercase">Audit Log ({range.start} → {range.end})</h2>{chev(logOpen)}
          </button>
          <button className="btn-ghost no-print" onClick={printLog}><Printer size={16} />Print log</button>
        </div>
        {logOpen && (
          <>
            <select className="input no-print mt-3 !w-auto" value={dept} onChange={e => setDept(e.target.value)}>
              <option value="">All departments</option>{DEPTS.map(d => <option key={d.slug} value={d.slug}>{d.name}</option>)}</select>
            <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs sm:text-sm">
              <thead><tr className="border-b border-ink/10"><th className="py-2">When</th><th>User</th><th>Action</th><th>Department</th><th>Record date</th><th className="text-right">Sales (old → new)</th><th className="text-right">Collection (old → new)</th></tr></thead>
              <tbody>{audit.map(a => (
                <tr key={a.id} className="border-b border-ink/5"><td className="py-1.5 whitespace-nowrap">{new Date(a.timestamp).toLocaleString()}</td><td>{a.changed_by}</td><td>{a.action_type}</td><td>{a.department}</td><td>{a.record_date}</td>
                  <td className="text-right whitespace-nowrap">{a.old_sales == null ? '—' : money(a.old_sales)} → {money(a.new_sales)}</td>
                  <td className="text-right whitespace-nowrap">{a.old_collection == null ? '—' : money(a.old_collection)} → {money(a.new_collection)}</td></tr>))}
                {!audit.length && <tr><td colSpan={7} className="py-6 text-center text-ink/60">No changes in this period.</td></tr>}</tbody>
            </table></div>
          </>
        )}
      </section>
    </main>
  )
}

/* ───────────── app root ───────────── */
export default function App() {
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(store.get('queue', []).length + store.get('damageQueue', []).length)
useEffect(() => {
    const sync = async () => { await flushQueue(); await flushDamageQueue(); setPending(store.get('queue', []).length + store.get('damageQueue', []).length) }
    const on = () => { setOnline(true); sync() }, off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    const t = setInterval(() => setPending(store.get('queue', []).length + store.get('damageQueue', []).length), 3000)
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
          <Route path="projects" element={<ProjectsPage />} />
        </Route>
        {Object.keys(PAGES).map(p => <Route key={p} path={`/department/${p}`} element={<DepartmentPage page={p} />} />)}
        <Route path="/department/i-photobook-damage" element={<DamagePage />} />
        <Route path="*" element={<Navigate to="/admin/departments" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
