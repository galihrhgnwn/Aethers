export const state = {
  guildId: null,           // string
  voiceChannelId: null,    // string
  currentSong: null,       // Song object atau null
  queue: [],               // array Song object (index 0 = current, 1,2,3 = next)
  elapsed: 0,              // detik, progress lagu saat ini
  isLooping: false,
  isAutoplay: false,
  playerStatus: 'idle',    // 'playing' | 'paused' | 'idle' | 'disconnected'
  lastUpdated: 0,          // Date.now()
}
