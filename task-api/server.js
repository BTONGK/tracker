import express from 'express'
import cors from 'cors'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import multer from 'multer'

// ── LLM provider ──────────────────────────────────────────────────────────────
// Set LLM_PROVIDER=ollama (or leave ANTHROPIC_API_KEY unset) to use local Ollama.
// OLLAMA_URL defaults to http://localhost:11434
// OLLAMA_MODEL defaults to llama3.2

const TASK_LIMIT = 10

const LLM_PROVIDER = process.env.LLM_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'ollama')
const OLLAMA_URL   = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR    = join(__dirname, 'data')
const UPLOADS_DIR = join(__dirname, 'uploads')
mkdirSync(DATA_DIR,    { recursive: true })
mkdirSync(UPLOADS_DIR, { recursive: true })

// ── Key helpers ───────────────────────────────────────────────────────────────

function validKey(k) {
  return typeof k === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(k)
}

function getKey(req) {
  return req.query.key || req.headers['x-task-key'] || ''
}

function requireKey(req, res) {
  const key = getKey(req)
  if (!validKey(key)) { res.status(401).json({ error: 'Missing or invalid API key. Add ?key=YOUR_KEY to the request.' }); return null }
  return key
}

function dataFile(key)     { return join(DATA_DIR, `${key}.json`) }
function userUploads(key)  { const d = join(UPLOADS_DIR, key); mkdirSync(d, { recursive: true }); return d }

function read(key) {
  const f = dataFile(key)
  if (!existsSync(f)) return []
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return [] }
}

function write(key, tasks) {
  writeFileSync(dataFile(key), JSON.stringify(tasks, null, 2))
}

// ── Multer (per-user upload dirs) ─────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const key = getKey(req)
    cb(null, validKey(key) ? userUploads(key) : UPLOADS_DIR)
  },
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
})
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } })

// ── LLM call helper ───────────────────────────────────────────────────────────

const anthropic = LLM_PROVIDER === 'anthropic' ? new Anthropic() : null

async function callLLM(prompt, maxTokens = 512) {
  if (LLM_PROVIDER === 'anthropic') {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    })
    return msg.content[0].text
  }
  // Ollama via OpenAI-compatible endpoint
  const resp = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    }),
  })
  if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text()}`)
  const data = await resp.json()
  return data.choices[0].message.content
}

// ── Express ───────────────────────────────────────────────────────────────────

const app = express()

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile, curl, etc.) and any https origin
    if (!origin) return cb(null, true)
    if (origin.startsWith('chrome-extension://')) return cb(null, true)
    if (origin.startsWith('https://')) return cb(null, true)
    if (origin.includes('localhost')) return cb(null, true)
    cb(new Error('CORS: origin not allowed'))
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-task-key'],
}))

app.use(express.json({ limit: '2mb' }))

// Health check (no key needed)
app.get('/health', (_req, res) => res.json({ ok: true }))

// ── Task routes ───────────────────────────────────────────────────────────────

app.get('/tasks', (req, res) => {
  const key = requireKey(req, res); if (!key) return
  res.json(read(key))
})

function extractKeywords(text) {
  const stopwords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','was','are','were','be','been','have','has','had','do','does','did','will','would','could','should','may','might','this','that','these','those','i','you','he','she','we','they','it','my','your','our','their','its','me','him','her','us','them','reply','please','hi','hello','dear','thanks','thank','regards','email','re','fw','fwd'])
  return [...new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopwords.has(w))
  )]
}

function findKeywordLinks(newTask, allTasks) {
  const newKw = new Set(extractKeywords(`${newTask.title} ${newTask.notes}`))
  const linked = []
  for (const t of allTasks) {
    if (t.id === newTask.id) continue
    const kw = extractKeywords(`${t.title} ${t.notes}`)
    const shared = kw.filter(k => newKw.has(k))
    const sharedAssignees = (newTask.assignees || []).filter(a => (t.assignees || []).includes(a))
    if (shared.length >= 2 || (shared.length >= 1 && sharedAssignees.length >= 1)) linked.push(t.id)
  }
  return linked
}

app.post('/tasks', (req, res) => {
  const key = requireKey(req, res); if (!key) return
  const tasks = read(key)
  if (tasks.length >= TASK_LIMIT) {
    return res.status(429).json({ error: 'limit_reached', count: tasks.length, limit: TASK_LIMIT })
  }
  const now = new Date().toISOString()
  const task = {
    id: randomUUID(),
    title: req.body.title?.trim() || 'Untitled',
    notes: req.body.notes?.trim() || '',
    priority: req.body.priority || 'medium',
    status: 'todo',
    assignees: req.body.assignees || [],
    dueDate: req.body.dueDate || null,
    actionType: req.body.actionType || null,
    source: req.body.source || null,
    linkedTasks: [],
    keywordLinks: findKeywordLinks({ title: req.body.title, notes: req.body.notes, assignees: req.body.assignees, id: '__new__' }, tasks),
    comments: [],
    attachments: [],
    timeline: (req.body.timeline || []).length
      ? req.body.timeline
      : [{ type: 'capture', text: req.body.notes || '', source: req.body.source?.type, createdAt: now }],
    createdAt: now,
    updatedAt: now,
  }
  task.keywordLinks.forEach(id => {
    const t = tasks.find(t => t.id === id)
    if (t) { if (!t.keywordLinks) t.keywordLinks = []; if (!t.keywordLinks.includes(task.id)) t.keywordLinks.push(task.id) }
  })
  tasks.unshift(task)
  write(key, tasks)
  res.status(201).json(task)
})

app.patch('/tasks/:id', (req, res) => {
  const key = requireKey(req, res); if (!key) return
  const tasks = read(key)
  const idx = tasks.findIndex(t => t.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  tasks[idx] = { ...tasks[idx], ...req.body, id: tasks[idx].id, updatedAt: new Date().toISOString() }
  write(key, tasks)
  res.json(tasks[idx])
})

app.delete('/tasks/:id', (req, res) => {
  const key = requireKey(req, res); if (!key) return
  const tasks = read(key)
  const idx = tasks.findIndex(t => t.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  tasks.splice(idx, 1)
  write(key, tasks)
  res.status(204).end()
})

app.post('/tasks/:id/comments', (req, res) => {
  const key = requireKey(req, res); if (!key) return
  const tasks = read(key)
  const task = tasks.find(t => t.id === req.params.id)
  if (!task) return res.status(404).json({ error: 'Not found' })
  const comment = { id: randomUUID(), author: req.body.author?.trim() || 'You', text: req.body.text?.trim(), createdAt: new Date().toISOString() }
  if (!comment.text) return res.status(400).json({ error: 'Text required' })
  if (!task.comments) task.comments = []
  if (!task.timeline) task.timeline = []
  task.comments.push(comment)
  task.timeline.push({ type: 'comment', ...comment })
  task.updatedAt = comment.createdAt
  write(key, tasks)
  res.status(201).json(comment)
})

app.post('/tasks/:id/attachments', upload.single('file'), (req, res) => {
  const key = requireKey(req, res); if (!key) return
  const tasks = read(key)
  const task = tasks.find(t => t.id === req.params.id)
  if (!task) return res.status(404).json({ error: 'Not found' })
  if (!req.file) return res.status(400).json({ error: 'No file' })
  const attachment = { id: randomUUID(), filename: req.file.filename, originalName: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype, userKey: key, createdAt: new Date().toISOString() }
  if (!task.attachments) task.attachments = []
  if (!task.timeline) task.timeline = []
  task.attachments.push(attachment)
  task.timeline.push({ type: 'attachment', filename: attachment.originalName, id: attachment.id, createdAt: attachment.createdAt })
  task.updatedAt = attachment.createdAt
  write(key, tasks)
  res.status(201).json(attachment)
})

app.get('/files/:key/:filename', (req, res) => {
  const { key, filename } = req.params
  if (!validKey(key)) return res.status(400).json({ error: 'Invalid key' })
  const filePath = join(UPLOADS_DIR, key, filename.replace(/[^a-zA-Z0-9._-]/g, '_'))
  if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' })
  res.sendFile(filePath)
})

// Legacy file path (backwards compat with existing attachments)
app.get('/files/:filename', (req, res) => {
  const filePath = join(UPLOADS_DIR, req.params.filename)
  if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' })
  res.sendFile(filePath)
})

app.post('/tasks/:id/status', (req, res) => {
  const key = requireKey(req, res); if (!key) return
  const tasks = read(key)
  const task = tasks.find(t => t.id === req.params.id)
  if (!task) return res.status(404).json({ error: 'Not found' })
  const prev = task.status
  task.status = req.body.status
  if (!task.timeline) task.timeline = []
  task.timeline.push({ type: 'status', from: prev, to: req.body.status, createdAt: new Date().toISOString() })
  task.updatedAt = new Date().toISOString()
  write(key, tasks)
  res.json(task)
})

app.post('/link', (req, res) => {
  const key = requireKey(req, res); if (!key) return
  const { taskId, relatedId } = req.body
  if (!taskId || !relatedId || taskId === relatedId) return res.status(400).json({ error: 'Invalid IDs' })
  const tasks = read(key)
  const a = tasks.find(t => t.id === taskId), b = tasks.find(t => t.id === relatedId)
  if (!a || !b) return res.status(404).json({ error: 'Task not found' })
  if (!a.linkedTasks) a.linkedTasks = []; if (!b.linkedTasks) b.linkedTasks = []
  if (!a.linkedTasks.includes(relatedId)) a.linkedTasks.push(relatedId)
  if (!b.linkedTasks.includes(taskId)) b.linkedTasks.push(taskId)
  a.updatedAt = b.updatedAt = new Date().toISOString()
  write(key, tasks)
  res.json({ ok: true })
})

app.post('/unlink', (req, res) => {
  const key = requireKey(req, res); if (!key) return
  const { taskId, relatedId } = req.body
  if (!taskId || !relatedId) return res.status(400).json({ error: 'Invalid IDs' })
  const tasks = read(key)
  const a = tasks.find(t => t.id === taskId), b = tasks.find(t => t.id === relatedId)
  if (!a || !b) return res.status(404).json({ error: 'Task not found' })
  a.linkedTasks  = (a.linkedTasks  || []).filter(id => id !== relatedId)
  b.linkedTasks  = (b.linkedTasks  || []).filter(id => id !== taskId)
  a.keywordLinks = (a.keywordLinks || []).filter(id => id !== relatedId)
  b.keywordLinks = (b.keywordLinks || []).filter(id => id !== taskId)
  a.updatedAt = b.updatedAt = new Date().toISOString()
  write(key, tasks)
  res.json({ ok: true })
})


// ── AI quota ──────────────────────────────────────────────────────────────────

function checkAIQuota(key, res) {
  const count = read(key).length
  if (count >= TASK_LIMIT) {
    res.status(429).json({ error: 'limit_reached', count, limit: TASK_LIMIT })
    return false
  }
  return true
}

// ── AI routes ─────────────────────────────────────────────────────────────────

app.post('/suggest-links', async (req, res) => {
  const key = requireKey(req, res); if (!key) return
  if (!checkAIQuota(key, res)) return
  const { taskId } = req.body
  const tasks = read(key)
  const target = tasks.find(t => t.id === taskId)
  if (!target) return res.status(404).json({ error: 'Not found' })
  const candidates = tasks.filter(t => t.id !== taskId && !target.linkedTasks?.includes(t.id))
  if (candidates.length === 0) return res.json([])

  const candidateList = candidates.map((t, i) =>
    `[${i}] ID:${t.id} | "${t.title}" | assignees: ${t.assignees?.join(', ') || 'none'} | notes: ${t.notes?.slice(0, 100) || ''}`
  ).join('\n')

  const prompt = `You are analyzing task relationships.

New task:
Title: "${target.title}"
Notes: "${target.notes}"
Assignees: ${target.assignees?.join(', ') || 'none'}
Source: ${target.source?.type || 'unknown'}

Existing tasks:
${candidateList}

Find tasks that are meaningfully related — same project, same people, dependent actions, or directly related topics. Ignore superficial word overlap.

Return ONLY a JSON array of up to 3 matches (empty array if none), no markdown:
[{"id": "<task id>", "reason": "<one short phrase why they're related>"}]`

  try {
    const raw = (await callLLM(prompt, 256)).trim().replace(/^```json?\n?|\n?```$/g, '')
    const suggestions = JSON.parse(raw)
    const enriched = suggestions
      .filter(s => candidates.find(c => c.id === s.id))
      .map(s => ({ ...s, title: candidates.find(c => c.id === s.id)?.title }))
    res.json(enriched)
  } catch (err) {
    console.error('suggest-links failed:', err.message)
    res.json([])
  }
})

app.post('/analyze', async (req, res) => {
  const key = requireKey(req, res); if (!key) return
  if (!checkAIQuota(key, res)) return
  const { subject, sender, cc, body, attachments, sourceType, pageUrl, targetMessage } = req.body
  const attachmentLine = attachments?.length ? `Attachments: ${attachments.join(', ')}` : ''
  const ccLine = cc?.length ? `CC: ${cc.join(', ')}` : ''

  const JSON_SCHEMA = `{"title":"specific actionable task (max 90 chars)","priority":"low | medium | high","notes":"1-2 sentences of essential context","assignees":["people who need to act, max 5"],"dueDate":"YYYY-MM-DD if mentioned, otherwise null","actionType":"reply | review | schedule | approve | forward | call | read | other"}`

  let prompt
  if (sourceType === 'gmail') {
    prompt = `You are an intelligent assistant that turns emails into actionable tasks.

Email:
Subject: ${subject || '(no subject)'}
From: ${sender || 'unknown'}
${ccLine}
${attachmentLine}
Full thread (oldest → newest, separated by ---):
${body || '(empty)'}

Read the entire thread. What is the single most important action required? Be specific.

Return ONLY valid JSON, no markdown: ${JSON_SCHEMA}`
  } else {
    prompt = `You are an intelligent assistant that turns content into actionable tasks.

Source: ${sourceType || 'web'} — ${subject || pageUrl || '(unknown)'}
${sender ? `From: ${sender}` : ''}
Content: ${body || '(none)'}

Extract the most actionable task from this content.

Return ONLY valid JSON, no markdown: ${JSON_SCHEMA}`
  }

  try {
    const raw = (await callLLM(prompt, 512)).trim().replace(/^```json?\n?|\n?```$/g, '')
    res.json(JSON.parse(raw))
  } catch (err) {
    console.error('Analyze failed:', err.message)
    res.status(500).json({ error: 'Analysis failed' })
  }
})

app.post('/suggest-actions', async (req, res) => {
  const key = requireKey(req, res); if (!key) return
  if (!checkAIQuota(key, res)) return
  const { taskId } = req.body
  const tasks = read(key)
  const task = tasks.find(t => t.id === taskId)
  if (!task) return res.status(404).json({ error: 'Not found' })
  const linked = (task.linkedTasks || []).map(id => tasks.find(t => t.id === id)).filter(Boolean)

  const prompt = `You are a productivity assistant. Generate 3-5 specific, concrete action items for this task.

Task: "${task.title}"
Notes: ${task.notes || '(none)'}
Priority: ${task.priority}
Action type: ${task.actionType || 'other'}
Due: ${task.dueDate || 'none'}
Assignees: ${task.assignees?.join(', ') || 'none'}
Source: ${task.source?.type || 'unknown'}
${linked.length ? `Related tasks: ${linked.map(t => `"${t.title}"`).join(', ')}` : ''}

Return ONLY valid JSON array, no markdown:
[{"action":"specific thing to do","why":"one short reason","urgency":"now|soon|later"}]`

  try {
    const raw = (await callLLM(prompt, 512)).trim().replace(/^```json?\n?|\n?```$/g, '')
    res.json(JSON.parse(raw))
  } catch (err) {
    console.error('suggest-actions failed:', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ── Start ──────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3002
app.listen(PORT, () => {
  console.log(`Task API → http://localhost:${PORT}`)
  if (LLM_PROVIDER === 'anthropic') {
    console.log(`LLM: Anthropic (claude-haiku) — key ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗ missing'}`)
  } else {
    console.log(`LLM: Ollama @ ${OLLAMA_URL} — model ${OLLAMA_MODEL}`)
  }
})
