import 'dotenv/config'
import { startUserbot } from './selfbot.js'

const {
  USERBOT_TOKEN,
  USERBOT_GUILD_ID,
} = process.env

if (!USERBOT_TOKEN || !USERBOT_GUILD_ID) {
  console.error('[Userbot] Missing required env vars: USERBOT_TOKEN, USERBOT_GUILD_ID')
  process.exit(1)
}

// Start userbot
startUserbot({
  token: USERBOT_TOKEN,
  guildId: USERBOT_GUILD_ID,
})
