// API URL and user key loaded from chrome.storage.sync at open time
const ROOT_ID = '__task-capture__'
let _cfg = { apiUrl: 'http://localhost:3002', userKey: '' }

function apiUrl(path) {
  const sep = path.includes('?') ? '&' : '?'
  return `${_cfg.apiUrl}${path}${_cfg.userKey ? `${sep}key=${encodeURIComponent(_cfg.userKey)}` : ''}`
}

// ── Context detection ─────────────────────────────────────────────────────────

function snippet(text, max = 1000) {
  if (!text) return ''
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : clean.slice(0, max).replace(/\s\S*$/, '') + '…'
}

function getContext() {
  const url = window.location.href
  const selected = window.getSelection()?.toString()?.trim()

  if (url.includes('mail.google.com')) {
    const subject =
      document.querySelector('h2[data-legacy-thread-id]')?.textContent?.trim() ||
      document.querySelector('.hP')?.textContent?.trim() || ''

    const emailEls = document.querySelectorAll('.gs')
    let sender = ''
    const threadParts = []
    const timeline = []

    if (emailEls.length > 0) {
      emailEls.forEach(el => {
        const from =
          el.querySelector('.gD')?.getAttribute('email') ||
          el.querySelector('.go')?.textContent?.trim() || ''
        const bodyEl = [...el.querySelectorAll('.a3s')].find(e => e.innerText?.trim())
        const text = bodyEl?.innerText?.trim() || ''
        const dateEl = el.querySelector('.g3, .ada')
        const dateRaw = dateEl?.getAttribute('title') || dateEl?.getAttribute('data-tooltip') || dateEl?.textContent?.trim() || ''
        if (text) {
          threadParts.push(from ? `From ${from}:\n${text}` : text)
          if (!sender && from) sender = from
          timeline.push({ type: 'message', author: from, text: snippet(text, 500), dateRaw, createdAt: new Date().toISOString() })
        }
      })
    } else {
      sender = document.querySelector('.gD')?.getAttribute('email') ||
               document.querySelector('.go')?.textContent?.trim() || ''
      const bodyEl = [...document.querySelectorAll('.a3s')].filter(e => e.innerText?.trim()).pop()
      if (bodyEl) threadParts.push(bodyEl.innerText.trim())
    }

    const body = snippet(threadParts.join('\n\n---\n\n'), 2000)
    const ccEmails = [...document.querySelectorAll('.adn .g2, .adn .go, .acl .g2')]
      .map(el => el.getAttribute('email') || el.textContent?.trim())
      .filter(e => e && e !== sender)
    const attachments = [...document.querySelectorAll('.aZo .aQH, .brc .bq9')]
      .map(el => el.textContent?.trim()).filter(Boolean)

    return { sourceType: 'gmail', url, subject, sender, cc: ccEmails, body, attachments, timeline, prefill: subject || selected || '' }
  }

  if (url.includes('github.com')) {
    const issue =
      document.querySelector('.js-issue-title')?.textContent?.trim() ||
      document.querySelector('h1 bdi')?.textContent?.trim() || ''
    const body = snippet(document.querySelector('.comment-body, .markdown-body')?.innerText || '')
    return { sourceType: 'github', url, subject: issue || document.title, sender: '', body, attachments: [], prefill: issue || selected || document.title }
  }

  if (url.includes('app.slack.com') || url.includes('slack.com/archives')) {
    const channel = document.querySelector('.p-view_header__name, .c-channel_name')?.textContent?.trim() || ''
    const msgEl = document.querySelector('.c-message_kit__text, .p-rich_text_section')
    const msg = snippet(msgEl?.innerText || selected || '')
    return { sourceType: 'slack', url, subject: channel ? `#${channel}` : document.title, sender: '', body: msg, attachments: [], prefill: selected || msg || document.title }
  }

  if (url.includes('notion.so') || url.includes('notion.site')) {
    const title = document.querySelector('.notion-page-block .notranslate, .notion-title')?.textContent?.trim() || document.title
    return { sourceType: 'notion', url, subject: title, sender: '', body: selected || '', attachments: [], prefill: selected || title }
  }

  if (url.includes('web.whatsapp.com')) {
    const contact = document.querySelector('._21S-L span[title], .copyable-text span[data-testid="conversation-title"]')?.textContent?.trim() || ''
    const msg = snippet(document.querySelector('.copyable-text span')?.innerText || selected || '')
    return { sourceType: 'whatsapp', url, subject: contact || 'WhatsApp', sender: contact, body: msg, attachments: [], prefill: selected || msg || contact }
  }

  if (url.includes('x.com') || url.includes('twitter.com')) {
    const tweet = snippet(document.querySelector('[data-testid="tweetText"]')?.innerText || selected || '')
    const user = document.querySelector('[data-testid="User-Name"] span')?.textContent?.trim() || ''
    return { sourceType: 'twitter', url, subject: user ? `Tweet by ${user}` : document.title, sender: user, body: tweet, attachments: [], prefill: selected || tweet }
  }

  if (url.includes('linear.app')) {
    const title = document.querySelector('.issue-title, h1')?.textContent?.trim() || document.title
    const body = snippet(document.querySelector('.description-editor, .comment-body')?.innerText || selected || '')
    return { sourceType: 'linear', url, subject: title, sender: '', body, attachments: [], prefill: selected || title }
  }

  return {
    sourceType: 'web', url, subject: document.title, sender: '',
    body: selected || snippet(document.querySelector('meta[name="description"]')?.content || ''),
    attachments: [], prefill: selected || document.title,
  }
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Backdrop ── */
  .backdrop {
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(0,0,0,0.22);
    backdrop-filter: blur(10px) saturate(120%);
    -webkit-backdrop-filter: blur(10px) saturate(120%);
    display: flex; align-items: flex-start; justify-content: center;
    padding-top: 14vh;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Glass card — Spotlight style ── */
  .card {
    position: relative;
    width: 660px;
    max-width: calc(100vw - 32px);
    overflow: hidden;
    border-radius: 20px;

    /* Layered glass */
    background: linear-gradient(
      160deg,
      rgba(30, 26, 46, 0.78) 0%,
      rgba(18, 16, 28, 0.82) 100%
    );
    backdrop-filter: blur(56px) saturate(210%) brightness(0.88);
    -webkit-backdrop-filter: blur(56px) saturate(210%) brightness(0.88);

    /* Glass edge */
    border: 0.5px solid rgba(255,255,255,0.14);

    /* Depth shadows */
    box-shadow:
      0 0 0 0.5px rgba(255,255,255,0.06),
      0 4px 6px rgba(0,0,0,0.15),
      0 12px 32px rgba(0,0,0,0.45),
      0 40px 80px rgba(0,0,0,0.55),
      inset 0 1px 0 rgba(255,255,255,0.13),
      inset 0 -1px 0 rgba(0,0,0,0.25);

    animation: glassIn 0.24s cubic-bezier(0.32, 1.2, 0.64, 1);
  }

  @keyframes glassIn {
    from { opacity: 0; transform: scale(0.94) translateY(-14px); filter: blur(2px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);     filter: blur(0); }
  }

  /* Specular top highlight — the "glass catching light" effect */
  .card::before {
    content: '';
    position: absolute; top: 0; left: 16px; right: 16px; height: 1px;
    background: linear-gradient(90deg,
      transparent 0%,
      rgba(255,255,255,0.22) 25%,
      rgba(255,255,255,0.38) 50%,
      rgba(255,255,255,0.22) 75%,
      transparent 100%
    );
    border-radius: 20px;
    z-index: 1;
  }

  /* ── Spotlight-style search header ── */
  .spotlight-header {
    display: flex; align-items: center; gap: 14px;
    padding: 18px 20px 16px;
    border-bottom: 0.5px solid rgba(255,255,255,0.07);
  }

  .spotlight-icon {
    font-size: 17px; opacity: 0.35; flex-shrink: 0;
    filter: drop-shadow(0 0 6px rgba(180,160,255,0.4));
  }

  .title-input {
    flex: 1; background: transparent; border: none;
    color: rgba(255,255,255,0.92);
    font-size: 19px; font-weight: 400; letter-spacing: -0.3px;
    outline: none; line-height: 1.4;
    caret-color: rgba(160,150,255,0.9);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  }
  .title-input::placeholder { color: rgba(255,255,255,0.18); }

  .ai-badge {
    flex-shrink: 0;
    background: linear-gradient(135deg, rgba(124,111,247,0.25), rgba(108,92,231,0.15));
    border: 0.5px solid rgba(160,150,255,0.3);
    border-radius: 6px; color: rgba(180,170,255,0.9);
    font-size: 10px; font-weight: 600; letter-spacing: 0.8px;
    padding: 3px 8px; text-transform: uppercase;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
  }

  /* ── Loading state ── */
  .shimmer-block { padding: 20px 20px 6px; }

  .shimmer-line {
    border-radius: 8px; margin-bottom: 10px;
    background: linear-gradient(
      105deg,
      rgba(255,255,255,0.03) 0%,
      rgba(255,255,255,0.06) 30%,
      rgba(255,255,255,0.12) 50%,
      rgba(255,255,255,0.06) 70%,
      rgba(255,255,255,0.03) 100%
    );
    background-size: 250% 100%;
    animation: glass-shimmer 1.8s ease-in-out infinite;
    height: 13px;
  }

  .shimmer-line.title { height: 22px; border-radius: 10px; margin-bottom: 16px; }
  .shimmer-line.w-full  { width: 100%; }
  .shimmer-line.w-3q    { width: 73%; }
  .shimmer-line.w-half  { width: 50%; }
  .shimmer-line.sm      { height: 10px; }

  @keyframes glass-shimmer {
    0%   { background-position:  200% 0; }
    100% { background-position: -200% 0; }
  }

  .loading-footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 13px 18px; border-top: 0.5px solid rgba(255,255,255,0.06); margin-top: 6px;
  }
  .loading-label {
    display: flex; align-items: center; gap: 10px;
    color: rgba(255,255,255,0.3); font-size: 12.5px; letter-spacing: 0.1px;
  }

  .spinner {
    width: 18px; height: 18px; border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.1);
    border-top-color: rgba(160,150,255,0.85);
    animation: spin 0.8s cubic-bezier(0.4,0,0.2,1) infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Form sections ── */
  .context-bar {
    display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
    padding: 10px 20px;
    background: rgba(255,255,255,0.025);
    border-bottom: 0.5px solid rgba(255,255,255,0.055);
  }

  .chip {
    border-radius: 20px; font-size: 11px; font-weight: 500;
    padding: 3px 10px; white-space: nowrap; letter-spacing: 0.1px;
  }
  .chip-source {
    background: rgba(160,150,255,0.12); border: 0.5px solid rgba(160,150,255,0.28);
    color: rgba(190,182,255,0.9); text-transform: capitalize;
  }
  .chip-action {
    background: rgba(255,255,255,0.05); border: 0.5px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.4); text-transform: capitalize;
  }
  .chip-attach {
    background: rgba(255,255,255,0.04); border: 0.5px solid rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.35);
  }
  .chip-due {
    background: rgba(251,191,36,0.1); border: 0.5px solid rgba(251,191,36,0.25);
    color: rgba(251,191,36,0.85);
  }
  .chip-cc {
    background: rgba(99,179,237,0.08); border: 0.5px solid rgba(99,179,237,0.2);
    color: rgba(144,205,244,0.8);
  }

  .sender-line {
    padding: 0 20px 8px;
    color: rgba(255,255,255,0.28); font-size: 11.5px; letter-spacing: 0.1px;
  }

  /* ── Section rows ── */
  .form-section {
    padding: 10px 20px;
    border-bottom: 0.5px solid rgba(255,255,255,0.048);
  }

  .section-label {
    color: rgba(255,255,255,0.25); font-size: 11px; font-weight: 500;
    letter-spacing: 0.5px; text-transform: uppercase;
    margin-bottom: 8px; display: block;
  }

  /* ── Assignees ── */
  .assignees-wrap {
    display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  }

  .assignee-chip {
    display: flex; align-items: center; gap: 5px;
    background: rgba(16,185,129,0.1); border: 0.5px solid rgba(16,185,129,0.22);
    border-radius: 20px; color: rgba(110,231,183,0.9);
    font-size: 12px; padding: 4px 10px;
    backdrop-filter: blur(8px);
  }
  .assignee-avatar {
    width: 16px; height: 16px; border-radius: 50%;
    background: rgba(16,185,129,0.25); display: flex; align-items: center;
    justify-content: center; font-size: 9px; font-weight: 700;
    color: rgba(110,231,183,0.9); flex-shrink: 0;
  }
  .assignee-remove {
    background: none; border: none; color: rgba(110,231,183,0.4);
    cursor: pointer; font-size: 14px; line-height: 1; padding: 0; margin-left: 2px;
    font-family: inherit; transition: color 0.12s;
  }
  .assignee-remove:hover { color: rgba(110,231,183,0.85); }

  .assignee-input {
    background: rgba(255,255,255,0.05); border: 0.5px solid rgba(255,255,255,0.1);
    border-radius: 20px; color: rgba(255,255,255,0.65);
    font-size: 12px; font-family: inherit; outline: none;
    padding: 4px 12px; width: 150px; transition: all 0.15s;
    backdrop-filter: blur(8px);
  }
  .assignee-input:focus {
    border-color: rgba(16,185,129,0.35); background: rgba(16,185,129,0.06);
  }
  .assignee-input::placeholder { color: rgba(255,255,255,0.2); }

  /* ── Priority ── */
  .priority-wrap { display: flex; align-items: center; gap: 6px; }

  .priority-btn {
    background: rgba(255,255,255,0.05); border: 0.5px solid rgba(255,255,255,0.1);
    border-radius: 8px; color: rgba(255,255,255,0.32); cursor: pointer;
    font-size: 12px; font-weight: 500; padding: 5px 13px;
    transition: all 0.14s; text-transform: capitalize; font-family: inherit;
    backdrop-filter: blur(8px);
  }
  .priority-btn:hover { border-color: rgba(255,255,255,0.2); color: rgba(255,255,255,0.6); }

  .priority-btn.active-low {
    background: rgba(107,114,128,0.18); border-color: rgba(107,114,128,0.45);
    color: rgba(156,163,175,0.95);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 0 12px rgba(107,114,128,0.15);
  }
  .priority-btn.active-medium {
    background: rgba(245,158,11,0.14); border-color: rgba(245,158,11,0.4);
    color: rgba(251,191,36,0.95);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 0 12px rgba(245,158,11,0.15);
  }
  .priority-btn.active-high {
    background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.4);
    color: rgba(248,113,113,0.95);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 0 12px rgba(239,68,68,0.15);
  }

  /* ── Notes ── */
  .notes-area {
    background: transparent; border: none;
    color: rgba(255,255,255,0.5);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    font-size: 13px; line-height: 1.65; outline: none;
    padding: 0; resize: none; width: 100%;
  }
  .notes-area::placeholder { color: rgba(255,255,255,0.15); }

  /* ── Footer bar ── */
  .card-footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 13px 18px;
    border-top: 0.5px solid rgba(255,255,255,0.06);
    background: rgba(0,0,0,0.12);
  }

  .footer-hint { color: rgba(255,255,255,0.15); font-size: 11.5px; letter-spacing: 0.1px; }

  .footer-actions { display: flex; gap: 8px; align-items: center; }

  .btn-cancel {
    background: rgba(255,255,255,0.06); border: 0.5px solid rgba(255,255,255,0.1);
    border-radius: 10px; color: rgba(255,255,255,0.45);
    cursor: pointer; font-size: 13px; font-family: inherit;
    padding: 7px 16px; transition: all 0.14s; letter-spacing: 0.1px;
    backdrop-filter: blur(8px);
  }
  .btn-cancel:hover {
    background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.18);
    color: rgba(255,255,255,0.7);
  }

  .btn-submit {
    background: linear-gradient(135deg, rgba(140,126,255,0.9) 0%, rgba(108,92,231,0.95) 100%);
    border: 0.5px solid rgba(255,255,255,0.18);
    border-radius: 10px; color: rgba(255,255,255,0.96);
    cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600;
    padding: 7px 20px; transition: all 0.14s; letter-spacing: 0.1px;
    box-shadow:
      0 2px 8px rgba(108,92,231,0.45),
      inset 0 1px 0 rgba(255,255,255,0.22);
  }
  .btn-submit:hover {
    background: linear-gradient(135deg, rgba(155,142,255,0.95) 0%, rgba(124,108,248,1) 100%);
    box-shadow: 0 4px 16px rgba(108,92,231,0.55), inset 0 1px 0 rgba(255,255,255,0.25);
    transform: translateY(-1px);
  }
  .btn-submit:active { transform: translateY(0); }
  .btn-submit:disabled {
    background: rgba(108,92,231,0.25); border-color: rgba(108,92,231,0.2);
    box-shadow: none; cursor: not-allowed; opacity: 0.6; transform: none;
  }

  /* ── Toast ── */
  .toast {
    position: fixed; bottom: 28px; right: 28px; z-index: 2147483647;
    background: linear-gradient(135deg, rgba(30,200,130,0.22), rgba(16,185,129,0.18));
    backdrop-filter: blur(32px) saturate(200%);
    -webkit-backdrop-filter: blur(32px) saturate(200%);
    border: 0.5px solid rgba(16,185,129,0.35);
    border-radius: 14px;
    box-shadow:
      0 4px 20px rgba(0,0,0,0.35),
      0 1px 0 rgba(255,255,255,0.08) inset;
    color: rgba(110,231,183,0.95);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    font-size: 13.5px; font-weight: 500; padding: 12px 20px;
    -webkit-font-smoothing: antialiased;
    animation: toastIn 0.22s cubic-bezier(0.34,1.4,0.64,1);
  }
  @keyframes toastIn {
    from { opacity: 0; transform: translateY(12px) scale(0.95); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* ── Link suggestion panel ── */
  .link-panel {
    position: fixed; bottom: 28px; right: 28px; z-index: 2147483647;
    background: linear-gradient(160deg, rgba(28,24,42,0.78), rgba(18,16,28,0.84));
    backdrop-filter: blur(48px) saturate(200%);
    -webkit-backdrop-filter: blur(48px) saturate(200%);
    border: 0.5px solid rgba(255,255,255,0.12);
    border-radius: 18px;
    box-shadow:
      0 0 0 0.5px rgba(255,255,255,0.05),
      0 8px 32px rgba(0,0,0,0.5),
      inset 0 1px 0 rgba(255,255,255,0.1);
    width: 330px; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    -webkit-font-smoothing: antialiased;
    animation: toastIn 0.24s cubic-bezier(0.34,1.3,0.64,1);
  }
  .link-panel-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding: 15px 16px 12px;
    border-bottom: 0.5px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.025);
  }
  .link-panel-title { color: rgba(255,255,255,0.88); font-size: 13px; font-weight: 600; }
  .link-panel-sub { color: rgba(255,255,255,0.32); font-size: 11.5px; margin-top: 2px; }
  .link-dismiss {
    background: rgba(255,255,255,0.06); border: 0.5px solid rgba(255,255,255,0.1);
    border-radius: 50%; color: rgba(255,255,255,0.4); cursor: pointer;
    font-size: 16px; line-height: 1; padding: 0; width: 24px; height: 24px;
    display: flex; align-items: center; justify-content: center;
    font-family: inherit; transition: all 0.12s;
  }
  .link-dismiss:hover { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); }

  .link-item {
    padding: 11px 16px; display: flex; align-items: flex-start; gap: 10px;
    border-bottom: 0.5px solid rgba(255,255,255,0.042); transition: background 0.12s;
  }
  .link-item:last-child { border-bottom: none; }
  .link-item:hover { background: rgba(255,255,255,0.03); }
  .link-item-text { flex: 1; min-width: 0; }
  .link-item-title {
    color: rgba(255,255,255,0.82); font-size: 12.5px; line-height: 1.3;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .link-item-reason { color: rgba(255,255,255,0.3); font-size: 11px; margin-top: 2px; }

  .link-btn {
    background: rgba(160,150,255,0.12); border: 0.5px solid rgba(160,150,255,0.28);
    border-radius: 8px; color: rgba(185,178,255,0.9); cursor: pointer;
    font-size: 12px; font-weight: 500; padding: 5px 12px; white-space: nowrap;
    font-family: inherit; transition: all 0.14s; flex-shrink: 0;
    backdrop-filter: blur(8px);
  }
  .link-btn:hover {
    background: rgba(160,150,255,0.2); border-color: rgba(160,150,255,0.45);
  }
  .link-btn.linked {
    background: rgba(16,185,129,0.12); border-color: rgba(16,185,129,0.28);
    color: rgba(110,231,183,0.9); cursor: default;
  }
`

// ── HTML builders ─────────────────────────────────────────────────────────────

function loadingHTML(ctx) {
  return `
    <div class="spotlight-header">
      <span class="spotlight-icon">⌘</span>
      <div style="flex:1">
        <div style="color:rgba(255,255,255,0.55);font-size:13px;letter-spacing:0.1px">
          ${esc(ctx.sourceType)} · ${esc(ctx.sender || ctx.url?.replace(/^https?:\/\//, '').slice(0, 60) || '')}
        </div>
      </div>
      <div class="spinner"></div>
    </div>
    <div class="shimmer-block">
      <div class="shimmer-line title w-full"></div>
      <div class="shimmer-line w-3q"></div>
      <div class="shimmer-line w-half sm" style="margin-top:16px"></div>
      <div class="shimmer-line w-3q sm"></div>
    </div>
    <div class="loading-footer">
      <div class="loading-label">
        <span style="font-size:11px;opacity:0.6">Analyzing with AI…</span>
      </div>
      <button class="btn-cancel" id="tc-cancel">Cancel</button>
    </div>
  `
}

function formHTML(ctx, ai) {
  const priority = ai?.priority || 'medium'
  const attachChips = (ctx.attachments || [])
    .map(a => `<span class="chip chip-attach">📎 ${esc(a)}</span>`).join('')
  const actionChip = ai?.actionType
    ? `<span class="chip chip-action">${esc(ai.actionType)}</span>` : ''
  const dueChip = ai?.dueDate
    ? `<span class="chip chip-due">📅 ${esc(ai.dueDate)}</span>` : ''
  const senderChips = ctx.sender
    ? `<span class="chip chip-source">${esc(ctx.sourceType)}</span>
       <span style="color:rgba(255,255,255,0.28);font-size:12px">${esc(ctx.sender)}</span>
       ${ctx.cc?.length ? `<span class="chip chip-cc">+${ctx.cc.length} CC</span>` : ''}` : `<span class="chip chip-source">${esc(ctx.sourceType)}</span>`

  const assigneeChips = (ai?.assignees || [])
    .map(a => {
      const inits = a.includes('@') ? a[0].toUpperCase() : a.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
      return `<span class="assignee-chip" data-name="${esc(a)}">
        <span class="assignee-avatar">${inits}</span>
        ${esc(a)}
        <button class="assignee-remove" title="Remove">×</button>
      </span>`
    }).join('')

  return `
    <div class="spotlight-header">
      <span class="spotlight-icon">⌘</span>
      <input class="title-input" id="tc-title" placeholder="Task title…" autocomplete="off" />
      ${ai ? '<span class="ai-badge">AI</span>' : ''}
    </div>

    <div class="context-bar">
      ${senderChips}
      ${actionChip}
      ${dueChip}
      ${attachChips}
    </div>

    <div class="form-section">
      <span class="section-label">Assign to</span>
      <div class="assignees-wrap">
        ${assigneeChips}
        <input class="assignee-input" id="tc-assignee-input" placeholder="Add name or email…" autocomplete="off" />
      </div>
    </div>

    <div class="form-section">
      <span class="section-label">Priority</span>
      <div class="priority-wrap">
        <button class="priority-btn ${priority === 'low' ? 'active-low' : ''}" data-p="low">Low</button>
        <button class="priority-btn ${priority === 'medium' ? 'active-medium' : ''}" data-p="medium">Medium</button>
        <button class="priority-btn ${priority === 'high' ? 'active-high' : ''}" data-p="high">High</button>
      </div>
    </div>

    <div class="form-section" style="border-bottom:none">
      <span class="section-label">Notes</span>
      <textarea class="notes-area" id="tc-notes" rows="3" placeholder="Context or follow-up notes…"></textarea>
    </div>

    <div class="card-footer">
      <span class="footer-hint">⌘↵ save &nbsp;·&nbsp; Esc dismiss</span>
      <div class="footer-actions">
        <button class="btn-cancel" id="tc-cancel">Cancel</button>
        <button class="btn-submit" id="tc-submit">Track It</button>
      </div>
    </div>
  `
}

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Overlay logic ─────────────────────────────────────────────────────────────

let root = null

function buildOverlay(ctx) {
  const backdrop = document.createElement('div')
  backdrop.className = 'backdrop'
  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = loadingHTML(ctx)
  backdrop.appendChild(card)

  backdrop.addEventListener('click', e => { if (e.target === backdrop) close() })
  card.querySelector('#tc-cancel')?.addEventListener('click', close)

  let priority = 'medium'
  let assignees = []
  let dueDate = null

  fetch(apiUrl(`/analyze`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceType: ctx.sourceType, subject: ctx.subject,
      sender: ctx.sender, cc: ctx.cc || [], body: ctx.body,
      attachments: ctx.attachments, pageUrl: ctx.url,
    }),
  })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null)
    .then(ai => {
      if (!root) return
      priority = ai?.priority || 'medium'
      assignees = [...(ai?.assignees || [])]
      dueDate = ai?.dueDate || null

      card.innerHTML = formHTML(ctx, ai)

      const titleEl = card.querySelector('#tc-title')
      const notesEl = card.querySelector('#tc-notes')
      if (titleEl) { titleEl.value = ai?.title || ctx.prefill || ''; titleEl.focus(); titleEl.select() }
      if (notesEl) notesEl.value = ai?.notes || ''

      wireForm(card, backdrop, ctx, () => priority, p => { priority = p }, () => assignees, () => dueDate)
    })

  return backdrop
}

function wireForm(card, backdrop, ctx, getPriority, setPriority, getAssignees, getDueDate) {
  card.querySelectorAll('.priority-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      card.querySelectorAll('.priority-btn').forEach(b => b.className = 'priority-btn')
      setPriority(btn.dataset.p)
      btn.className = `priority-btn active-${btn.dataset.p}`
    })
  })

  function bindRemoveButtons() {
    card.querySelectorAll('.assignee-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.closest('.assignee-chip').dataset.name
        const a = getAssignees()
        a.splice(a.indexOf(name), 1)
        btn.closest('.assignee-chip').remove()
      })
    })
  }
  bindRemoveButtons()

  const assigneeInput = card.querySelector('#tc-assignee-input')
  assigneeInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const val = assigneeInput.value.trim()
      if (!val) return
      const a = getAssignees()
      if (!a.includes(val)) {
        a.push(val)
        const inits = val.includes('@') ? val[0].toUpperCase() : val.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
        const chip = document.createElement('span')
        chip.className = 'assignee-chip'
        chip.dataset.name = val
        chip.innerHTML = `<span class="assignee-avatar">${inits}</span>${esc(val)}<button class="assignee-remove" title="Remove">×</button>`
        chip.querySelector('.assignee-remove').addEventListener('click', () => {
          a.splice(a.indexOf(val), 1)
          chip.remove()
        })
        assigneeInput.insertAdjacentElement('beforebegin', chip)
      }
      assigneeInput.value = ''
    }
  })

  card.querySelector('#tc-cancel')?.addEventListener('click', close)
  card.querySelector('#tc-submit')?.addEventListener('click', () => submit(card, ctx, getPriority, getAssignees, getDueDate))

  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(card, ctx, getPriority, getAssignees, getDueDate)
  })
}

async function submit(card, ctx, getPriority, getAssignees, getDueDate) {
  const title = card.querySelector('#tc-title')?.value.trim()
  if (!title) { card.querySelector('#tc-title')?.focus(); return }

  const btn = card.querySelector('#tc-submit')
  btn.disabled = true
  btn.textContent = 'Saving…'

  try {
    const res = await fetch(apiUrl(`/tasks`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        notes: card.querySelector('#tc-notes')?.value.trim() || '',
        priority: getPriority(),
        assignees: getAssignees(),
        dueDate: getDueDate(),
        source: { type: ctx.sourceType, url: ctx.url, title: ctx.subject, context: ctx.sender, from: ctx.sender || undefined, cc: ctx.cc?.length ? ctx.cc : undefined, attachments: ctx.attachments },
        timeline: ctx.timeline || [],
      }),
    })
    if (!res.ok) throw new Error()
    const saved = await res.json()
    close()
    showToast('Task captured ✓')
    suggestLinks(saved.id)
  } catch {
    btn.disabled = false
    btn.textContent = 'Track It'
    btn.style.background = 'rgba(239,68,68,0.5)'
    setTimeout(() => { btn.style.background = '' }, 1200)
  }
}

// ── Link suggestions ──────────────────────────────────────────────────────────

async function suggestLinks(taskId) {
  await new Promise(r => setTimeout(r, 800))
  let suggestions
  try {
    const res = await fetch(apiUrl(`/suggest-links`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    })
    suggestions = await res.json()
  } catch { return }
  if (!suggestions?.length) return

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = CSS
  shadow.appendChild(style)

  const panel = document.createElement('div')
  panel.className = 'link-panel'
  panel.innerHTML = `
    <div class="link-panel-header">
      <div>
        <div class="link-panel-title">🔗 Related tasks found</div>
        <div class="link-panel-sub">Claude found ${suggestions.length} task${suggestions.length > 1 ? 's' : ''} that may be linked</div>
      </div>
      <button class="link-dismiss" id="lp-dismiss">×</button>
    </div>
    ${suggestions.map(s => `
      <div class="link-item">
        <div class="link-item-text">
          <div class="link-item-title" title="${esc(s.title)}">${esc(s.title)}</div>
          <div class="link-item-reason">${esc(s.reason)}</div>
        </div>
        <button class="link-btn" data-related="${esc(s.id)}">Link</button>
      </div>
    `).join('')}
  `
  shadow.appendChild(panel)
  document.body.appendChild(el)

  panel.querySelector('#lp-dismiss').addEventListener('click', () => el.remove())

  panel.querySelectorAll('.link-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const relatedId = btn.dataset.related
      btn.textContent = '…'; btn.disabled = true
      try {
        await fetch(apiUrl(`/link`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, relatedId }),
        })
        btn.textContent = 'Linked ✓'
        btn.className = 'link-btn linked'
      } catch {
        btn.textContent = 'Link'; btn.disabled = false
      }
    })
  })

  setTimeout(() => el.remove(), 12000)
}

// ── Setup modal (first run / no key) ─────────────────────────────────────────

const SETUP_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .setup-backdrop {
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(14px) saturate(140%);
    -webkit-backdrop-filter: blur(14px) saturate(140%);
    display: flex; align-items: flex-start; justify-content: center;
    padding-top: 14vh;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .setup-card {
    width: 480px; max-width: calc(100vw - 32px);
    background: linear-gradient(160deg, rgba(28,24,44,0.92) 0%, rgba(16,14,26,0.96) 100%);
    backdrop-filter: blur(48px);
    -webkit-backdrop-filter: blur(48px);
    border: 0.5px solid rgba(255,255,255,0.13);
    border-radius: 20px;
    box-shadow: 0 24px 80px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.1);
    padding: 32px 28px 24px;
    animation: glassIn 0.22s cubic-bezier(0.32,1.2,0.64,1);
  }
  @keyframes glassIn {
    from { opacity: 0; transform: scale(0.94) translateY(-12px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  .setup-icon { font-size: 28px; margin-bottom: 14px; }
  .setup-title { color: rgba(255,255,255,0.92); font-size: 18px; font-weight: 600; margin-bottom: 8px; }
  .setup-sub {
    color: rgba(255,255,255,0.4); font-size: 13px; line-height: 1.6; margin-bottom: 20px;
  }
  .setup-sub a { color: rgba(160,150,255,0.85); text-decoration: none; }
  .setup-sub a:hover { text-decoration: underline; }
  .setup-label { color: rgba(255,255,255,0.35); font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 6px; display: block; }
  .setup-input {
    width: 100%; background: rgba(255,255,255,0.06); border: 0.5px solid rgba(255,255,255,0.13);
    border-radius: 10px; color: rgba(255,255,255,0.88); font-family: inherit;
    font-size: 14px; outline: none; padding: 10px 14px; margin-bottom: 12px;
    transition: border-color 0.15s;
  }
  .setup-input:focus { border-color: rgba(160,150,255,0.45); }
  .setup-input::placeholder { color: rgba(255,255,255,0.18); }
  .setup-row { display: flex; gap: 8px; margin-top: 4px; }
  .setup-btn-save {
    flex: 1;
    background: linear-gradient(135deg, rgba(140,126,255,0.9), rgba(108,92,231,0.95));
    border: 0.5px solid rgba(255,255,255,0.18); border-radius: 10px;
    color: rgba(255,255,255,0.96); cursor: pointer; font-family: inherit;
    font-size: 13px; font-weight: 600; padding: 9px 20px;
    box-shadow: 0 2px 8px rgba(108,92,231,0.4), inset 0 1px 0 rgba(255,255,255,0.18);
    transition: all 0.14s;
  }
  .setup-btn-save:hover { box-shadow: 0 4px 16px rgba(108,92,231,0.55); transform: translateY(-1px); }
  .setup-btn-cancel {
    background: rgba(255,255,255,0.06); border: 0.5px solid rgba(255,255,255,0.1);
    border-radius: 10px; color: rgba(255,255,255,0.4); cursor: pointer;
    font-family: inherit; font-size: 13px; padding: 9px 16px; transition: all 0.14s;
  }
  .setup-btn-cancel:hover { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.65); }
  .setup-error { color: rgba(248,113,113,0.9); font-size: 12px; margin-top: 6px; }
`

function buildSetupModal() {
  const backdrop = document.createElement('div')
  backdrop.className = 'setup-backdrop'

  const dashboardUrl = 'https://task-capture-dashboard.vercel.app'

  backdrop.innerHTML = `
    <div class="setup-card">
      <div class="setup-icon">✦</div>
      <div class="setup-title">Connect to your dashboard</div>
      <div class="setup-sub">
        Open your <a href="${dashboardUrl}" target="_blank">Task Dashboard</a>, click the ⚙ settings icon, and copy your workspace key. Then paste it below.<br><br>
        If you haven't set up a dashboard yet, <a href="${dashboardUrl}" target="_blank">create your workspace first</a>.
      </div>
      <label class="setup-label">Workspace key</label>
      <input class="setup-input" id="setup-key" placeholder="Paste your key here…" autocomplete="off" spellcheck="false" />
      <label class="setup-label">API URL</label>
      <input class="setup-input" id="setup-url" placeholder="https://your-api.railway.app" autocomplete="off" />
      <div class="setup-row">
        <button class="setup-btn-cancel" id="setup-cancel">Cancel</button>
        <button class="setup-btn-save" id="setup-save">Save & continue →</button>
      </div>
      <div class="setup-error" id="setup-error" style="display:none"></div>
    </div>
  `

  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove() })
  backdrop.querySelector('#setup-cancel').addEventListener('click', () => backdrop.remove())
  backdrop.querySelector('#setup-save').addEventListener('click', async () => {
    const key = backdrop.querySelector('#setup-key').value.trim()
    const url = backdrop.querySelector('#setup-url').value.trim().replace(/\/$/, '')
    const errEl = backdrop.querySelector('#setup-error')
    if (!key) { errEl.textContent = 'Please enter your workspace key.'; errEl.style.display = 'block'; return }
    if (!url) { errEl.textContent = 'Please enter the API URL.'; errEl.style.display = 'block'; return }
    errEl.style.display = 'none'
    await chrome.storage.sync.set({ taskApiUrl: url, taskUserKey: key })
    _cfg = { apiUrl: url, userKey: key }
    backdrop.remove()
    open()
  })

  // Pre-fill URL if already saved
  chrome.storage.sync.get(['taskApiUrl'], r => {
    if (r.taskApiUrl) backdrop.querySelector('#setup-url').value = r.taskApiUrl
  })

  return backdrop
}

function open() {
  if (root) return
  root = document.createElement('div')
  root.id = ROOT_ID
  const shadow = root.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = CSS
  shadow.appendChild(style)
  shadow.appendChild(buildOverlay(getContext()))
  document.body.appendChild(root)
}

function close() {
  root?.remove()
  root = null
}

function showToast(msg) {
  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = CSS
  shadow.appendChild(style)
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  shadow.appendChild(t)
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2500)
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type !== 'TOGGLE_OVERLAY') return
  if (root) { close(); return }
  // Load config then decide what to show
  chrome.storage.sync.get(['taskApiUrl', 'taskUserKey'], cfg => {
    if (cfg.taskApiUrl && cfg.taskUserKey) {
      _cfg = { apiUrl: cfg.taskApiUrl, userKey: cfg.taskUserKey }
      open()
    } else {
      // Show setup modal (not in shadow DOM — needs link clicks to work)
      const existing = document.getElementById('__task-setup__')
      if (existing) { existing.remove(); return }
      const wrapper = document.createElement('div')
      wrapper.id = '__task-setup__'
      const shadow = wrapper.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent = SETUP_CSS
      shadow.appendChild(style)
      shadow.appendChild(buildSetupModal())
      document.body.appendChild(wrapper)
    }
  })
})
