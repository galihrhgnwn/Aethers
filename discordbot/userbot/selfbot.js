import { Client } from 'discord.js-selfbot-v13'
import { startPolling, stopPolling } from './statePoller.js'
import { renderFrame, initRenderer } from './canvasRenderer.js'
import { startVideoStream, stopVideoStream, initStreamer } from './rtcStream.js'
import { state } from './overlayState.js'

let selfClient = null
let presenceLoop = null

export async function startUserbot({ token, guildId }) {
  if (selfClient) {
    console.warn('[Userbot] Already running')
    return
  }

  await initRenderer()

  selfClient = new Client({ checkUpdate: false })
  initStreamer(selfClient)

  selfClient.on('ready', async () => {
    console.log(`[Userbot] Logged in as ${selfClient.user.tag}`)
    
    startPolling(guildId)
    
    let currentlyConnectedChannelId = null
    let isProcessing = false;

    // Monitoring loop for voice presence mirroring
    presenceLoop = setInterval(async () => {
      if (isProcessing) return;
      isProcessing = true;
      
      try {
        const targetVoiceId = state.voiceChannelId
        
        // If we need to connect to a new channel
        if (targetVoiceId && targetVoiceId !== currentlyConnectedChannelId) {
          console.log(`[Userbot] Bot joining target voice channel: ${targetVoiceId}...`)
          
          try {
            // Restart stream to new voice channel
            stopVideoStream() // Just in case it's currently running
            
            await startVideoStream(guildId, targetVoiceId, async () => {
              return await renderFrame(state)
            })
            currentlyConnectedChannelId = targetVoiceId
          } catch (e) {
            console.error('[Userbot] Stream error:', e.message)
            currentlyConnectedChannelId = null // Allow it to retry next tick
          }
        }
        // If we need to disconnect
        else if (!targetVoiceId && currentlyConnectedChannelId) {
          console.log(`[Userbot] Bot left voice channel, following...`)
          stopVideoStream()
          
          try {
            const guild = selfClient.guilds.cache.get(guildId)
            if (guild?.members?.me?.voice?.disconnect) {
              guild.members.me.voice.disconnect()
            }
          } catch (e) {
            console.error('[Userbot] Disconnect error:', e)
          }
          
          currentlyConnectedChannelId = null
        }
      } finally {
        isProcessing = false;
      }
    }, 1000)
  })
  
  selfClient.on('error', (err) => {
    console.error('[Userbot] Client Error:', err)
  })

  selfClient.on('messageCreate', async (message) => {
    if (!message.content.startsWith('/userbot')) return
    
    const args = message.content.split(' ')
    const sub = args[1]
    
    if (sub === 'screenshare') {
      const guild = selfClient.guilds.cache.get(guildId)
      const channelId = guild?.me?.voice?.channelId
      
      if (!channelId) {
        await message.reply('❌ Userbot belum di voice channel')
        return
      }
      
      try {
        stopVideoStream()
        await new Promise(r => setTimeout(r, 1000))
        await startVideoStream(guildId, channelId, async () => {
          return await renderFrame(state)
        })
        await message.reply('✅ Screen share dimulai')
      } catch (e) {
        await message.reply('❌ Gagal: ' + e.message)
      }
    }

    if (sub === 'joinvc') {
      const guild = selfClient.guilds.cache.get(guildId)
      if (!guild) return

      const member = guild.members.cache.get(message.author.id)
      const targetChannelId = member?.voice?.channelId
      const targetChannelName = member?.voice?.channel?.name

      if (!targetChannelId) {
        await message.reply('❌ Kamu harus berada di voice channel terlebih dahulu.')
        return
      }

      try {
        stopVideoStream()
        await new Promise(r => setTimeout(r, 500))
        await startVideoStream(guildId, targetChannelId, async () => {
          return await renderFrame(state)
        })
        await message.reply(`✅ Userbot bergabung ke **${targetChannelName}** dan memulai screen share.`)
      } catch (e) {
        await message.reply('❌ Gagal bergabung: ' + e.message)
      }
    }
    
    if (sub === 'stop') {
      stopVideoStream()
      await message.reply('🛑 Screen share dihentikan')
    }
    
    if (sub === 'status') {
      const guild = selfClient.guilds.cache.get(guildId)
      const voiceChannelId = guild?.me?.voice?.channelId
      await message.reply(
        voiceChannelId
          ? '✅ Userbot di channel: ' + voiceChannelId
          : '❌ Userbot tidak di voice channel'
      )
    }
  })

  try {
    await selfClient.login(token)
  } catch (e) {
    console.error('[Userbot] Failed to login:', e.message)
    selfClient = null
  }
}

export async function stopUserbot() {
  if (selfClient) {
    stopPolling()
    if (presenceLoop) {
      clearInterval(presenceLoop)
      presenceLoop = null
    }
    stopVideoStream()
    selfClient.destroy()
    selfClient = null
    console.log('[Userbot] Stopped')
  }
}
