import { spawn } from 'child_process'
import { Streamer, playStream } from '@dank074/discord-video-stream'
import { PassThrough } from 'stream'
import { state } from './overlayState.js'
import ffmpegPath from 'ffmpeg-static'

let streamer    = null
let videoLoop   = null
let ffmpegProc  = null
let videoStream = null  // PassThrough untuk RGBA frames → ffmpeg stdin

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

    // Tunggu UDP stabil
    await new Promise(r => setTimeout(r, 2000))

    console.log('[RTC] Spawning FFmpeg...')

    const ffmpeg = ffmpegPath || 'ffmpeg'
    const songUrl = state?.currentSong?.url || null

    // ── Build FFmpeg args ──────────────────────────────────────────────────
    //
    // Input 0 : raw RGBA frames dari stdin (pipe:0)
    // Input 1 : audio dari YouTube URL lagu aktif (opsional)
    // Output  : mpegts ke stdout (pipe:1)
    //
    const args = []

    // Video input
    args.push(
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-video_size', '1280x720',
      '-framerate', '30',
      '-i', 'pipe:0'
    )

    // Audio input (opsional — ambil dari URL lagu yang sedang diputar)
    const hasAudio = !!songUrl
    if (hasAudio) {
      args.push('-reconnect', '1', '-reconnect_streamed', '1',
                '-reconnect_delay_max', '5', '-i', songUrl)
    }

    // Video encode
    args.push(
      '-map', '0:v',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-b:v', '3000k',
      '-maxrate', '5000k',
      '-bufsize', '6000k',
      '-g', '60',
      '-keyint_min', '60',
      '-r', '30'
    )

    // Audio encode (opsional)
    if (hasAudio) {
      args.push(
        '-map', '1:a',
        '-c:a', 'libopus',
        '-b:a', '128k',
        '-ar', '48000',
        '-ac', '2'
      )
    }

    // Output ke stdout sebagai mpegts
    args.push('-f', 'mpegts', 'pipe:1')

    ffmpegProc = spawn(ffmpeg, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // Log stderr FFmpeg (tapi jangan throw — banyak INFO noise normal)
    ffmpegProc.stderr.on('data', (d) => {
      const line = d.toString().trim()
      // Hanya log error fatal
      if (line.includes('Error') || line.includes('Invalid') || line.includes('No such')) {
        console.error('[RTC][ffmpeg]', line.slice(0, 200))
      }
    })

    ffmpegProc.on('error', (err) => {
      console.error('[RTC] FFmpeg spawn error:', err.message)
    })

    ffmpegProc.on('exit', (code, signal) => {
      console.log(`[RTC] FFmpeg exited: code=${code} signal=${signal}`)
      _cleanup()
    })

    // Handle EPIPE — FFmpeg mati duluan, abaikan write error
    ffmpegProc.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE') {
        console.error('[RTC] stdin error:', err.message)
      }
    })

    // Pass stdout FFmpeg → playStream Discord
    const outputStream = ffmpegProc.stdout
    playStream(outputStream, streamer, { type: 'go-live' }).catch(err => {
      // Abaikan error "stream ended" biasa
      if (!err.message?.includes('ended')) {
        console.error('[RTC] playStream error:', err.message)
      }
    })

    if (hasAudio) {
      console.log(`[RTC] Audio source: ${songUrl.slice(0, 60)}...`)
    } else {
      console.log('[RTC] No active song — video only')
    }

    // ── Frame loop ────────────────────────────────────────────────────────
    const frameDelay = Math.floor(1000 / 30)
    let isWriting = false

    videoLoop = setInterval(async () => {
      if (isWriting) return
      if (!ffmpegProc || ffmpegProc.killed) return
      isWriting = true
      try {
        const rgba = await getFrameFn()
        if (!rgba || rgba.length !== 1280 * 720 * 4) return
        if (!ffmpegProc.stdin.destroyed) {
          ffmpegProc.stdin.write(rgba)
        }
      } catch (e) {
        if (e.code !== 'EPIPE') console.error('[RTC] Frame error:', e.message)
      } finally {
        isWriting = false
      }
    }, frameDelay)

    console.log('[RTC] ✅ Screen share started' + (hasAudio ? ' with audio' : ''))

  } catch (e) {
    console.error('[RTC] Fatal error in startVideoStream:', e)
    _cleanup()
  }
}

export function stopVideoStream() {
  _cleanup()
  console.log('[RTC] 🛑 Video stream stopped')
}

function _cleanup() {
  if (videoLoop) {
    clearInterval(videoLoop)
    videoLoop = null
  }

  if (ffmpegProc) {
    try {
      if (!ffmpegProc.killed) {
        ffmpegProc.stdin?.destroy()
        ffmpegProc.kill('SIGKILL')
      }
    } catch (_) {}
    ffmpegProc = null
  }

  if (streamer) {
    try { streamer.stopStream() } catch (_) {}
    try { streamer.leaveVoice() } catch (_) {}
  }
}
