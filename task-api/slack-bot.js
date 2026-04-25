import { App } from '@slack/bolt'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TASK_API = 'http://localhost:3002'
const TRACK_EMOJI = 'pushpin' // 📌

// Load .env
const envFile = join(__dirname, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim()
    if (v && !process.env[k]) process.env[k] = v
  }
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
})

async function getName(client, userId) {
  if (!userId) return null
  try {
    const info = await client.users.info({ user: userId })
    return info.user?.real_name || info.user?.name || null
  } catch { return null }
}

async function getChannelName(client, channelId) {
  try {
    const info = await client.conversations.info({ channel: channelId })
    return info.channel?.name || channelId
  } catch { return channelId }
}

app.event('reaction_added', async ({ event, client }) => {
  if (event.reaction !== TRACK_EMOJI) return

  const { channel, ts, thread_ts } = event.item

  try {
    // Fetch the exact message the user reacted to
    const history = await client.conversations.history({
      channel, latest: ts, oldest: ts, inclusive: true, limit: 1,
    })
    const message = history.messages?.[0]
    if (!message) return

    // Fetch the full thread — use thread_ts if already in a thread, otherwise ts is the root
    let threadContext = ''
    let threadMsgs = []
    const rootTs = thread_ts || ts
    try {
      const thread = await client.conversations.replies({ channel, ts: rootTs, limit: 20 })
      threadMsgs = thread.messages || []
      if (threadMsgs.length > 1) {
        const names = {}
        for (const m of threadMsgs) {
          if (m.user && !names[m.user]) names[m.user] = await getName(client, m.user) || m.user
        }
        threadContext = threadMsgs
          .map(m => {
            const name = names[m.user] || 'Bot'
            const pinned = m.ts === ts ? ' ← (pinned message)' : ''
            return `${name}: ${m.text}${pinned}`
          })
          .join('\n')
      }
    } catch {}

    // Resolve people
    const [authorName, reactorName, channelName] = await Promise.all([
      getName(client, message.user),
      getName(client, event.user),
      getChannelName(client, channel),
    ])

    const attachmentNames = (message.files || []).map(f => f.name)

    // Ask Claude what's actionable
    const analyzeRes = await fetch(`${TASK_API}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'slack',
        subject: `#${channelName}`,
        sender: authorName,
        body: threadContext || message.text,
        targetMessage: message.text,
        threadLength: threadMsgs.length,
        attachments: attachmentNames,
        pageUrl: `https://slack.com/archives/${channel}/p${ts.replace('.', '')}`,
      }),
    })
    const ai = await analyzeRes.json()

    // Create the task
    await fetch(`${TASK_API}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: ai.title || message.text?.slice(0, 80) || 'Slack message',
        notes: ai.notes || '',
        priority: ai.priority || 'medium',
        assignees: ai.assignees?.length ? ai.assignees : (authorName ? [authorName] : []),
        dueDate: ai.dueDate || null,
        actionType: ai.actionType || 'review',
        source: {
          type: 'slack',
          url: `https://slack.com/archives/${channel}/p${ts.replace('.', '')}`,
          title: `#${channelName}`,
          context: authorName ? `From: ${authorName}` : '',
        },
      }),
    })

    // DM only the person who reacted — nothing visible to others
    const dm = await client.conversations.open({ users: event.user })
    await client.chat.postMessage({
      channel: dm.channel.id,
      text: `✅ *Tracked:* ${ai.title || 'New task'}\n_${ai.priority || 'medium'} priority · from #${channelName}_`,
    })

  } catch (err) {
    console.error('Slack bot error:', err.message)
    try {
      await client.reactions.add({ channel: event.item.channel, timestamp: event.item.ts, name: 'x' })
    } catch {}
  }
})

;(async () => {
  await app.start()
  console.log('Slack bot running — react to any message with 📌 to track it')
  console.log(`Tasks appear at http://localhost:3002/tasks`)
})()
