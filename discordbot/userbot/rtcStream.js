import { spawn } from 'child_process'
import { Streamer, playStream } from '@dank074/discord-video-stream'
import { PassThrough } from 'stream'
import { state } from './overlayState.js'
import ffmpegStatic from 'ffmpeg-static'

let streamer   = null
let videoLoop  = null
let ffmpegProc = null

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

    console.log('[RTC] Preparing ffmpeg manual spawn...')

    const ffmpegBin = ffmpegStatic || 'ffmpeg'
    const songUrl   = state?.currentSong?.url ?? null
    const hasAudio  = !!songUrl

    // ── Build args ────────────────────────────────────────────────────────
    // Input 0 = raw RGBA dari stdin (pipe:0)
    const args = [
      // Video input dari stdin
      '-f',          'rawvideo',
      '-pix_fmt',    'rgba',
      '-video_size', '1280x720',
      '-framerate',  '30',
      '-i',          'pipe:0',
    ]

    // Input 1 = audio dari URL lagu (opsional)
    if (hasAudio) {
      args.push(
        '-reconnect',           '1',
        '-reconnect_streamed',  '1',
        '-reconnect_delay_max', '5',
        '-i', songUrl,
      )
    }

    // Video encode
    args.push(
      '-map',        '0:v',
      '-c:v',        'libx264',
      '-preset',     'ultrafast',
      '-tune',       'zerolatency',
      '-pix_fmt',    'yuv420p',
      '-b:v',        '3000k',
      '-maxrate',    '5000k',
      '-bufsize',    '6000k',
      '-g',          '60',
      '-keyint_min', '60',
      '-r',          '30',
    )

    // Audio encode (opsional)
    if (hasAudio) {
      args.push(
        '-map',  '1:a',
        '-c:a',  'libopus',
        '-b:a',  '128k',
        '-ar',   '48000',
        '-ac',   '2',
      )
    }

    // Output ke stdout sebagai mpegts
    args.push('-f', 'mpegts', 'pipe:1')

    ffmpegProc = spawn(ffmpegBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // ── Event handlers ────────────────────────────────────────────────────

    // Tangkap EPIPE di stdin — jangan biarkan jadi unhandled crash
    ffmpegProc.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE') {
        console.error('[RTC] stdin error:', err.message)
      }
    })

    ffmpegProc.stderr.on('data', (d) => {
      const line = d.toString()
      // Hanya log baris yang mengandung error fatal, bukan INFO biasa
      if (/error|invalid|no such|failed/i.test(line) && !/^\s*$/.test(line)) {
        console.error('[RTC][ffmpeg]', line.trim().slice(0, 300))
      }
    })

    ffmpegProc.on('error', (err) => {
      console.error('[RTC] FFmpeg spawn error:', err.message)
    })

    ffmpegProc.on('exit', (code, signal) => {
      console.log(`[RTC] FFmpeg exited code=${code} signal=${signal}`)
      _cleanup(false) // false = jangan panggil leaveVoice lagi dari sini
    })

    // ── Pass stdout → Discord ─────────────────────────────────────────────
    playStream(ffmpegProc.stdout, streamer, { type: 'go-live' }).catch((err) => {
      // "stream ended" / "aborted" itu normal saat stop dipanggil
      const msg = err?.message ?? ''
      if (!msg.includes('ended') && !msg.includes('abort')) {
        console.error('[RTC] playStream error:', msg)
      }
    })

    // ── Frame loop ────────────────────────────────────────────────────────
    const frameDelay = Math.floor(1000 / 30)
    let isWriting = false

    videoLoop = setInterval(async () => {
      if (isWriting) return
      if (!ffmpegProc || ffmpegProc.killed || ffmpegProc.stdin.destroyed) return
      isWriting = true
      try {
        const rgba = await getFrameFn()
        // Validasi ukuran: 1280 × 720 × 4 bytes = 3686400
        if (!rgba || rgba.length !== 3686400) return
        ffmpegProc.stdin.write(rgba)
      } catch (e) {
        if (e.code !== 'EPIPE') console.error('[RTC] Frame error:', e.message)
      } finally {
        isWriting = false
      }
    }, frameDelay)

    if (hasAudio) {
      console.log('[RTC] ✅ Screen share started with audio')
    } else {
      console.log('[RTC] ✅ Screen share started (no active song, video only)')
    }

  } catch (e) {
    console.error('[RTC] Fatal error in startVideoStream:', e)
    _cleanup(true)
  }
}

export function stopVideoStream() {
  _cleanup(true)
  console.log('[RTC] 🛑 Video stream stopped')
}

// ── Internal cleanup ──────────────────────────────────────────────────────
function _cleanup(leaveVoice = true) {
  if (videoLoop) {
    clearInterval(videoLoop)
    videoLoop = null
  }

  if (ffmpegProc) {
    try {
      if (!ffmpegProc.stdin.destroyed) ffmpegProc.stdin.destroy()
      if (!ffmpegProc.killed)          ffmpegProc.kill('SIGKILL')
    } catch (_) { /* abaikan */ }
    ffmpegProc = null
  }

  if (streamer && leaveVoice) {
    try { streamer.stopStream() } catch (_) {}
    try { streamer.leaveVoice() } catch (_) {}
  }
}
