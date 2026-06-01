import { state } from './overlayState.js'

let pollInterval = null

export function startPolling(guildId) {
  if (pollInterval) clearInterval(pollInterval)
  state.guildId = guildId

  const port = process.env.PORT || 3000

  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`http://localhost:${port}/api/userbot-state?guildId=${guildId}`)
      if (!res.ok) return
      
      const data = await res.json()
      
      // Update state
      state.currentSong = data.currentSong || null
      state.queue = data.queue || []
      state.elapsed = data.elapsed || 0
      state.isLooping = data.isLooping || false
      state.isAutoplay = data.isAutoplay || false
      state.playerStatus = data.playerStatus || 'disconnected'
      state.voiceChannelId = data.voiceChannelId || null
      state.lastUpdated = Date.now()
    } catch (e) {
      // Silent fail, just retry next second
    }
  }, 1000)
}

export function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}
