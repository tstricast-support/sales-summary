import { useCallback, useEffect, useState,useRef } from 'react'
import { createPortal } from 'react-dom'
import { BrowserRouter, Routes, Route, NavLink, Link, Navigate, Outlet, useSearchParams, useLocation } from 'react-router-dom'
import { LineChart, Line, BarChart, Bar, PieChart as RePieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer, LabelList } from 'recharts'
import { LayoutDashboard, Building2, Download, Printer, WifiOff, Save, CheckCircle2, AlertCircle, Lock, ChevronRight, ArrowLeft, Briefcase, Pencil, MoreVertical, Trash2, PieChart, Bell } from 'lucide-react'
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
const PIE_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d']

const shortMoney = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
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

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Push notifications are not supported on this browser/device.')
    return
  }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  const { key } = await (await call('/api/push/public-key')).json()
  if (!key) return alert('Push notifications are not set up on the server yet.')
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  })
  const j = sub.toJSON()
  await call('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: sub.endpoint, keys: j.keys }),
  })
  alert('Notifications enabled on this device.')
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

function DeptPanel({ slug, defaultName = '', entryRef, totalsSlot }) {
  const isAdmin = defaultName === 'Admin'
  const todayStr = iso(new Date())
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('day')
  const [date, setDate] = useState(todayStr)
  const [period, setPeriod] = useState({ month: todayStr.slice(0, 7), year: String(new Date().getFullYear()) })
  const [range, setRange] = useState('monthly')
  const [customFrom, setCustomFrom] = useState(todayStr.slice(0, 8) + '01')
  const [customTo, setCustomTo] = useState(todayStr)
  const [customHist, setCustomHist] = useState([])
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
  const [tOpen, setTOpen] = useState(false)
  const tRef = useRef(null)
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 640px)').matches)


  const refresh = useCallback(async () => {
    try {
      const s = new Date(); s.setDate(s.getDate() - 364)
      const data = await (await call(`/api/records?department=${slug}&start=${iso(s)}&end=${iso(new Date())}`)).json()
      setHist(data); store.set('hist:' + slug, data)
    } catch { /* offline: keep cached history */ }
  }, [slug])

  useEffect(() => { setHist(store.get('hist:' + slug, [])); setToast(null); refresh() }, [slug, refresh])

  useEffect(() => {
    if (range !== 'custom' || !customFrom || !customTo || customFrom > customTo) return
    let live = true
    call(`/api/records?department=${slug}&start=${customFrom}&end=${customTo}`).then(r => r.json())
      .then(d => live && setCustomHist(d))
      .catch(() => live && setCustomHist(hist.filter(r => r.record_date >= customFrom && r.record_date <= customTo)))
    return () => { live = false }
  }, [range, slug, customFrom, customTo, hist])

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

  useEffect(() => {
  const mq = window.matchMedia('(min-width: 640px)')
  const h = e => setIsDesktop(e.matches)
  mq.addEventListener('change', h)
  return () => mq.removeEventListener('change', h)
  }, [])

  useEffect(() => {
    if (!tOpen) return
    const close = e => { if (tRef.current && !tRef.current.contains(e.target)) setTOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [tOpen])

const openEntry = useCallback(d => { setMode('day'); setDate(d || todayStr); setMsg(null); setOpen(true) }, [todayStr])

  useEffect(() => {
  if (entryRef) entryRef.current = openEntry
}, [entryRef, openEntry])

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

  const customInvalid = range === 'custom' && (!customFrom || !customTo || customFrom > customTo)

  // the date span currently driving BOTH the graph and Recent Entries below it
  const graphRange = (() => {
    if (range === 'custom') return { start: customFrom, end: customTo }
    if (range === 'weekly') { const s = new Date(); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return { start: iso(s), end: todayStr } } // Monday of THIS week -> today
    if (range === 'monthly') { const s = new Date(); s.setDate(1); return { start: iso(s), end: todayStr } } // 1st of THIS month -> today
    const s = new Date(); s.setMonth(0, 1) // Jan 1 of THIS year -> today
    return { start: iso(s), end: todayStr }
  })()

  // custom uses its own fetched dataset (can span further back than the 364-day `hist` cache)
  const sourceHist = range === 'custom' ? customHist : hist

  // chart data: weekly = last 7 days, monthly = last 30 days, yearly = per month (last 12),
  // custom = user-selected range (bucketed by day if <=31 days, else by month, like yearly)
  const chartData = (() => {
    const bucketByMonth = range === 'yearly' ||
      (range === 'custom' && !customInvalid && (new Date(graphRange.end) - new Date(graphRange.start)) / 86400000 > 31)
    const inRange = sourceHist.filter(r => r.record_date >= graphRange.start && r.record_date <= graphRange.end)
    if (bucketByMonth) {
      const m = {}
      inRange.forEach(r => {
        const k = r.record_date.slice(0, 7)
        m[k] = m[k] || { date: k, Sales: 0, Collection: 0 }
        m[k].Sales += Number(r.sales_amount); m[k].Collection += Number(r.collection_amount)
      })
      return Object.values(m).sort((a, b) => a.date.localeCompare(b.date)).slice(-12)
    }
    return inRange.sort((a, b) => a.record_date.localeCompare(b.record_date))
      .map(r => ({ date: r.record_date.slice(5), Sales: Number(r.sales_amount), Collection: Number(r.collection_amount) }))
  })()
  const rangeLabel = { weekly: 'THIS WEEK', monthly: 'THIS MONTH', yearly: 'THIS YEAR', custom: `${graphRange.start} → ${graphRange.end}` }[range]
  // Recent Entries follows the same filter as the graph above (weekly/monthly/yearly/custom) — no separate month picker
  const rows = sourceHist.filter(r => r.record_date >= graphRange.start && r.record_date <= graphRange.end)
    .sort((a, b) => a.record_date.localeCompare(b.record_date))
  const seg = on => `rounded-md border px-3 py-1.5 text-sm font-medium ${on ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white'}`
    const totalsBox = (
    <div ref={tRef} className="relative w-full sm:w-auto">
      <button onClick={() => setTOpen(o => !o)} aria-expanded={tOpen}
        className="flex w-full overflow-hidden rounded-md border border-ink/10 hover:border-ink/30 sm:w-auto">
        <span className="flex-1 bg-emerald-50 px-4 py-2.5 text-left sm:flex-none">
          <span className="block text-xs uppercase text-ink/60">Sales</span>
          <span className="block text-lg font-bold text-sale">{money(tot.sales)}</span>
        </span>
        <span className="flex-1 bg-orange-50 px-4 py-2.5 text-left sm:flex-none">
          <span className="block text-xs uppercase text-ink/60">Collection</span>
          <span className="block text-lg font-bold text-coll">{money(tot.collection)}</span>
        </span>
      </button>
      {tOpen && (
        <div className="absolute left-0 right-0 z-20 mt-2 space-y-3 rounded-md border border-ink/10 bg-white p-3 shadow-lg sm:right-auto sm:w-72">
          <p className="text-xs font-semibold uppercase text-ink/60">{totalRange.label}</p>
          <div className="grid grid-cols-2 gap-2">
            {[['date', 'Date'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']].map(([k, l]) => (
              <button key={k} onClick={() => setTMode(k)} className={seg(tMode === k)}>{l}</button>
            ))}
          </div>
          {(tMode === 'date' || tMode === 'week') && (
            <input type="date" className="input" max={todayStr} value={tDate} onChange={e => e.target.value && setTDate(e.target.value)} />
          )}
          {tMode === 'month' && (
            <input type="month" className="input" max={todayStr.slice(0, 7)} value={tMonth} onChange={e => e.target.value && setTMonth(e.target.value)} />
          )}
          {tMode === 'year' && (
            <input type="number" className="input" min="2000" max={new Date().getFullYear()} value={tYear} onChange={e => setTYear(e.target.value)} />
          )}
          <p className="text-xs text-ink/60">{tot.days} day{tot.days === 1 ? '' : 's'} with entries.</p>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      {totalsSlot ? createPortal(totalsBox, totalsSlot) : (
        <div className="flex flex-wrap items-center justify-between gap-3">{totalsBox}</div>
      )}

      <Notice m={toast} />

      {/* 1. GRAPH */}
      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold uppercase">Sales & Collection Trend – {rangeLabel}</h2>
          <div className="flex flex-wrap gap-2">
            {['weekly', 'monthly', 'yearly', 'custom'].map(k => <button key={k} onClick={() => setRange(k)} className={`${seg(range === k)} capitalize`}>{k}</button>)}
          </div>
        </div>
        {range === 'custom' && (
          <div className="mb-3 grid grid-cols-2 gap-3 sm:max-w-md">
            <label className="block min-w-0 text-xs font-medium">From
              <input type="date" className="input mt-1 min-w-0" value={customFrom} max={customTo || todayStr}
                onChange={e => e.target.value && setCustomFrom(e.target.value)} /></label>
            <label className="block min-w-0 text-xs font-medium">To
              <input type="date" className="input mt-1 min-w-0" value={customTo} min={customFrom} max={todayStr}
                onChange={e => e.target.value && setCustomTo(e.target.value)} /></label>
          </div>
        )}
        {customInvalid && <p className="mb-3 text-xs text-red-700">From date must be on or before the To date.</p>}
        {chartData.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" fontSize={12} /><YAxis fontSize={12} width={60} /><Tooltip formatter={v => money(v)} /><Legend />
              <Line type="monotone" dataKey="Sales" stroke="#0f766e" strokeWidth={2} dot={chartData.length < 15}>
                {isDesktop && <LabelList dataKey="Sales" position="top" formatter={shortMoney} style={{ fontSize: 10, fill: '#0f766e', fontWeight: 600 }} />}
              </Line>
              <Line type="monotone" dataKey="Collection" stroke="#c2410c" strokeWidth={2} dot={chartData.length < 15}>
                {isDesktop && <LabelList dataKey="Collection" position="bottom" formatter={shortMoney} style={{ fontSize: 10, fill: '#c2410c', fontWeight: 600 }} />}
              </Line></LineChart>
          </ResponsiveContainer>
        ) : <p className="py-16 text-center text-ink/60">No entries in this period. Tap + ENTRY to add one.</p>}
      </section>

      {/* 2. RECENT ENTRIES — filtered by the same date range selected for the graph above */}
      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold uppercase">Recent Entries</h2>
          <p className="text-xs text-ink/60">{graphRange.start} → {graphRange.end}</p>
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
              {!rows.length && <tr><td colSpan={4} className="py-6 text-center text-ink/60">No entries in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink/60">Tap a row to edit that day. Only the last 12 months are loaded.</p>
      </section>

      {/* 3. TOTAL */}
    {/* <section className="card">
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
    </section> */}

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
  const entryRef = useRef(null)
  const [totalsSlot, setTotalsSlot] = useState(null)

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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {slugs.map(s => <Logo key={s} slug={s} className="h-14 w-14 sm:h-16 sm:w-16" />)}
          <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        </div>
        <button className="btn" onClick={() => entryRef.current?.()}>+ ENTRY</button>
      </header>
      <div ref={setTotalsSlot} className="flex w-full justify-end" />
      {slugs.length > 1 && (
        <div role="tablist" className="flex gap-2">
          {slugs.map(s => (
            <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 font-medium sm:flex-none ${tab === s ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white'}`}>
              <Logo slug={s} className="h-5 w-5 rounded bg-white" />{deptName(s)}</button>
          ))}
        </div>
      )}
      <DeptPanel key={tab} slug={tab} entryRef={entryRef} totalsSlot={totalsSlot} />
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
  const emptyForm = { category_id: '', supplier_id: '', cost: '', expense_date: todayStr }
  const [rows, setRows] = useState([])
  const [categories, setCategories] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null) // null = new, else the row being edited
  const [f, setF] = useState(emptyForm)
  const [newCatMode, setNewCatMode] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newSupMode, setNewSupMode] = useState(false)
  const [newSupName, setNewSupName] = useState('')
  const [collapsed, setCollapsed] = useState({}) // category name -> collapsed?
  const [search, setSearch] = useState('')
  const [printCat, setPrintCat] = useState(null)
  const [printSup, setPrintSup] = useState(null)
  const [pieCat, setPieCat] = useState(null) // category name currently showing its pie chart
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try {
      const [p, c, s] = await Promise.all([
        call('/api/projects').then(r => r.json()),
        call('/api/project-categories').then(r => r.json()),
        call('/api/project-suppliers').then(r => r.json()),
      ])
      setRows(p); setCategories(c); setSuppliers(s)
    } catch (e) { setErr(e.status ? e.message : 'Cannot reach the server. Check your connection.') }
  }, [])
  useEffect(() => { load() }, [load])

  const openNew = () => { setEditing(null); setF(emptyForm); setNewCatMode(false); setNewSupMode(false); setMsg(null); setOpen(true) }
  const openEdit = r => {
    setEditing(r)
    setF({ category_id: String(r.category_id), supplier_id: String(r.supplier_id), cost: String(r.cost), expense_date: r.expense_date })
    setNewCatMode(false); setNewSupMode(false); setMsg(null); setOpen(true)
  }

  // creating a category/supplier here immediately adds it to the select list, ready to pick next time
  const addCategory = async () => {
    const name = newCatName.trim()
    if (!name) return setMsg({ t: 'err', m: 'Enter a category name first.' })
    try {
      const cat = await (await call('/api/project-categories', { method: 'POST', body: JSON.stringify({ name }) })).json()
      setCategories(cs => cs.some(c => c.id === cat.id) ? cs : [...cs, cat].sort((a, b) => a.name.localeCompare(b.name)))
      setF(p => ({ ...p, category_id: String(cat.id), supplier_id: '' }))
      setNewCatMode(false); setNewCatName('')
    } catch (e) { setMsg({ t: 'err', m: e.status ? e.message : 'Could not add category. Check your connection.' }) }
  }

  const addSupplier = async () => {
    const name = newSupName.trim()
    if (!f.category_id) return setMsg({ t: 'err', m: 'Choose or add a category first.' })
    if (!name) return setMsg({ t: 'err', m: 'Enter a supplier / worker name first.' })
    try {
      const sup = await (await call('/api/project-suppliers', {
        method: 'POST', body: JSON.stringify({ category_id: Number(f.category_id), name }),
      })).json()
      setSuppliers(ss => ss.some(s => s.id === sup.id) ? ss : [...ss, sup])
      setF(p => ({ ...p, supplier_id: String(sup.id) }))
      setNewSupMode(false); setNewSupName('')
    } catch (e) { setMsg({ t: 'err', m: e.status ? e.message : 'Could not add supplier. Check your connection.' }) }
  }

  const submit = async e => {
    e.preventDefault(); setMsg(null)
    if (!f.category_id) return setMsg({ t: 'err', m: 'Choose or add a category.' })
    if (!f.supplier_id) return setMsg({ t: 'err', m: 'Choose or add a supplier / worker.' })
    const cost = parseFloat(f.cost)
    if (!(cost >= 0)) return setMsg({ t: 'err', m: 'Amount must be a number of 0 or more.' })
    const expense_date = f.expense_date || todayStr // blank date auto-fills to today
    const body = { supplier_id: Number(f.supplier_id), cost, expense_date }
    setBusy(true)
    try {
      if (editing) await call(`/api/projects/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      else await call('/api/projects', { method: 'POST', body: JSON.stringify(body) })
      setOpen(false); await load()
    } catch (e) { setMsg({ t: 'err', m: e.status ? e.message : 'Cannot reach the server. Check your connection.' }) }
    setBusy(false)
  }

  const remove = async r => {
    if (!window.confirm(`Delete the ${money(r.cost)} payment to ${r.supplier_name}?`)) return
    try { await call(`/api/projects/${r.id}`, { method: 'DELETE' }); await load() }
    catch (e) { setErr(e.status ? e.message : 'Could not delete. Check your connection.') }
  }

  // professional report: Category -> Supplier -> payment entries, each level totalled
  const grouped = (() => {
    const cats = new Map()
    for (const r of rows) {
      if (!cats.has(r.category_name)) cats.set(r.category_name, { total: 0, suppliers: new Map() })
      const cat = cats.get(r.category_name)
      cat.total += Number(r.cost)
      if (!cat.suppliers.has(r.supplier_name)) cat.suppliers.set(r.supplier_name, { total: 0, entries: [] })
      const sup = cat.suppliers.get(r.supplier_name)
      sup.total += Number(r.cost)
      sup.entries.push(r)
    }
    let list = [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const q = search.trim().toLowerCase()
    if (q) {
      list = list
        .map(([catName, cat]) => {
          const catMatches = catName.toLowerCase().includes(q)
          const supEntries = [...cat.suppliers.entries()]
            .filter(([supName]) => catMatches || supName.toLowerCase().includes(q))
          if (!supEntries.length) return null
          return [catName, { ...cat, suppliers: new Map(supEntries) }]
        })
        .filter(Boolean)
    }
    return list
  })()
  const grandTotal = rows.reduce((t, r) => t + Number(r.cost), 0)
  const toggleCat = name => setCollapsed(c => ({ ...c, [name]: !c[name] }))

  const printCategory = catName => {
  setPrintCat(catName)
  setTimeout(() => {
    document.body.classList.add('printing-category')
    window.onafterprint = () => { document.body.classList.remove('printing-category'); setPrintCat(null) }
    window.print()
  }, 150)
}

  const printSupplier = (catName, supName) => {
  setPrintSup({ cat: catName, sup: supName })
  setTimeout(() => {
    document.body.classList.add('printing-supplier')
    window.onafterprint = () => { document.body.classList.remove('printing-supplier'); setPrintSup(null) }
    window.print()
  }, 150)
}

const togglePie = catName => {
  setCollapsed(c => ({ ...c, [catName]: true })) // roll this category open
  setPieCat(p => (p === catName ? null : catName))
}

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold uppercase"><Briefcase size={24} />Project Expenses</h1>
        <button className="btn" onClick={openNew}>+ ADD PAYMENT</button>
      </div>
      <Notice m={err && { t: 'err', m: err }} />

      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold uppercase">Expense Report - by Category</h2>
          <p className="text-sm font-semibold">Grand total: {money(grandTotal)}</p>
        </div>
        <input
            type="text"
            className="input mb-3 w-full"
            placeholder="Search category or supplier / worker…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        {!grouped.length && <p className="py-10 text-center text-ink/60">No entries yet. Tap + ADD PAYMENT to add one.</p>}
        <div className="space-y-3">
          {grouped.map(([catName, cat]) => (
            <div key={catName} className="rounded-lg border border-ink/10">
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <button type="button" onClick={() => toggleCat(catName)}
                  className="flex flex-1 items-center gap-2 text-left font-semibold uppercase">
                  <ChevronRight size={18} className={`shrink-0 transition-transform ${collapsed[catName] ? 'rotate-90' : ''}`} />
                  {catName}
                </button>
                <span className="text-sm font-semibold">{money(cat.total)}</span>
                <button type="button" className="btn-ghost no-print !px-2 !py-1" onClick={() => togglePie(catName)}
                aria-label={`Show ${catName} pie chart`} title="Show supplier breakdown as a pie chart">
                <PieChart size={16} />
              </button>
                <button type="button" className="btn-ghost no-print !px-2 !py-1" onClick={() => printCategory(catName)}
                  aria-label={`Print ${catName} report`} title="Print A4 report for this category">
                  <Printer size={16} />
                </button>
              </div>
              {(search.trim() ? true : collapsed[catName]) && (
                <div className="space-y-2 border-t border-ink/10 p-3">
                  {pieCat === catName && (
                    <div className="mb-3 h-64 w-full no-print">
                      <ResponsiveContainer width="100%" height="100%">
                        <RePieChart>
                          <Pie
                            data={[...cat.suppliers.entries()].map(([supName, sup]) => ({ name: supName, value: sup.total }))}
                            dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label
                          >
                            {[...cat.suppliers.entries()].map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={v => money(v)} />
                          <Legend />
                        </RePieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {[...cat.suppliers.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([supName, sup]) => (
                    <div key={supName} className="rounded-md bg-paper p-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{supName}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-ink/80">{money(sup.total)}</p>
                          <button type="button" className="btn-ghost no-print !px-2 !py-1" onClick={() => printSupplier(catName, supName)}
                            aria-label={`Print ${supName} report`} title="Print A4 report for this supplier">
                            <Printer size={14} />
                          </button>
                        </div>
                      </div>
                      <table className="w-full text-left text-xs">
                        <tbody>
                          {sup.entries.map(r => (
                            <tr key={r.id} className="border-b border-ink/5 last:border-0">
                              <td className="py-1.5 pr-2 whitespace-nowrap text-ink/70">{sriDate(r.expense_date)}</td>
                              <td className="py-1.5 text-right">{money(r.cost)}</td>
                              <td className="py-1.5 pl-2 text-right no-print">
                                <RowMenu onEdit={() => openEdit(r)} onDelete={() => remove(r)} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
            </section>

      {/* A4 PRINT REPORT — invisible on screen, shown only while printing */}
      {printCat && (() => {
        const entry = grouped.find(([name]) => name === printCat)
        if (!entry) return null
        const [name, cat] = entry
        return (
          <div className="cat-print-area p-6">
            <div className="mb-4 flex items-center justify-between border-b border-ink/20 pb-3">
              <div>
                <h1 className="text-xl font-bold uppercase">{name}</h1>
                <p className="text-sm text-ink/60">Project Expense Report</p>
              </div>
              <div className="text-right text-sm text-ink/60">
                <p>Generated {sriDate(todayStr)}</p>
                <p className="font-semibold text-ink">Total: {money(cat.total)}</p>
              </div>
            </div>
            {[...cat.suppliers.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([supName, sup]) => (
                    <div key={supName} className="rounded-md bg-paper p-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{supName}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-ink/80">{money(sup.total)}</p>
                          <button type="button" className="btn-ghost no-print !px-2 !py-1" onClick={() => printSupplier(catName, supName)}
                            aria-label={`Print ${supName} report`} title="Print A4 report for this supplier">
                            <Printer size={14} />
                          </button>
                        </div>
                      </div>
                <table className="w-full text-left text-sm">
                  <thead><tr className="text-xs uppercase text-ink/60"><th className="py-1">Date</th><th className="py-1 text-right">Amount</th></tr></thead>
                  <tbody>
                    {sup.entries.slice().sort((a, b) => a.expense_date.localeCompare(b.expense_date)).map(r => (
                      <tr key={r.id}><td className="py-0.5">{sriDate(r.expense_date)}</td><td className="py-0.5 text-right">{money(r.cost)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div className="mt-4 flex justify-end border-t border-ink/20 pt-2 text-base font-bold">
              <p>Grand Total: {money(cat.total)}</p>
            </div>
          </div>
        )
      })()}

      {/* A4 PRINT REPORT — single supplier — invisible on screen, shown only while printing */}
      {printSup && (() => {
        const entry = grouped.find(([name]) => name === printSup.cat)
        const sup = entry && entry[1].suppliers.get(printSup.sup)
        if (!sup) return null
        const entries = sup.entries.slice().sort((a, b) => a.expense_date.localeCompare(b.expense_date))
        return (
          <div className="sup-print-area p-6">
            <div className="mb-4 flex items-center justify-between border-b border-ink/20 pb-3">
              <div>
                <h1 className="text-xl font-bold uppercase">{printSup.sup}</h1>
                <p className="text-sm text-ink/60">{printSup.cat} · Project Expense Report</p>
              </div>
              <div className="text-right text-sm text-ink/60">
                <p>Generated {sriDate(todayStr)}</p>
                <p className="font-semibold text-ink">Total: {money(sup.total)}</p>
              </div>
            </div>
            <table className="w-full text-left text-sm">
              <thead><tr className="text-xs uppercase text-ink/60"><th className="py-1">Date</th><th className="py-1 text-right">Amount</th></tr></thead>
              <tbody>
                {entries.map(r => (
                  <tr key={r.id}><td className="py-0.5">{sriDate(r.expense_date)}</td><td className="py-0.5 text-right">{money(r.cost)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex justify-end border-t border-ink/20 pt-2 text-base font-bold">
              <p>Total: {money(sup.total)}</p>
            </div>
          </div>
        )
      })()}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <form role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onSubmit={submit} noValidate
            className="max-h-[92vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-xl bg-white p-4 sm:rounded-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold uppercase">{editing ? 'Edit payment' : 'New payment'}</h2>
              <button type="button" className="rounded p-1 text-2xl leading-none text-ink/60 hover:bg-ink/5" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>

            <label className="block text-sm font-medium">Category
              <select className="input mt-1" value={newCatMode ? '__new' : f.category_id}
                onChange={e => {
                  if (e.target.value === '__new') { setNewCatMode(true); setNewCatName('') }
                  else { setNewCatMode(false); setF(p => ({ ...p, category_id: e.target.value, supplier_id: '' })) }
                }}>
                <option value="">Choose category…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new">+ Add new category…</option>
              </select>
            </label>
            {newCatMode && (
              <div className="flex gap-2">
                <input className="input" placeholder="e.g. DD Engineering Building" maxLength={150}
                  value={newCatName} onChange={e => setNewCatName(e.target.value)} />
                <button type="button" className="btn-ghost shrink-0" onClick={addCategory}>Add</button>
              </div>
            )}

            <label className="block text-sm font-medium">Supplier / worker
              <select className="input mt-1" disabled={!f.category_id} value={newSupMode ? '__new' : f.supplier_id}
                onChange={e => {
                  if (e.target.value === '__new') { setNewSupMode(true); setNewSupName('') }
                  else { setNewSupMode(false); setF(p => ({ ...p, supplier_id: e.target.value })) }
                }}>
                <option value="">{f.category_id ? 'Choose supplier…' : 'Choose a category first'}</option>
                {suppliers.filter(s => String(s.category_id) === String(f.category_id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                {f.category_id && <option value="__new">+ Add new supplier…</option>}
              </select>
            </label>
            {newSupMode && (
              <div className="flex gap-2">
                <input className="input" placeholder="e.g. Sunil Wood Worker" maxLength={150}
                  value={newSupName} onChange={e => setNewSupName(e.target.value)} />
                <button type="button" className="btn-ghost shrink-0" onClick={addSupplier}>Add</button>
              </div>
            )}

            <label className="block text-sm font-medium">Amount paid
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
      <div className="flex flex-wrap items-center gap-2">
        <NavLink to="/admin/departments" className={link}><Building2 size={18} />DEPARTMENTS</NavLink>
        <NavLink to="/department/i-photobook-damage" state={{ admin: true }} className={link}>I PHO. DAM</NavLink>
        <NavLink to="/admin/projects" className={link}><Briefcase size={18} />PROJECT</NavLink>
        <NavLink to="/admin/dashboard" className={link}><LayoutDashboard size={18} />MANAGE</NavLink>
        <button type="button" onClick={enablePushNotifications}
          className="ml-auto flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-white/10"
          title="Get a phone notification whenever a department submits sales/collection">
          <Bell size={18} />NOTIFY ME
        </button>
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

function Departments() {
  const todayStr = iso(new Date())
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('monthly')
  const [from, setFrom] = useState(todayStr.slice(0, 8) + '01')
  const [to, setTo] = useState(todayStr)
  const [totals, setTotals] = useState({})
  const [tot, setTot] = useState({ sales: 0, collection: 0 })

  const range = kind === 'today' ? { start: todayStr, end: todayStr }
    : kind === 'custom' ? { start: from, end: to } : rangeFor(kind)
  const invalid = kind === 'custom' && (!from || !to || from > to)

  // one fetch drives BOTH the per-department cards and the total box below
  useEffect(() => {
    if (invalid) return
    let live = true
    call(`/api/summary?start=${range.start}&end=${range.end}`).then(r => r.json())
      .then(s => {
        if (!live) return
        setTotals(Object.fromEntries(s.departments.map(d => [d.slug, d])))
        setTot(s.totals)
      })
      .catch(() => {})
    return () => { live = false }
  }, [range.start, range.end, invalid])

  const names = { today: 'Today', weekly: 'Last 7 days', monthly: 'This month', yearly: 'This year', custom: 'Custom' }

  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="mb-3 text-2xl font-bold">DEPARTMENTS</h1>
      <p className={`mb-4 text-sm ${invalid ? 'text-red-700' : 'text-ink/60'}`}>
        {invalid ? 'From date must be on or before the To date.' : `${names[kind]} · ${range.start} → ${range.end}. Tap a department to see its details.`}
      </p>
            <div className="mb-4 flex w-full justify-end">
        <div className="relative w-full sm:w-auto">
          <button onClick={() => setOpen(o => !o)} aria-expanded={open}
            className="flex w-full overflow-hidden rounded-md border border-ink/10 hover:border-ink/30 sm:w-auto">
            <span className="flex-1 bg-emerald-50 px-4 py-2.5 text-left sm:flex-none">
              <span className="block text-xs uppercase text-ink/60">Sales</span>
              <span className="block text-lg font-bold text-sale">{money(tot.sales)}</span>
            </span>
            <span className="flex-1 bg-orange-50 px-4 py-2.5 text-left sm:flex-none">
              <span className="block text-xs uppercase text-ink/60">Collection</span>
              <span className="block text-lg font-bold text-coll">{money(tot.collection)}</span>
            </span>
          </button>

          {open && (
            <div className="absolute left-0 right-0 z-20 mt-2 space-y-2 rounded-md border border-ink/10 bg-white p-3 shadow-lg sm:right-auto sm:w-72">
              <p className="text-xs font-semibold uppercase text-ink/60">
                {invalid ? 'From date must be on or before the To date.' : `${names[kind]} · ${range.start} → ${range.end}`}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(names).map(([k, l]) => (
                  <button key={k} onClick={() => { setKind(k); if (k !== 'custom') setOpen(false) }}
                    className={`rounded-md border px-3 py-2 text-sm font-medium ${kind === k ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white'}`}>{l}</button>
                ))}
              </div>
              {kind === 'custom' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
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
        </div>
      </div>
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
                <span className="mt-1 grid grid-cols-[140px_1fr] gap-y-0.5 text-sm">
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

  const [filterOpen, setFilterOpen] = useState(false)
  const [depOpen, setDepOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

  const [manageOpen, setManageOpen] = useState(false)
  const [categories, setCategories] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [editingCat, setEditingCat] = useState(null)
  const [editingSup, setEditingSup] = useState(null)
  const [editName, setEditName] = useState('')
  const [catBusy, setCatBusy] = useState(false)
  const [manageErr, setManageErr] = useState('')

  const loadCatSup = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        call('/api/project-categories').then(r => r.json()),
        call('/api/project-suppliers').then(r => r.json()),
      ])
      setCategories(c); setSuppliers(s)
    } catch { setManageErr('Could not load categories/suppliers.') }
  }, [])
  useEffect(() => { loadCatSup() }, [loadCatSup])

  const startEditCat = c => { setEditingSup(null); setEditingCat(c.id); setEditName(c.name); setManageErr('') }
  const startEditSup = s => { setEditingCat(null); setEditingSup(s.id); setEditName(s.name); setManageErr('') }
  const cancelEdit = () => { setEditingCat(null); setEditingSup(null); setEditName('') }

  const saveCategory = async id => {
    const name = editName.trim()
    if (!name) return setManageErr('Enter a category name.')
    setCatBusy(true)
    try {
      await call(`/api/project-categories/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })
      cancelEdit(); await loadCatSup()
    } catch (e) { setManageErr(e.message || 'Could not rename category.') }
    setCatBusy(false)
  }

  const saveSupplier = async s => {
    const name = editName.trim()
    if (!name) return setManageErr('Enter a supplier name.')
    setCatBusy(true)
    try {
      await call(`/api/project-suppliers/${s.id}`, { method: 'PUT', body: JSON.stringify({ category_id: s.category_id, name }) })
      cancelEdit(); await loadCatSup()
    } catch (e) { setManageErr(e.message || 'Could not rename supplier.') }
    setCatBusy(false)
  }

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

      {/* CATEGORIES & SUPPLIERS (fold up) */}
      <section className="card no-print">
        <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setManageOpen(o => !o)} aria-expanded={manageOpen}>
          <h2 className="font-semibold uppercase">Categories & Suppliers</h2>{chev(manageOpen)}
        </button>
        {manageOpen && (
          <div className="mt-3 space-y-3">
            <Notice m={manageErr && { t: 'err', m: manageErr }} />
            {categories.map(c => (
              <div key={c.id} className="rounded-lg border border-ink/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  {editingCat === c.id ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <input className="input flex-1" value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
                      <button className="btn !px-3" disabled={catBusy} onClick={() => saveCategory(c.id)}>Save</button>
                      <button className="btn-ghost !px-3" onClick={cancelEdit}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <span className="font-semibold">{c.name}</span>
                      <button className="btn-ghost !px-2 !py-1" onClick={() => startEditCat(c)} aria-label={`Edit ${c.name}`}>
                        <Pencil size={14} />Edit
                      </button>
                    </>
                  )}
                </div>
                <div className="mt-2 space-y-1.5 pl-3">
                  {suppliers.filter(s => s.category_id === c.id).map(s => (
                    <div key={s.id} className="flex items-center justify-between gap-2 border-t border-ink/5 pt-1.5 first:border-t-0 first:pt-0">
                      {editingSup === s.id ? (
                        <div className="flex flex-1 flex-wrap items-center gap-2">
                          <input className="input flex-1" value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
                          <button className="btn !px-3" disabled={catBusy} onClick={() => saveSupplier(s)}>Save</button>
                          <button className="btn-ghost !px-3" onClick={cancelEdit}>Cancel</button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm text-ink/80">{s.name}</span>
                          <button className="btn-ghost !px-2 !py-1" onClick={() => startEditSup(s)} aria-label={`Edit ${s.name}`}>
                            <Pencil size={14} />Edit
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                  {!suppliers.some(s => s.category_id === c.id) && <p className="text-xs text-ink/50">No suppliers yet.</p>}
                </div>
              </div>
            ))}
            {!categories.length && <p className="py-4 text-center text-ink/60">No categories yet. Add one from the Project page.</p>}
          </div>
        )}
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
