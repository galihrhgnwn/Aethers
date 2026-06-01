import { Streamer, playStream } from '@dank074/discord-video-stream'
import { spawn } from 'child_process'
import { state } from './overlayState.js'

let streamer = null
let videoLoop = null
let ffmpegProcess = null
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
    if (!streamer) throw new Error('Streamer not initialized')
    
    console.log(`[RTC] Joining voice: guild=${guildId}, channel=${channelId}`)
    await streamer.joinVoice(guildId, channelId)
    
    currentGuildId = guildId
    currentChannelId = channelId

    // Tunggu koneksi UDP stabil (2 detik)
    await new Promise(resolve => setTimeout(resolve, 2000))

    console.log('[RTC] Preparing ffmpeg manual spawn...')
    
    const audioUrl = state.currentSong?.url
    const args = [
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-video_size', '1280x720',
      '-framerate', '30',
      '-i', 'pipe:0'
    ]

    // Jika ada lagu yang sedang diputar, tambahkan sebagai input audio
    const hasAudio = audioUrl && audioUrl.startsWith('http')
    if (hasAudio) {
      args.push('-i', audioUrl)
    }

    args.push(
      '-map', '0:v',
      ...(hasAudio ? ['-map', '1:a'] : []),
      '-vf', 'scale=1280:720',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-b:v', '3000k',
      '-maxrate', '5000k',
      '-bufsize', '6000k',
      '-g', '60',
      '-keyint_min', '60'
    )

    if (hasAudio) {
      args.push('-c:a', 'libopus', '-b:a', '128k')
    }

    args.push('-f', 'mpegts', 'pipe:1')

    ffmpegProcess = spawn('ffmpeg', args)

    ffmpegProcess.stderr.on('data', (data) => {
      const msg = data.toString()
      // Hanya log error atau info penting jika diperlukan untuk debugging
      if (msg.toLowerCase().includes('error')) {
        console.error('[RTC] FFmpeg stderr:', msg.trim())
      }
    })

    ffmpegProcess.on('error', (err) => {
      console.error('[RTC] FFmpeg process error:', err)
    })

    ffmpegProcess.on('close', (code) => {
      if (code !== null && code !== 0 && code !== 255) {
        console.log(`[RTC] FFmpeg process closed with code ${code}`)
      }
    })

    // Play to Discord menggunakan stdout ffmpeg
    playStream(ffmpegProcess.stdout, streamer, { type: 'go-live' }).catch(err => {
      console.error('[RTC] playStream error:', err)
    })
    
    const frameDelay = Math.floor(1000 / 30) // 30fps
    let isWriting = false
    
    videoLoop = setInterval(async () => {
      if (isWriting) return
      if (!ffmpegProcess || !ffmpegProcess.stdin || ffmpegProcess.stdin.writableEnded) return

      isWriting = true
      try {
        const rgbaBuffer = await getFrameFn()
        
        if (rgbaBuffer && rgbaBuffer.length === 1280 * 720 * 4) {
          ffmpegProcess.stdin.write(rgbaBuffer)
        }
      } catch (e) {
        console.error('[RTC] Frame render error', e)
      } finally {
        isWriting = false
      }
    }, frameDelay)
    
    console.log('[RTC] ✅ Screen share started' + (hasAudio ? ' with audio' : ''))
  } catch (e) {
    console.error('[RTC] Fatal error in startVideoStream:', e)
  }
}

export function stopVideoStream() {
  if (videoLoop) {
    clearInterval(videoLoop)
    videoLoop = null
  }
  
  if (ffmpegProcess) {
    try {
      if (!ffmpegProcess.stdin.writableEnded) {
        ffmpegProcess.stdin.end()
      }
      ffmpegProcess.kill('SIGKILL')
    } catch (e) {
      console.error('[RTC] Error killing ffmpeg:', e)
    }
    ffmpegProcess = null
  }

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
