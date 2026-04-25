import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'

const API = (import.meta.env.VITE_API_URL || 'http://localhost:3002').replace(/\/$/, '')

// User key — stored in localStorage, generated on first visit
let _userKey = localStorage.getItem('task_user_key') || ''
function getUserKey() { return _userKey }
function setUserKey(k) { _userKey = k; localStorage.setItem('task_user_key', k) }
function apiUrl(path) {
  const key = _userKey
  const sep = path.includes('?') ? '&' : '?'
  return `${API}${path}${key ? `${sep}key=${encodeURIComponent(key)}` : ''}`
}
const STATUS_ORDER = ['todo', 'in_progress', 'done']
const STATUS_LABELS = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' }
const STATUS_COLORS = { todo: '#9ca3af', in_progress: '#f59e0b', done: '#10b981' }
const PRIORITY_COLORS = { low: '#9ca3af', medium: '#f59e0b', high: '#ef4444' }
const SOURCE_ICONS = { gmail: '✉', github: '⌥', web: '🌐', slack: '💬', notion: 'N', whatsapp: '💬', twitter: '𝕏', linear: '◆', manual: '✏' }
const PRIORITY_R = { low: 7, medium: 10, high: 14 }
const NODE_SIZE_R = { s: 6, m: 10, l: 15, xl: 22 }
const NODE_PALETTE = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899']
const STOPWORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','was','are','were','be','been','have','has','had','do','does','did','will','would','could','should','may','might','this','that','these','those','i','you','he','she','we','they','it','my','your','our','their','its','me','him','her','us','them','reply','please','hi','hello','dear','thanks','thank','regards','email','re','fw','fwd'])
const NODE_DEFAULT_COLORS = ['#7c6ff7','#3b82f6','#14b8a6','#f97316','#ec4899','#8b5cf6','#06b6d4','#a3e635','#f43f5e','#0ea5e9']

function taskDefaultColor(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffff
  return NODE_DEFAULT_COLORS[Math.abs(h) % NODE_DEFAULT_COLORS.length]
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function initials(name) {
  if (!name) return '?'
  return name.includes('@') ? name[0].toUpperCase() : name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function taskKeywords(t) {
  return new Set(`${t.title} ${t.notes || ''}`.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w)))
}

function sharedKeywords(a, b) {
  const ak = taskKeywords(a), bk = taskKeywords(b)
  return [...ak].filter(w => bk.has(w)).slice(0, 3)
}

function matchesSearch(task, q) {
  if (!q) return true
  const lq = q.toLowerCase()
  return task.title.toLowerCase().includes(lq) ||
    (task.notes || '').toLowerCase().includes(lq) ||
    (task.assignees || []).some(a => a.toLowerCase().includes(lq)) ||
    (task.actionType || '').toLowerCase().includes(lq) ||
    (task.source?.type || '').toLowerCase().includes(lq)
}

function HighlightedText({ text, keywords }) {
  if (!text || !keywords?.length) return <>{text}</>
  const pattern = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(pattern)
  return <>{parts.map((p, i) => keywords.some(k => k.toLowerCase() === p.toLowerCase()) ? <mark key={i} className="kw-mark">{p}</mark> : p)}</>
}

function Avatar({ name, size = 28 }) {
  const bg = ['#7c6ff7','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6'][name.charCodeAt(0) % 6]
  return <span className="avatar" style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}>{initials(name)}</span>
}

function fileIcon(mime = '') {
  if (mime.startsWith('image/')) return '🖼'
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return '📊'
  if (mime.includes('word') || mime.includes('document')) return '📝'
  if (mime.includes('zip') || mime.includes('archive')) return '🗜'
  return '📎'
}

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

// ── Graph ─────────────────────────────────────────────────────────────────────

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function GraphView({ tasks, onSelect, onRefresh, theme }) {
  const canvasRef = useRef(null)
  const stateRef = useRef({
    nodes: [], edges: [],
    hovered: null, hoveredEdge: null,
    frame: null, interaction: null,
    search: '',
    pan: { x: 0, y: 0 }, scale: 1,
    pinned: new Set(),
    alpha: 1.0,
    taskIds: '',
  })
  const drawRef = useRef(null)
  const kickRef = useRef(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [graphSearch, setGraphSearch] = useState('')
  const [activeKw, setActiveKw] = useState('')

  // Sidebar keywords: words appearing in 2+ tasks, sorted by frequency
  const sidebarKeywords = (() => {
    const freq = {}
    tasks.forEach(t => {
      ;[...taskKeywords(t)].forEach(kw => { freq[kw] = (freq[kw] || 0) + 1 })
    })
    return Object.entries(freq)
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 28)
      .map(([kw, n]) => ({ kw, n }))
  })()

  // Active filter: sidebar keyword takes precedence over text search
  const effectiveSearch = activeKw || graphSearch

  useEffect(() => {
    stateRef.current.search = effectiveSearch
    if (drawRef.current && !stateRef.current.frame) drawRef.current()
  }, [effectiveSearch])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = devicePixelRatio
    const state = stateRef.current

    canvas.width  = canvas.offsetWidth  * dpr
    canvas.height = canvas.offsetHeight * dpr

    const W0 = canvas.offsetWidth
    const H0 = canvas.offsetHeight

    const isDark = theme === 'dark'
    const labelBg   = isDark ? 'rgba(10,9,8,0.88)'       : 'rgba(252,249,244,0.94)'
    const labelFg   = isDark ? 'rgba(240,232,220,0.9)'   : 'rgba(44,34,24,0.9)'
    const pillBg    = isDark ? 'rgba(10,9,8,0.92)'        : 'rgba(252,249,244,0.96)'
    const pillBdr   = isDark ? 'rgba(124,111,247,0.4)'   : 'rgba(108,92,231,0.45)'
    const pillTxt   = isDark ? '#b8b3ff'                  : '#5b52cc'
    const edgeSolid = isDark ? 'rgba(124,111,247,0.6)'   : 'rgba(108,92,231,0.5)'
    const edgeKw    = isDark ? 'rgba(124,111,247,0.2)'   : 'rgba(108,92,231,0.18)'

    const newIds = tasks.map(t => t.id).join(',')
    const idsChanged = newIds !== state.taskIds
    state.taskIds = newIds

    const existingById = Object.fromEntries(state.nodes.map(nd => [nd.id, nd]))
    const n = tasks.length
    state.nodes = tasks.map((t, i) => {
      const nodeR = t.nodeSize ? (NODE_SIZE_R[t.nodeSize] ?? 10) : (PRIORITY_R[t.priority] || 10)
      const ex = existingById[t.id]
      if (ex) { ex.task = t; ex.r = nodeR; return ex }
      const angle = (i / n) * Math.PI * 2
      const radius = Math.min(W0, H0) * 0.28
      return { id: t.id, task: t, x: W0 / 2 + Math.cos(angle) * radius, y: H0 / 2 + Math.sin(angle) * radius, vx: 0, vy: 0, r: nodeR }
    })
    if (idsChanged) state.alpha = Math.max(state.alpha, 0.5)

    const nodeMap = Object.fromEntries(state.nodes.map(nd => [nd.id, nd]))
    const seen = new Set()
    state.edges = []
    tasks.forEach(t => {
      const allLinks = [...(t.linkedTasks || []), ...(t.keywordLinks || [])]
      allLinks.forEach(lid => {
        const key = [t.id, lid].sort().join('|')
        if (!seen.has(key) && nodeMap[lid]) {
          seen.add(key)
          const target = tasks.find(x => x.id === lid)
          const parentChild = t.parentId === lid || target?.parentId === t.id
          state.edges.push({
            a: nodeMap[t.id], b: nodeMap[lid],
            keyword: (t.keywordLinks || []).includes(lid) && !parentChild,
            parentChild, aId: t.id, bId: lid,
            keywords: (t.keywordLinks || []).includes(lid) && !parentChild ? sharedKeywords(t, target || t) : [],
          })
        }
      })
      if (t.parentId && nodeMap[t.parentId]) {
        const key = [t.id, t.parentId].sort().join('|')
        if (!seen.has(key)) {
          seen.add(key)
          state.edges.push({ a: nodeMap[t.parentId], b: nodeMap[t.id], keyword: false, parentChild: true, aId: t.parentId, bId: t.id, keywords: [] })
        }
      }
    })

    const ctx = canvas.getContext('2d')

    function pill(x, y, w, h, r) {
      ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath()
    }

    function arrowHead(fx, fy, tx, ty, size) {
      const angle = Math.atan2(ty - fy, tx - fx)
      ctx.beginPath(); ctx.moveTo(tx, ty)
      ctx.lineTo(tx + Math.cos(angle + 2.5) * size, ty + Math.sin(angle + 2.5) * size)
      ctx.lineTo(tx + Math.cos(angle - 2.5) * size, ty + Math.sin(angle - 2.5) * size)
      ctx.closePath(); ctx.fill()
    }

    function draw() {
      const { pan, scale, nodes, edges, hovered, hoveredEdge, interaction, search, pinned } = state
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      ctx.save()
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, pan.x * dpr, pan.y * dpr)

      // ── Edges ──
      edges.forEach(edge => {
        const { a, b, keyword, parentChild, keywords } = edge
        const isHov = edge === hoveredEdge
        const aMatch = matchesSearch(a.task, search), bMatch = matchesSearch(b.task, search)
        const eAlpha = !search ? 1 : (aMatch && bMatch) ? 1 : (aMatch || bMatch) ? 0.2 : 0.04
        ctx.globalAlpha = eAlpha

        if (isHov) {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
          ctx.strokeStyle = 'rgba(239,68,68,0.9)'; ctx.lineWidth = 2.5; ctx.setLineDash([]); ctx.stroke()
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
          ctx.fillStyle = 'rgba(239,68,68,0.9)'; ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = 'white'; ctx.font = 'bold 11px -apple-system'; ctx.textAlign = 'center'; ctx.fillText('×', mx, my + 4)
        } else if (parentChild) {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
          ctx.strokeStyle = isDark ? 'rgba(251,191,36,0.6)' : 'rgba(217,119,6,0.55)'
          ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke()
          ctx.fillStyle = isDark ? 'rgba(251,191,36,0.6)' : 'rgba(217,119,6,0.55)'
          arrowHead(a.x, a.y, b.x, b.y, 8)
        } else {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
          ctx.strokeStyle = keyword ? edgeKw : edgeSolid
          ctx.lineWidth = keyword ? 1 : 1.5
          if (keyword) ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([])
          if (keywords?.length) {
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
            const fs = 9.5; ctx.font = `500 ${fs}px -apple-system`; ctx.textAlign = 'center'
            const label = keywords.join(' · '), tw = ctx.measureText(label).width, pad = 5
            const pw = tw + pad * 2, ph = fs * 1.5 + pad * 0.6
            ctx.fillStyle = pillBg; pill(mx - pw / 2, my - ph / 2, pw, ph, 4); ctx.fill()
            ctx.strokeStyle = pillBdr; ctx.lineWidth = 1; ctx.stroke()
            ctx.fillStyle = pillTxt; ctx.fillText(label, mx, my + fs * 0.35)
          }
        }
        ctx.globalAlpha = 1
      })

      // ── Node circles (pass 1) ──
      nodes.forEach(nd => {
        const matched = matchesSearch(nd.task, search)
        const ix = interaction
        const isSource = ix?.type === 'link' && ix.source === nd
        const isTarget = ix?.type === 'link' && ix.target === nd
        const isDragging = ix?.type === 'drag' && ix.node === nd
        const isHov = nd === hovered
        const isPinned = pinned.has(nd.id)
        ctx.globalAlpha = !search ? 1 : matched ? 1 : 0.12

        const fillColor = nd.task.nodeColor || taskDefaultColor(nd.task.id)
        const statusColor = STATUS_COLORS[nd.task.status] || '#9ca3af'
        const lit = isHov || isSource || isTarget || isDragging

        if (lit) {
          const g = ctx.createRadialGradient(nd.x, nd.y, 0, nd.x, nd.y, nd.r * 4)
          g.addColorStop(0, (isTarget ? '#10b981' : fillColor) + '44'); g.addColorStop(1, 'transparent')
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r * 4, 0, Math.PI * 2); ctx.fill()
        }

        // Outer link-zone ring hint on hover
        if (isHov && !ix) {
          ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r + 7, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(124,111,247,0.35)'; ctx.lineWidth = 1.2; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([])
        }

        // Fill with unique task color
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2)
        ctx.fillStyle = lit ? fillColor : fillColor + 'cc'; ctx.fill()
        // Border = status color (always visible)
        ctx.strokeStyle = lit ? statusColor : statusColor + 'aa'
        ctx.lineWidth = 2.2; ctx.stroke()
        if (nd.task.parentId) {
          ctx.beginPath(); ctx.arc(nd.x + nd.r * 0.7, nd.y - nd.r * 0.7, 4, 0, Math.PI * 2)
          ctx.fillStyle = isDark ? '#fbbf24' : '#d97706'; ctx.fill()
        }
        if (isPinned) {
          ctx.beginPath(); ctx.arc(nd.x - nd.r * 0.7, nd.y - nd.r * 0.7, 4, 0, Math.PI * 2)
          ctx.fillStyle = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.35)'; ctx.fill()
        }
        ctx.globalAlpha = 1
      })

      // ── Labels (pass 2 — priority-sorted with collision detection) ──
      const labelThreshold = nodes.length > 20 ? 0.7 : nodes.length > 10 ? 0.5 : 0.3
      const sortedForLabels = [...nodes].sort((a, b) => {
        if (a === hovered) return -1
        if (b === hovered) return 1
        const s = nd => (nd.task.linkedTasks?.length || 0) + (nd.task.keywordLinks?.length || 0) + nd.r
        return s(b) - s(a)
      })
      const placed = []
      sortedForLabels.forEach(nd => {
        const matched = matchesSearch(nd.task, search)
        const isSource = interaction?.type === 'link' && interaction.source === nd
        const isHov = nd === hovered
        ctx.globalAlpha = !search ? 1 : matched ? 1 : 0.12

        if (!isHov && scale < labelThreshold) { ctx.globalAlpha = 1; return }

        const maxLen = scale > 1.2 ? 30 : 22
        const label = nd.task.title.length > maxLen ? nd.task.title.slice(0, maxLen) + '…' : nd.task.title
        const fs = 11.5; ctx.font = `${isHov ? 600 : 400} ${fs}px -apple-system`; ctx.textAlign = 'center'
        const tw = ctx.measureText(label).width, lx = nd.x, ly = nd.y + nd.r + 14, pad = 4
        const bx1 = lx - tw / 2 - pad, by1 = ly - fs * 0.82
        const bx2 = bx1 + tw + pad * 2, by2 = by1 + fs * 1.5

        if (!isHov) {
          const overlap = placed.some(([x1, y1, x2, y2]) => bx1 < x2 + 3 && bx2 > x1 - 3 && by1 < y2 + 2 && by2 > y1 - 2)
          if (overlap) { ctx.globalAlpha = 1; return }
        }
        placed.push([bx1, by1, bx2, by2])

        ctx.fillStyle = labelBg; pill(bx1, by1, bx2 - bx1, by2 - by1, 3); ctx.fill()
        ctx.fillStyle = (isHov || isSource) ? (isDark ? '#fff' : '#2c2218') : labelFg
        ctx.fillText(label, lx, ly)
        if (isHov && nd.task.assignees?.length) {
          ctx.font = `10px -apple-system`; ctx.fillStyle = 'rgba(110,231,183,0.9)'
          ctx.fillText(nd.task.assignees.slice(0, 2).join(', '), nd.x, nd.y + nd.r + 27)
        }
        ctx.globalAlpha = 1
      })

      // ── Link-drag preview ──
      if (interaction?.type === 'link' && interaction.moved) {
        const { source, target, wx, wy } = interaction
        ctx.beginPath(); ctx.moveTo(source.x, source.y); ctx.lineTo(wx, wy)
        ctx.strokeStyle = target ? 'rgba(16,185,129,0.85)' : 'rgba(124,111,247,0.75)'
        ctx.lineWidth = 2; ctx.setLineDash([6, 3]); ctx.stroke(); ctx.setLineDash([])
        ctx.beginPath(); ctx.arc(wx, wy, 5, 0, Math.PI * 2)
        ctx.fillStyle = target ? '#10b981' : '#7c6ff7'; ctx.fill()
        if (target) {
          ctx.font = `11px -apple-system`; ctx.textAlign = 'center'; ctx.fillStyle = '#10b981'
          ctx.fillText('Release to link', wx, wy - 10)
        }
      }

      ctx.restore()
    }

    drawRef.current = draw

    function tick() {
      if (state.alpha < 0.001 && !state.hovered && !state.hoveredEdge && !state.interaction) {
        draw(); state.frame = null; return
      }
      const { nodes, edges, pinned } = state
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]
        if (pinned.has(a.id)) { a.vx = 0; a.vy = 0; continue }
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]
          const dx = b.x - a.x, dy = b.y - a.y, d2 = Math.max(dx * dx + dy * dy, 1), d = Math.sqrt(d2)
          const f = 12000 * state.alpha / d2
          a.vx -= f * dx / d; a.vy -= f * dy / d
          if (!pinned.has(b.id)) { b.vx += f * dx / d; b.vy += f * dy / d }
        }
        a.vx += (W0 / 2 - a.x) * 0.0004 * state.alpha
        a.vy += (H0 / 2 - a.y) * 0.0004 * state.alpha
      }
      edges.forEach(({ a, b }) => {
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (d - 170) * 0.018 * state.alpha
        if (!pinned.has(a.id)) { a.vx += f * dx / d; a.vy += f * dy / d }
        if (!pinned.has(b.id)) { b.vx -= f * dx / d; b.vy -= f * dy / d }
      })
      nodes.forEach(n => {
        if (pinned.has(n.id)) return
        n.vx *= 0.78; n.vy *= 0.78
        n.x = Math.max(n.r + 4, Math.min(W0 - n.r - 4, n.x + n.vx))
        n.y = Math.max(n.r + 4, Math.min(H0 - n.r - 4, n.y + n.vy))
      })
      state.alpha *= 0.96
      draw(); state.frame = requestAnimationFrame(tick)
    }

    kickRef.current = (a = 0.5) => {
      state.alpha = Math.max(state.alpha, a)
      if (!state.frame) state.frame = requestAnimationFrame(tick)
    }

    state.frame = requestAnimationFrame(tick)
    return () => { if (state.frame) cancelAnimationFrame(state.frame); drawRef.current = null; kickRef.current = null }
  }, [tasks, theme])

  function toWorld(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const { pan, scale } = stateRef.current
    return { x: (e.clientX - rect.left - pan.x) / scale, y: (e.clientY - rect.top - pan.y) / scale }
  }

  function hitNode(wx, wy) {
    return stateRef.current.nodes.find(n => Math.hypot(n.x - wx, n.y - wy) < n.r + 6)
  }

  function hitEdge(wx, wy) {
    for (const edge of stateRef.current.edges) {
      if (distToSeg(wx, wy, edge.a.x, edge.a.y, edge.b.x, edge.b.y) < 8) return edge
    }
    return null
  }

  function startLoop() {
    const state = stateRef.current
    if (!state.frame && drawRef.current) {
      const loop = () => {
        if (!state.hovered && !state.hoveredEdge && !state.interaction) { state.frame = null; return }
        drawRef.current?.(); state.frame = requestAnimationFrame(loop)
      }
      state.frame = requestAnimationFrame(loop)
    }
  }

  function handleWheel(e) {
    e.preventDefault()
    const state = stateRef.current
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const factor = Math.pow(2, -e.deltaY * 0.003)
    const ns = Math.max(0.15, Math.min(5, state.scale * factor))
    state.pan.x = cx - (cx - state.pan.x) * (ns / state.scale)
    state.pan.y = cy - (cy - state.pan.y) * (ns / state.scale)
    state.scale = ns
    if (drawRef.current && !state.frame) drawRef.current()
  }

  function handleMouseMove(e) {
    setContextMenu(null)
    const state = stateRef.current
    const { x: wx, y: wy } = toWorld(e)
    const ix = state.interaction

    if (ix?.type === 'pan') {
      state.pan.x = ix.startPanX + (e.clientX - ix.startCX)
      state.pan.y = ix.startPanY + (e.clientY - ix.startCY)
      startLoop(); return
    }

    if (ix?.type === 'drag') {
      const nd = ix.node
      const W0 = canvasRef.current.offsetWidth, H0 = canvasRef.current.offsetHeight
      nd.x = Math.max(nd.r + 4, Math.min(W0 - nd.r - 4, wx))
      nd.y = Math.max(nd.r + 4, Math.min(H0 - nd.r - 4, wy))
      nd.vx = 0; nd.vy = 0
      state.pinned.add(nd.id)
      startLoop(); return
    }

    if (ix?.type === 'link') {
      if (Math.hypot(wx - ix.ox, wy - ix.oy) > 5) ix.moved = true
      if (ix.moved) {
        ix.wx = wx; ix.wy = wy
        const n = hitNode(wx, wy)
        ix.target = (n && n !== ix.source) ? n : null
        canvasRef.current.style.cursor = ix.target ? 'cell' : 'crosshair'
      }
      startLoop(); return
    }

    const n = hitNode(wx, wy)
    const edge = n ? null : hitEdge(wx, wy)
    const changed = n !== state.hovered || edge !== state.hoveredEdge
    state.hovered = n; state.hoveredEdge = edge
    if (n) {
      const dist = Math.hypot(n.x - wx, n.y - wy)
      canvasRef.current.style.cursor = dist > n.r * 0.55 ? 'crosshair' : 'grab'
    } else {
      canvasRef.current.style.cursor = edge ? 'pointer' : 'default'
    }
    if (changed) startLoop()
  }

  function handleMouseDown(e) {
    if (e.button !== 0) return
    setContextMenu(null)
    const state = stateRef.current
    const { x: wx, y: wy } = toWorld(e)
    const n = hitNode(wx, wy)
    const edge = n ? null : hitEdge(wx, wy)

    if (n) {
      const dist = Math.hypot(n.x - wx, n.y - wy)
      const isEdgeZone = dist > n.r * 0.55
      if (isEdgeZone) {
        state.interaction = { type: 'link', source: n, ox: wx, oy: wy, wx, wy, target: null, moved: false }
      } else {
        state.interaction = { type: 'drag', node: n, startWX: wx, startWY: wy }
      }
    } else if (edge) {
      state.interaction = { type: 'edge-click', edge, startX: e.clientX, startY: e.clientY }
    } else {
      state.interaction = { type: 'pan', startCX: e.clientX, startCY: e.clientY, startPanX: state.pan.x, startPanY: state.pan.y }
      canvasRef.current.style.cursor = 'grabbing'
    }
    startLoop()
  }

  async function handleMouseUp(e) {
    const state = stateRef.current
    const ix = state.interaction
    state.interaction = null
    canvasRef.current.style.cursor = state.hovered ? 'pointer' : 'default'
    if (!ix) return

    if (ix.type === 'link') {
      if (ix.moved && ix.target) {
        await fetch(apiUrl(`/link`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: ix.source.id, relatedId: ix.target.id }) })
        onRefresh()
      } else if (!ix.moved) {
        onSelect(ix.source.task)
      }
    } else if (ix.type === 'drag') {
      const { x: wx, y: wy } = toWorld(e)
      if (Math.hypot(wx - ix.startWX, wy - ix.startWY) < 5) {
        onSelect(ix.node.task)
      }
    } else if (ix.type === 'edge-click') {
      if (Math.hypot(e.clientX - ix.startX, e.clientY - ix.startY) < 5) {
        await fetch(apiUrl(`/unlink`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: ix.edge.aId, relatedId: ix.edge.bId }) })
        onRefresh()
      }
    }
    if (drawRef.current && !state.frame) drawRef.current()
  }

  function handleDblClick(e) {
    const { x: wx, y: wy } = toWorld(e)
    const n = hitNode(wx, wy)
    if (!n) return
    const state = stateRef.current
    if (state.pinned.has(n.id)) { state.pinned.delete(n.id); kickRef.current?.(0.3) }
    else { state.pinned.add(n.id); if (drawRef.current && !state.frame) drawRef.current() }
  }

  function handleContextMenu(e) {
    e.preventDefault()
    const { x: wx, y: wy } = toWorld(e)
    const n = hitNode(wx, wy)
    const edge = n ? null : hitEdge(wx, wy)
    if (!n && !edge) return
    const rect = canvasRef.current.getBoundingClientRect()
    setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, node: n, edge })
  }

  async function ctxAction(action, value = null) {
    const { node, edge } = contextMenu
    setContextMenu(null)
    const state = stateRef.current
    if (action === 'open')   onSelect(node.task)
    else if (action === 'status') {
      const next = STATUS_ORDER[(STATUS_ORDER.indexOf(node.task.status) + 1) % 3]
      await fetch(apiUrl(`/tasks/${node.task.id}/status`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) })
      onRefresh()
    }
    else if (action === 'pin') {
      if (state.pinned.has(node.id)) { state.pinned.delete(node.id); kickRef.current?.(0.3) }
      else { state.pinned.add(node.id); if (drawRef.current && !state.frame) drawRef.current() }
    }
    else if (action === 'set-color') {
      await fetch(apiUrl(`/tasks/${node.task.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeColor: value }) })
      onRefresh()
    }
    else if (action === 'set-size') {
      await fetch(apiUrl(`/tasks/${node.task.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeSize: value }) })
      onRefresh()
    }
    else if (action === 'delete') {
      await fetch(apiUrl(`/tasks/${node.task.id}`), { method: 'DELETE' }); onRefresh()
    }
    else if (action === 'unlink') {
      await fetch(apiUrl(`/unlink`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: edge.aId, relatedId: edge.bId }) })
      onRefresh()
    }
  }

  function fitView() {
    const state = stateRef.current
    if (!state.nodes.length) return
    const canvas = canvasRef.current
    const xs = state.nodes.map(n => n.x), ys = state.nodes.map(n => n.y)
    const pad = 60
    const W = canvas.offsetWidth, H = canvas.offsetHeight
    const s = Math.min((W - pad * 2) / (Math.max(...xs) - Math.min(...xs) || 1), (H - pad * 2) / (Math.max(...ys) - Math.min(...ys) || 1), 2.5)
    state.scale = s
    state.pan.x = W / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * s
    state.pan.y = H / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * s
    if (drawRef.current && !state.frame) drawRef.current()
  }

  function resetLayout() {
    const state = stateRef.current
    const canvas = canvasRef.current
    const W = canvas.offsetWidth, H = canvas.offsetHeight
    state.pinned.clear(); state.pan = { x: 0, y: 0 }; state.scale = 1
    const n = state.nodes.length
    state.nodes.forEach((nd, i) => {
      const angle = (i / n) * Math.PI * 2, radius = Math.min(W, H) * 0.28
      nd.x = W / 2 + Math.cos(angle) * radius; nd.y = H / 2 + Math.sin(angle) * radius; nd.vx = 0; nd.vy = 0
    })
    kickRef.current?.(1.0)
  }

  const legend = [
    ...Object.entries(STATUS_COLORS).map(([s, c]) => ({ label: STATUS_LABELS[s], color: c, type: 'dot' })),
    { label: 'Manual link', color: 'rgba(108,92,231,0.6)', type: 'solid' },
    { label: 'Keyword link', color: 'rgba(108,92,231,0.4)', type: 'dashed' },
    { label: 'Parent → Child', color: '#d97706', type: 'arrow' },
  ]

  return (
    <div className="graph-wrap">
      <div className="graph-legend">
        {legend.map(({ label, color, type }) => (
          <span key={label} className="legend-item">
            {type === 'dot'    && <span className="legend-dot"  style={{ background: color }} />}
            {type === 'solid'  && <span className="legend-line" style={{ background: color }} />}
            {type === 'dashed' && <span className="legend-line dashed" style={{ borderColor: color }} />}
            {type === 'arrow'  && <span className="legend-arrow" style={{ color }}>→</span>}
            {label}
          </span>
        ))}
        <div className="graph-controls">
          <button className="graph-btn" onClick={fitView}    title="Fit all nodes in view">⊡ Fit</button>
          <button className="graph-btn" onClick={resetLayout} title="Re-run physics layout">↺ Reset</button>
        </div>
      </div>
      <div className="graph-hint">
        Click node to open · Drag center to move · Drag ring to link · Click edge × to remove · Right-click for options
      </div>
      <div className="graph-body">
        {/* Keyword sidebar */}
        <div className="graph-kw-sidebar">
          <div className="graph-kw-search-wrap">
            <input
              className="graph-kw-search"
              placeholder="Search…"
              value={graphSearch}
              onChange={e => { setGraphSearch(e.target.value); if (e.target.value) setActiveKw('') }}
            />
            {(graphSearch || activeKw) && (
              <button className="graph-kw-search-clear" onClick={() => { setGraphSearch(''); setActiveKw('') }}>×</button>
            )}
          </div>
          {sidebarKeywords.length > 0 && (
            <>
              <div className="graph-kw-header">Keywords</div>
              <div className="graph-kw-list">
                {sidebarKeywords.map(({ kw, n }) => (
                  <button
                    key={kw}
                    className={`graph-kw-chip${activeKw === kw ? ' active' : ''}`}
                    onClick={() => { setActiveKw(activeKw === kw ? '' : kw); setGraphSearch('') }}
                  >
                    <span className="graph-kw-label">{kw}</span>
                    <span className="graph-kw-count">{n}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="graph-canvas-wrap">
          <canvas ref={canvasRef} className="graph-canvas"
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              const s = stateRef.current
              s.hovered = null; s.hoveredEdge = null; s.interaction = null
              canvasRef.current.style.cursor = 'default'
              if (drawRef.current && !s.frame) drawRef.current()
            }}
            onDoubleClick={handleDblClick}
            onContextMenu={handleContextMenu}
            onWheel={handleWheel}
          />
          {contextMenu && (
            <div className="graph-ctx-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
              {contextMenu.node && <>
                <button onClick={() => ctxAction('open')}>Open Detail</button>
                <button onClick={() => ctxAction('status')}>
                  Mark as {STATUS_LABELS[STATUS_ORDER[(STATUS_ORDER.indexOf(contextMenu.node.task.status) + 1) % 3]]}
                </button>
                <button onClick={() => ctxAction('pin')}>
                  {stateRef.current.pinned.has(contextMenu.node.id) ? '⊙ Unpin' : '◉ Pin in place'}
                </button>
                <div className="graph-ctx-sep" />
                <div className="graph-ctx-section-label">Color</div>
                <div className="graph-ctx-palette">
                  {NODE_PALETTE.map(c => (
                    <button key={c} className="ctx-color-dot"
                      style={{ background: c, boxShadow: contextMenu.node.task.nodeColor === c ? '0 0 0 2px white, 0 0 0 3.5px ' + c : 'none' }}
                      title={c} onClick={() => ctxAction('set-color', c)} />
                  ))}
                  <button className="ctx-color-dot ctx-color-clear"
                    style={{ background: STATUS_COLORS[contextMenu.node.task.status] || '#9ca3af', opacity: 0.6 }}
                    title="Reset to default" onClick={() => ctxAction('set-color', null)}>⊘</button>
                </div>
                <div className="graph-ctx-section-label" style={{ marginTop: 6 }}>Size</div>
                <div className="graph-ctx-sizes">
                  {Object.keys(NODE_SIZE_R).map(k => (
                    <button key={k} className={`ctx-size-btn${contextMenu.node.task.nodeSize === k ? ' active' : ''}`}
                      onClick={() => ctxAction('set-size', k)}>{k.toUpperCase()}</button>
                  ))}
                </div>
                <div className="graph-ctx-sep" />
                <button className="danger" onClick={() => ctxAction('delete')}>Delete Task</button>
              </>}
              {contextMenu.edge && <>
                <button onClick={() => ctxAction('unlink')}>✕ Remove this link</button>
              </>}
            </div>
          )}
        </div>
      </div>
      {tasks.length === 0 && <p className="graph-empty">No tasks yet</p>}
    </div>
  )
}

// ── Task card (compact list) ──────────────────────────────────────────────────

function TaskCard({ task }) {
  const linkCount = (task.linkedTasks?.length || 0) + (task.keywordLinks?.length || 0)
  const commentCount = task.comments?.length || 0
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done'

  return (
    <div className={`ticket ticket--${task.status}`}>
      <div className="ticket-left">
        <span className="ticket-priority" style={{ background: PRIORITY_COLORS[task.priority] }} title={task.priority} />
        <span className={`ticket-status-dot ticket-status-dot--${task.status}`} />
      </div>
      <div className="ticket-body">
        <p className="ticket-title">{task.title}</p>
        {task.notes && <p className="ticket-summary">{task.notes}</p>}
        <div className="ticket-meta">
          <span className="ticket-age">{timeAgo(task.createdAt)}</span>
          {task.source && <span className="ticket-source">{SOURCE_ICONS[task.source.type] || '•'} {task.source.type}</span>}
          {task.dueDate && <span className={`ticket-due ${isOverdue ? 'ticket-due--overdue' : ''}`}>📅 {task.dueDate}</span>}
          {task.actionType && <span className="ticket-tag">{task.actionType}</span>}
          {linkCount > 0 && <span className="ticket-tag">🔗 {linkCount}</span>}
          {commentCount > 0 && <span className="ticket-tag">💬 {commentCount}</span>}
          {task.attachments?.length > 0 && <span className="ticket-tag">📎 {task.attachments.length}</span>}
          {task.parentId && <span className="ticket-tag">↳ subtask</span>}
        </div>
      </div>
      <div className="ticket-right">
        {task.assignees?.slice(0, 3).map(a => <Avatar key={a} name={a} size={24} />)}
      </div>
    </div>
  )
}

// ── Task table (sortable list view) ──────────────────────────────────────────

function TaskTable({ tasks, onSelect, filter }) {
  const [sortCol, setSortCol] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')
  const [selected, setSelected] = useState(new Set())

  const visible = filter === 'all' ? tasks : tasks.filter(t => t.status === filter)

  const sorted = [...visible].sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol]
    if (sortCol === 'priority') {
      const order = { high: 0, medium: 1, low: 2 }
      av = order[a.priority] ?? 3; bv = order[b.priority] ?? 3
    }
    if (av == null && bv == null) return 0
    if (av == null) return 1; if (bv == null) return -1
    if (sortDir === 'asc') return av < bv ? -1 : av > bv ? 1 : 0
    return av > bv ? -1 : av < bv ? 1 : 0
  })

  const groups = STATUS_ORDER.map(s => ({
    status: s,
    rows: sorted.filter(t => t.status === s),
  })).filter(g => g.rows.length > 0)

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function toggleSelect(id, e) {
    e.stopPropagation()
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const si = col => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  return (
    <div className="task-table-wrap">
      <table className="task-table">
        <thead>
          <tr>
            <th className="col-check">
              <input type="checkbox"
                checked={selected.size === sorted.length && sorted.length > 0}
                onChange={e => setSelected(e.target.checked ? new Set(sorted.map(t => t.id)) : new Set())}
              />
            </th>
            <th className="col-title sortable" onClick={() => toggleSort('title')}>Title{si('title')}</th>
            <th className="col-priority sortable" onClick={() => toggleSort('priority')}>Priority{si('priority')}</th>
            <th className="col-assignees">Assigned</th>
            <th className="col-due sortable" onClick={() => toggleSort('dueDate')}>Due{si('dueDate')}</th>
            <th className="col-age sortable" onClick={() => toggleSort('createdAt')}>Age{si('createdAt')}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ status, rows }) => (
            <>
              <tr key={`grp-${status}`} className="tbl-group-row">
                <td colSpan={6}>
                  <span className="tbl-group-badge">
                    <span className="tbl-group-dot" style={{ background: STATUS_COLORS[status] }} />
                    {STATUS_LABELS[status]}
                    <span className="tbl-group-count">{rows.length}</span>
                  </span>
                </td>
              </tr>
              {rows.map(task => {
                const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done'
                return (
                  <tr key={task.id}
                    className={`tbl-row tbl-row--${task.status}${selected.has(task.id) ? ' tbl-row--sel' : ''}`}
                    onClick={() => onSelect(task)}>
                    <td className="col-check" onClick={e => toggleSelect(task.id, e)}>
                      <input type="checkbox" checked={selected.has(task.id)} onChange={() => {}} />
                    </td>
                    <td className="col-title">
                      <div className="tbl-title-cell">
                        <span className="tbl-prio-bar" style={{ background: PRIORITY_COLORS[task.priority] }} />
                        <div className="tbl-title-body">
                          <span className="tbl-title-text">{task.title}</span>
                          {task.notes && <span className="tbl-notes-preview">{task.notes.slice(0, 70)}{task.notes.length > 70 ? '…' : ''}</span>}
                        </div>
                        {task.source && <span className="tbl-source-icon">{SOURCE_ICONS[task.source.type] || '•'}</span>}
                      </div>
                    </td>
                    <td className="col-priority">
                      <span className="tbl-prio-chip" style={{ color: PRIORITY_COLORS[task.priority] }}>
                        {task.priority || '–'}
                      </span>
                    </td>
                    <td className="col-assignees">
                      <div className="tbl-avatars">
                        {task.assignees?.slice(0, 3).map(a => <Avatar key={a} name={a} size={20} />)}
                        {!task.assignees?.length && <span className="tbl-none">—</span>}
                      </div>
                    </td>
                    <td className={`col-due${isOverdue ? ' col-due--overdue' : ''}`}>
                      {task.dueDate || <span className="tbl-none">—</span>}
                    </td>
                    <td className="col-age">{timeAgo(task.createdAt)}</td>
                  </tr>
                )
              })}
            </>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={6} className="tbl-empty">No tasks</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Focus card (expanded view) ────────────────────────────────────────────────

function FocusCard({ task, onClick, onColorChange }) {
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done'
  const linkCount = (task.linkedTasks?.length || 0) + (task.keywordLinks?.length || 0)
  const recentActivity = [...(task.timeline || [])].reverse().find(e => e.type === 'comment' || e.type === 'status')
  const nodeColor = task.nodeColor || taskDefaultColor(task.id)

  return (
    <div className={`focus-card focus-card--${task.status}`} onClick={onClick}>
      <div className="fc-header">
        <div className="fc-title-row">
          <span className="fc-priority-bar" style={{ background: PRIORITY_COLORS[task.priority] }} />
          <h3 className="fc-title">{task.title}</h3>
          {onColorChange && (
            <div className="fc-color-picker" onClick={e => e.stopPropagation()}>
              <span className="fc-color-swatch" style={{ background: nodeColor }} title="Node color" />
              <div className="fc-color-dropdown">
                {NODE_PALETTE.map(c => (
                  <button key={c} className="fc-color-dot"
                    style={{ background: c, boxShadow: task.nodeColor === c ? '0 0 0 2px white,0 0 0 3.5px ' + c : 'none' }}
                    onClick={() => onColorChange(c)} />
                ))}
                <button className="fc-color-dot fc-color-reset"
                  style={{ background: taskDefaultColor(task.id), opacity: 0.55 }}
                  title="Reset to default" onClick={() => onColorChange(null)}>⊘</button>
              </div>
            </div>
          )}
        </div>
        <div className="fc-chips">
          <span className={`fc-status fc-status--${task.status}`}>{STATUS_LABELS[task.status]}</span>
          {task.source && <span className="fc-chip">{SOURCE_ICONS[task.source.type] || '•'} {task.source.type}</span>}
          {task.actionType && <span className="fc-chip">{task.actionType}</span>}
          {task.dueDate && <span className={`fc-chip ${isOverdue ? 'fc-chip--overdue' : ''}`}>📅 {task.dueDate}</span>}
          {task.parentId && <span className="fc-chip">↳ subtask</span>}
        </div>
      </div>

      {task.notes && (
        <p className="fc-notes">{task.notes}</p>
      )}

      {recentActivity && (
        <div className="fc-activity">
          {recentActivity.type === 'comment' && (
            <><Avatar name={recentActivity.author || 'You'} size={16} />
            <span className="fc-activity-text">"{recentActivity.text?.slice(0, 100)}{recentActivity.text?.length > 100 ? '…' : ''}"</span></>
          )}
          {recentActivity.type === 'status' && (
            <span className="fc-activity-text">
              Moved to <span className={`tl-status tl-status--${recentActivity.to}`}>{STATUS_LABELS[recentActivity.to]}</span>
            </span>
          )}
          <span className="fc-activity-time">{timeAgo(recentActivity.createdAt)}</span>
        </div>
      )}

      <div className="fc-footer">
        <div className="fc-assignees">
          {task.assignees?.slice(0, 5).map(a => <Avatar key={a} name={a} size={26} />)}
          {!task.assignees?.length && <span className="fc-unassigned">Unassigned</span>}
        </div>
        <div className="fc-meta">
          {task.comments?.length > 0 && <span>💬 {task.comments.length}</span>}
          {linkCount > 0 && <span>🔗 {linkCount}</span>}
          {task.attachments?.length > 0 && <span>📎 {task.attachments.length}</span>}
          <span className="fc-age">{timeAgo(task.updatedAt || task.createdAt)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Derive action items from task data ────────────────────────────────────────

function deriveActions(task, linkedTasks) {
  const actions = []
  const now = new Date()
  const isOverdue = task.dueDate && new Date(task.dueDate) < now && task.status !== 'done'
  const daysLeft = task.dueDate ? Math.ceil((new Date(task.dueDate) - now) / 86400000) : null

  if (isOverdue) {
    const days = Math.ceil((now - new Date(task.dueDate)) / 86400000)
    actions.push({ action: `Overdue by ${days} day${days > 1 ? 's' : ''} — update status or reschedule`, urgency: 'now', derived: true })
  } else if (daysLeft !== null && daysLeft <= 2) {
    actions.push({ action: `Due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} — prioritize now`, urgency: 'now', derived: true })
  }

  if (task.actionType === 'reply') {
    const to = task.source?.context || task.assignees?.[0] || 'sender'
    actions.push({ action: `Write and send reply to ${to}`, urgency: isOverdue ? 'now' : 'soon', derived: true })
  } else if (task.actionType === 'review') {
    actions.push({ action: 'Review and leave feedback', urgency: 'soon', derived: true })
  } else if (task.actionType === 'approve') {
    actions.push({ action: 'Review details and approve or reject', urgency: 'now', derived: true })
  } else if (task.actionType === 'schedule') {
    actions.push({ action: 'Find an available time and send an invite', urgency: 'soon', derived: true })
  } else if (task.actionType === 'call') {
    actions.push({ action: 'Set up a call or video meeting', urgency: 'soon', derived: true })
  } else if (task.actionType === 'forward') {
    actions.push({ action: 'Forward to the right person with context', urgency: 'soon', derived: true })
  }

  if (task.status === 'todo' && !actions.length) {
    actions.push({ action: 'Start working on this task', urgency: 'soon', derived: true })
  }

  const others = (task.assignees || []).filter(a => !/^you$/i.test(a))
  if (others.length > 0) {
    actions.push({ action: `Check in with ${others.slice(0, 2).join(' and ')}`, urgency: 'later', derived: true })
  }

  linkedTasks.filter(t => t.status !== 'done').slice(0, 2).forEach(t => {
    actions.push({ action: `Follow up on: "${t.title.slice(0, 55)}"`, urgency: 'later', derived: true })
  })

  return actions.slice(0, 5)
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ task, tasks, onClose, onRefresh, onDelete }) {
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [tab, setTab] = useState('summary')
  const [title, setTitle] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newAssignee, setNewAssignee] = useState('')
  const [delegating, setDelegating] = useState(false)
  const [delegateTo, setDelegateTo] = useState('')
  const [delegateNote, setDelegateNote] = useState('')
  const [aiActions, setAiActions] = useState([])
  const [loadingActions, setLoadingActions] = useState(false)
  const fileRef = useRef(null)
  const dropRef = useRef(null)

  useEffect(() => {
    if (task) { setTitle(task.title); setConfirmDelete(false); setTab('summary'); setDelegating(false); setAiActions([]) }
  }, [task?.id])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!task) return null

  const parent = task.parentId ? tasks.find(t => t.id === task.parentId) : null
  const children = tasks.filter(t => t.parentId === task.id)
  const linkedTaskIds = [...new Set([...(task.linkedTasks || []), ...(task.keywordLinks || [])])]
  const linkedTasks = linkedTaskIds
    .map(id => tasks.find(t => t.id === id))
    .filter(Boolean)
    .filter(lt => lt.id !== task.parentId && lt.parentId !== task.id)
  const taskWords = taskKeywords(task)
  const keywords = [...new Set(linkedTasks.flatMap(lt => [...taskKeywords(lt)].filter(w => taskWords.has(w))))]

  const allTimeline = [...(task.timeline || [])]
  ;(task.comments || []).forEach(c => { if (!allTimeline.find(e => e.id === c.id)) allTimeline.push({ ...c, type: 'comment' }) })
  ;(task.attachments || []).forEach(a => { if (!allTimeline.find(e => e.id === a.id && e.type === 'attachment')) allTimeline.push({ ...a, type: 'attachment' }) })
  allTimeline.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

  const comments = allTimeline.filter(e => e.type === 'comment')
  const derivedActions = deriveActions(task, [...children, ...linkedTasks])
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done'
  const hasLinked = parent || children.length > 0 || linkedTasks.length > 0

  async function changeStatus(status) {
    await fetch(apiUrl(`/tasks/${task.id}/status`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    onRefresh()
  }

  async function patch(body) {
    await fetch(apiUrl(`/tasks/${task.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    onRefresh()
  }

  async function postComment() {
    if (!comment.trim() || posting) return
    setPosting(true)
    await fetch(apiUrl(`/tasks/${task.id}/comments`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: comment.trim(), author: 'You' }) })
    setComment('')
    setPosting(false)
    onRefresh()
  }

  async function uploadFile(file) {
    if (!file) return
    setUploading(true)
    const fd = new FormData(); fd.append('file', file)
    await fetch(apiUrl(`/tasks/${task.id}/attachments`), { method: 'POST', body: fd })
    setUploading(false)
    onRefresh()
  }

  function handleDrop(e) {
    e.preventDefault()
    dropRef.current?.classList.remove('drop-active')
    const file = e.dataTransfer.files[0]; if (file) uploadFile(file)
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    await fetch(apiUrl(`/tasks/${task.id}`), { method: 'DELETE' })
    onDelete()
  }

  async function addAssignee(name) {
    const trimmed = name.trim()
    if (!trimmed || task.assignees?.includes(trimmed)) return
    await patch({ assignees: [...(task.assignees || []), trimmed] })
    setNewAssignee('')
  }

  async function removeAssignee(name) {
    await patch({ assignees: (task.assignees || []).filter(a => a !== name) })
  }

  async function submitDelegate() {
    const name = delegateTo.trim()
    if (!name) return
    const assignees = [...new Set([...(task.assignees || []), name])]
    await patch({ assignees })
    const text = delegateNote.trim()
      ? `Handed off to ${name}: ${delegateNote.trim()}`
      : `Handed off to ${name}`
    await fetch(apiUrl(`/tasks/${task.id}/comments`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, author: 'You' }),
    })
    setDelegating(false); setDelegateTo(''); setDelegateNote('')
    setTab('summary')
    onRefresh()
  }

  async function generateActions() {
    setLoadingActions(true)
    try {
      const res = await fetch(apiUrl(`/suggest-actions`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      })
      setAiActions(await res.json())
    } catch { /* ignore */ }
    setLoadingActions(false)
  }

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <aside className="detail-panel">

        {/* ── Header ── */}
        <div className="panel-header">
          <div className="panel-header-top">
            <div className="panel-status-row">
              <button className={`status-btn status-btn--${task.status}`}
                onClick={() => { const i = (STATUS_ORDER.indexOf(task.status) + 1) % 3; changeStatus(STATUS_ORDER[i]) }}>
                {STATUS_LABELS[task.status]}
              </button>
              <span className="panel-priority" style={{ color: PRIORITY_COLORS[task.priority] }}>● {task.priority}</span>
              {task.actionType && <span className="panel-tag">{task.actionType}</span>}
              {task.dueDate && <span className={`panel-tag ${isOverdue ? 'panel-tag--overdue' : 'panel-tag--due'}`}>📅 {task.dueDate}</span>}
            </div>
            <div className="panel-header-actions">
              <button className={`btn-delete-task ${confirmDelete ? 'btn-delete-task--confirm' : ''}`}
                onClick={handleDelete} title={confirmDelete ? 'Click again to confirm' : 'Delete task'}>
                {confirmDelete ? 'Confirm?' : '🗑'}
              </button>
              <button className="btn-icon panel-close" onClick={onClose}>×</button>
            </div>
          </div>

          <input className="panel-title-input" value={title} onChange={e => setTitle(e.target.value)}
            onBlur={async () => { if (title.trim() && title !== task.title) await patch({ title: title.trim() }) }} />

          <div className="panel-age">
            Created {fmtTime(task.createdAt)} · <span>{timeAgo(task.createdAt)}</span>
            {task.updatedAt !== task.createdAt && <> · Updated {timeAgo(task.updatedAt)}</>}
          </div>

          {/* Parent/child selector */}
          <div className="panel-parent-row">
            {parent ? (
              <span className="panel-parent-link">
                ↳ subtask of
                <button className="panel-parent-name">{parent.title}</button>
                <button className="btn-icon" style={{ fontSize: 13 }} onClick={() => patch({ parentId: null })}>×</button>
              </span>
            ) : (
              <select className="panel-parent-select" onChange={async e => {
                if (!e.target.value) return
                await patch({ parentId: e.target.value })
                e.target.value = ''
              }}>
                <option value="">+ Set as subtask of…</option>
                {tasks.filter(t => t.id !== task.id && t.id !== task.parentId).map(t => (
                  <option key={t.id} value={t.id}>{t.title.slice(0, 60)}</option>
                ))}
              </select>
            )}
          </div>

          {/* Assignees + handoff */}
          <div className="panel-assignees-row">
            <div className="panel-assignees">
              {task.assignees?.map(a => (
                <span key={a} className="panel-assignee">
                  <Avatar name={a} size={20} />
                  <span>{a}</span>
                  <button className="assignee-x" onClick={() => removeAssignee(a)} title="Remove collaborator">×</button>
                </span>
              ))}
              <form className="add-assignee-form" onSubmit={e => { e.preventDefault(); addAssignee(newAssignee) }}>
                <input
                  className="add-assignee-input"
                  value={newAssignee}
                  onChange={e => setNewAssignee(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAssignee(newAssignee) } }}
                  placeholder={task.assignees?.length ? '+ add collaborator…' : '+ Add collaborator…'}
                />
              </form>
            </div>
            <button className={`btn-delegate-toggle ${delegating ? 'active' : ''}`}
              onClick={() => setDelegating(d => !d)}
              title="Hand off responsibility to someone else">
              ↗ Hand off
            </button>
          </div>

          {delegating && (
            <div className="delegate-form">
              <p className="delegate-form-hint">Transfer ownership — adds them as assignee and logs a handoff note.</p>
              <input
                className="delegate-name-input"
                placeholder="Hand off to (name or email)…"
                value={delegateTo}
                onChange={e => setDelegateTo(e.target.value)}
                autoFocus
              />
              <textarea
                className="delegate-note-input"
                placeholder="Handoff note (context, instructions, deadline…)"
                value={delegateNote}
                onChange={e => setDelegateNote(e.target.value)}
                rows={2}
              />
              <div className="delegate-actions">
                <button className="btn-delegate-cancel" onClick={() => { setDelegating(false); setDelegateTo(''); setDelegateNote('') }}>Cancel</button>
                <button className="btn-delegate-submit" onClick={submitDelegate} disabled={!delegateTo.trim()}>Hand off ↗</button>
              </div>
            </div>
          )}
        </div>

        {/* Source info bar */}
        {task.source && (
          <div className="panel-source-bar">
            <span className="panel-source-icon">{SOURCE_ICONS[task.source.type] || '•'}</span>
            <div className="panel-source-info">
              <span className="panel-source-name">{task.source.title || task.source.type}</span>
              {task.source.from && <span className="panel-source-meta">From: {task.source.from}</span>}
              {task.source.to?.length > 0 && <span className="panel-source-meta">To: {task.source.to.join(', ')}</span>}
              {task.source.cc?.length > 0 && <span className="panel-source-meta panel-source-cc">CC: {task.source.cc.join(', ')}</span>}
              {!task.source.from && task.source.context && <span className="panel-source-meta">{task.source.context}</span>}
            </div>
            {task.source.url && <a href={task.source.url} target="_blank" rel="noopener noreferrer" className="panel-source-link">Open ↗</a>}
          </div>
        )}

        {/* Tabs */}
        <div className="panel-tabs">
          {[
            ['summary', 'Summary'],
            ['linked', hasLinked ? `Linked${children.length > 0 ? ` · ${children.length} sub` : ''}` : 'Linked'],
          ].map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="panel-body">

          {/* ── Summary tab ── */}
          {tab === 'summary' && (
            <div className="summary-tab">

              {/* Notes — no section label needed */}
              <div className="summary-section">
                {task.notes
                  ? <p className="summary-notes-text">{task.notes}</p>
                  : <p className="summary-empty">No summary yet — capture this task from an email or page to get an AI summary.</p>
                }
              </div>

              {/* Next Steps */}
              <div className="summary-section">
                <div className="summary-section-header">
                  <div className="summary-section-label">Next Steps</div>
                  <button
                    className="btn-suggest-actions"
                    onClick={generateActions}
                    disabled={loadingActions}
                  >
                    {loadingActions ? '…' : aiActions.length ? '↺ Refresh' : '✦ Suggest'}
                  </button>
                </div>

                {[...derivedActions, ...aiActions].length === 0 && (
                  <p className="summary-empty">Click "Suggest" for AI-generated next steps.</p>
                )}

                {[...derivedActions, ...aiActions].map((item, i) => (
                  <div key={i} className={`action-item action-item--${item.urgency}`}>
                    <span className="action-urgency-dot" />
                    <div className="action-body">
                      <span className="action-text">{item.action}</span>
                      {item.why && <span className="action-why">{item.why}</span>}
                    </div>
                    <span className={`action-urgency-label action-urgency-label--${item.urgency}`}>{item.urgency}</span>
                  </div>
                ))}
              </div>

              {/* Comments / updates */}
              {comments.length > 0 && (
                <div className="summary-section">
                  <div className="summary-section-label">Updates</div>
                  {comments.map((c, i) => (
                    <div key={c.id || i} className="comment-entry">
                      <Avatar name={c.author || 'You'} size={22} />
                      <div className="comment-entry-body">
                        <div className="comment-entry-header">
                          <strong>{c.author || 'You'}</strong>
                          <span className="comment-entry-time">{fmtTime(c.createdAt)}</span>
                        </div>
                        <div className="comment-entry-text">{c.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Files */}
              <div className="summary-section">
                {task.attachments?.length > 0 && (
                  <>
                    <div className="summary-section-label">Files ({task.attachments.length})</div>
                    <div className="file-list">
                      {task.attachments.map(a => (
                        <a key={a.id} href={apiUrl(`/files/${a.filename}`)} target="_blank" rel="noopener noreferrer" className="file-item">
                          <span className="file-icon">{fileIcon(a.mimetype)}</span>
                          <div className="file-info">
                            <span className="file-name">{a.originalName}</span>
                            <span className="file-meta">{fileSize(a.size)} · {fmtTime(a.createdAt)}</span>
                          </div>
                        </a>
                      ))}
                    </div>
                  </>
                )}
                <div ref={dropRef} className="drop-zone drop-zone--sm"
                  onDragOver={e => { e.preventDefault(); dropRef.current.classList.add('drop-active') }}
                  onDragLeave={() => dropRef.current.classList.remove('drop-active')}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current.click()}>
                  {uploading ? 'Uploading…' : <><span>📎</span> Drop or click to attach a file</>}
                </div>
              </div>
            </div>
          )}

          {/* ── Linked tab ── */}
          {tab === 'linked' && (
            <div className="links-tab">

              {/* Parent */}
              <div className="linked-section">
                <div className="linked-section-label">Parent Task</div>
                {parent ? (
                  <div className="linked-task-item linked-task-item--parent">
                    <span className={`linked-dot linked-dot--${parent.status}`} />
                    <div className="linked-task-body">
                      <span className="linked-task-title">{parent.title}</span>
                      {parent.notes && <span className="linked-task-meta">{parent.notes.slice(0, 80)}</span>}
                    </div>
                    <span className="linked-task-badge linked-task-badge--parent">parent</span>
                  </div>
                ) : (
                  <p className="linked-empty-section">No parent task</p>
                )}
              </div>

              {/* Subtasks */}
              <div className="linked-section">
                <div className="linked-section-label">
                  Subtasks
                  {children.length > 0 && <span className="linked-section-count">{children.length}</span>}
                </div>
                {children.length > 0 ? children.map(c => (
                  <div key={c.id} className="linked-task-item">
                    <span className={`linked-dot linked-dot--${c.status}`} />
                    <div className="linked-task-body">
                      <span className="linked-task-title">{c.title}</span>
                      {c.assignees?.length > 0 && <span className="linked-task-meta">{c.assignees.join(', ')}</span>}
                    </div>
                    <span className="linked-task-badge">subtask</span>
                  </div>
                )) : (
                  <p className="linked-empty-section">No subtasks</p>
                )}
              </div>

              {/* Linked tasks */}
              <div className="linked-section">
                <div className="linked-section-label">
                  Linked Tasks
                  {linkedTasks.length > 0 && <span className="linked-section-count">{linkedTasks.length}</span>}
                </div>
                {keywords.length > 0 && (
                  <div className="keyword-chips-prominent">
                    <span className="kw-chips-label">Shared keywords</span>
                    <div className="kw-chips-row">
                      {keywords.map(k => <span key={k} className="keyword-chip-lg">{k}</span>)}
                    </div>
                  </div>
                )}
                {linkedTasks.length > 0 ? linkedTasks.map(lt => {
                  const isKw = (task.keywordLinks || []).includes(lt.id)
                  const sharedKws = isKw ? sharedKeywords(task, lt) : []
                  return (
                    <div key={lt.id} className="linked-task-item">
                      <span className={`linked-dot linked-dot--${lt.status}`} />
                      <div className="linked-task-body">
                        <span className="linked-task-title">{lt.title}</span>
                        {sharedKws.length > 0 && (
                          <span className="linked-kw-tags">
                            {sharedKws.map(k => <span key={k} className="linked-kw-tag">{k}</span>)}
                          </span>
                        )}
                        {lt.notes && <span className="linked-task-meta">{lt.notes.slice(0, 80)}</span>}
                        {lt.assignees?.length > 0 && <span className="linked-task-meta">{lt.assignees.join(', ')}</span>}
                      </div>
                      <div className="linked-task-actions">
                        <span className="linked-task-badge">{isKw ? 'keyword' : 'linked'}</span>
                        <button
                          className="linked-unlink-btn"
                          title="Remove this link"
                          onClick={async () => {
                            await fetch(apiUrl(`/unlink`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, relatedId: lt.id }) })
                            onRefresh()
                          }}
                        >×</button>
                      </div>
                    </div>
                  )
                }) : (
                  <p className="linked-empty-section">No linked tasks. Drag the outer ring of a node to another in Graph view to link.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Comment footer ── */}
        {tab === 'summary' && (
          <div className="panel-comment-footer">
            <Avatar name="You" size={28} />
            <div className="comment-input-wrap">
              <textarea
                className="comment-input"
                placeholder="Add an update… (⌘↵ to send)"
                value={comment}
                onChange={e => setComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postComment() }}
                rows={2}
              />
              <div className="comment-actions">
                <button className="btn-attach-small" onClick={() => fileRef.current.click()} title="Attach file">📎</button>
                <button className="btn-comment" onClick={postComment} disabled={posting || !comment.trim()}>
                  {posting ? '…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => { uploadFile(e.target.files[0]); e.target.value = '' }} />
      </aside>
    </>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [tasks, setTasks] = useState([])
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('list')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [userKey, setUserKeyState] = useState(() => localStorage.getItem('task_user_key') || '')
  const [showSettings, setShowSettings] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme')
    return saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  function initKey() {
    const k = crypto.randomUUID()
    setUserKey(k)
    setUserKeyState(k)
  }

  function copyKey() {
    navigator.clipboard.writeText(userKey)
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 2000)
  }

  const fetchTasks = useCallback(async () => {
    if (!_userKey) return
    try {
      const res = await fetch(apiUrl('/tasks'))
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTasks(data)
      setSelected(s => s ? data.find(t => t.id === s.id) || null : null)
      setError(null)
    } catch {
      setError('Could not reach the API — check your connection or API URL in settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!userKey) return
    fetchTasks()
    const t = setInterval(fetchTasks, 4000)
    return () => clearInterval(t)
  }, [fetchTasks, userKey])

  const counts = STATUS_ORDER.reduce((acc, s) => ({ ...acc, [s]: tasks.filter(t => t.status === s).length }), {})

  async function patchTask(id, body) {
    await fetch(apiUrl(`/tasks/${id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    fetchTasks()
  }

  // ── First-run screen ──────────────────────────────────────────────────────────
  if (!userKey) {
    return (
      <div className="onboarding-wrap">
        <div className="onboarding-card">
          <div className="onboarding-icon">✦</div>
          <h1 className="onboarding-title">Task Capture</h1>
          <p className="onboarding-sub">Capture tasks from Gmail and any webpage, then track them here. Your data is private — tied to a key only you have.</p>
          <button className="onboarding-btn" onClick={initKey}>Create my workspace →</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`app ${selected ? 'app--panel-open' : ''}`}>
      <header className="app-header">
        <div>
          <h1 className="app-title">Tasks <span className="app-count">{tasks.length}</span></h1>
          <p className="app-hint">Press <kbd>Alt+T</kbd> in Gmail to capture</p>
        </div>
        <div className="header-controls">
          <div className="view-toggle">
            <button className={view === 'list'  ? 'active' : ''} onClick={() => setView('list')}>List</button>
            <button className={view === 'focus' ? 'active' : ''} onClick={() => setView('focus')}>Focus</button>
            <button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}>Graph</button>
          </div>
          <button className="settings-btn" onClick={() => setShowSettings(s => !s)} title="Settings">⚙</button>
          <button className="theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '☀︎' : '☽'}
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="settings-bar">
          <div className="settings-row">
            <span className="settings-label">Your workspace key</span>
            <span className="settings-hint">Paste this into the Chrome extension to connect it to your dashboard.</span>
          </div>
          <div className="settings-key-row">
            <code className="settings-key-value">{userKey}</code>
            <button className="settings-copy-btn" onClick={copyKey}>{keyCopied ? '✓ Copied' : 'Copy'}</button>
          </div>
          <div className="settings-row" style={{ marginTop: 8 }}>
            <span className="settings-label">API URL</span>
            <code className="settings-api-url">{API}</code>
          </div>
        </div>
      )}

      {(view === 'list' || view === 'focus') && (
        <nav className="filter-nav">
          <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All <span className="filter-count">{tasks.length}</span></button>
          {STATUS_ORDER.map(s => (
            <button key={s} className={`filter-btn ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
              {STATUS_LABELS[s]} <span className="filter-count">{counts[s]}</span>
            </button>
          ))}
        </nav>
      )}

      {view === 'list' && (
        <main className="list-main">
          {loading && <p className="state-msg">Loading…</p>}
          {error && <p className="state-msg state-msg--error">{error}</p>}
          {!loading && !error && (
            <TaskTable tasks={tasks} onSelect={setSelected} filter={filter} />
          )}
        </main>
      )}

      {view === 'focus' && (
        <main className="focus-grid">
          {loading && <p className="state-msg">Loading…</p>}
          {error && <p className="state-msg state-msg--error">{error}</p>}
          {!loading && !error && tasks.length === 0 && <p className="state-msg">No tasks — press <kbd>Alt+T</kbd> to capture one.</p>}
          {(filter === 'all' ? tasks : tasks.filter(t => t.status === filter)).map(task => (
            <FocusCard key={task.id} task={task} onClick={() => setSelected(task)}
              onColorChange={c => patchTask(task.id, { nodeColor: c })} />
          ))}
        </main>
      )}

      {view === 'graph' && (
        <div className="graph-container">
          <GraphView tasks={tasks} onSelect={setSelected} onRefresh={fetchTasks} theme={theme} />
        </div>
      )}

      <DetailPanel task={selected} tasks={tasks} onClose={() => setSelected(null)} onRefresh={fetchTasks} onDelete={() => { setSelected(null); fetchTasks() }} />
    </div>
  )
}
