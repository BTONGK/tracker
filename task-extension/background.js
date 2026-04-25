async function triggerOverlay() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' }).catch(() => {})
}

// Toolbar icon click
chrome.action.onClicked.addListener(triggerOverlay)

// Keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-overlay') triggerOverlay()
})
