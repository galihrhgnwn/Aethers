import { Streamer, playStream, prepareStream, Utils, Encoders } from '@dank074/discord-video-stream'
import { PassThrough } from 'stream'

let streamer = null
let videoLoop = null
let inputStream = null
let currentGuildId = null
let currentChannelId = null

export function initStreamer(client) {
  if (!streamer) {
    streamer = new Streamer(client)
    console.log('[RTC] Streamer initialized')
  }
}

export async function startVideoStream(guildId, channelId, getFrameFn) {
  try {
    if (!streamer) {
      throw new Error('Streamer not initialized')
    }
    
    console.log(`[RTC] Joining voice: guild=${guildId}, channel=${channelId}`)
    await streamer.joinVoice(guildId, channelId)
    
    currentGuildId = guildId
    currentChannelId = channelId

    // Tunggu koneksi UDP stabil (2 detik)
    await new Promise(resolve => setTimeout(resolve, 2000))

    console.log('[RTC] Creating stream & preparing ffmpeg...')
    
    inputStream = new PassThrough()

    const { command, output } = prepareStream(inputStream, {
      encoder: Encoders.software({ x264: { preset: 'ultrafast' } }),
      width: 1280,
      height: 720,
      frameRate: 30,
      bitrateVideo: 3000,
      bitrateVideoMax: 5000,
      videoCodec: Utils.normalizeVideoCodec('H264'),
      customInputOptions: [
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba', 
        '-video_size', '1280x720',
        '-framerate', '30'
      ]
    })
    
    command.on('error', (err) => {
      console.error('[RTC] FFmpeg command error:', err)
    })

    // Play to Discord
    playStream(output, streamer, { type: 'go-live' }).catch(err => {
      console.error('[RTC] playStream error:', err)
    })
    
    const frameDelay = Math.floor(1000 / 30) // 30fps
    let isWriting = false
    
    videoLoop = setInterval(async () => {
      if (isWriting) return
      isWriting = true
      try {
        const rgbaBuffer = await getFrameFn()
        
        if (!rgbaBuffer || rgbaBuffer.length !== 1280 * 720 * 4) {
          // Skip invalid frames
          return
        }
        
        if (inputStream && !inputStream.writableEnded) {
          inputStream.write(rgbaBuffer)
        }
      } catch (e) {
        console.error('[RTC] Frame render error', e)
      } finally {
        isWriting = false
      }
    }, frameDelay)
    
    console.log('[RTC] ✅ Screen share started')
  } catch (e) {
    console.error('[RTC] Fatal error in startVideoStream:', e)
  }
}

export function stopVideoStream() {
  if (videoLoop) {
    clearInterval(videoLoop)
    videoLoop = null
  }
  
  if (inputStream && !inputStream.writableEnded) {
    inputStream.end()
  }
  inputStream = null

  if (streamer) {
    try {
      streamer.stopStream()
      streamer.leaveVoice()
    } catch (e) {
      console.error('[RTC] Failed to leave voice gracefully:', e)
    }
  }

  currentGuildId = null
  currentChannelId = null

  console.log('[RTC] 🛑 Video stream stopped')
}
