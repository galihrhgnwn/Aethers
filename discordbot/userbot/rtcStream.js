import { spawn } from 'child_process'
import { Streamer, playStream } from '@dank074/discord-video-stream'
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

    await new Promise(r => setTimeout(r, 2000))

    console.log('[RTC] Preparing ffmpeg manual spawn...')

    const ffmpegBin = ffmpegStatic || 'ffmpeg'
    const songUrl   = state?.currentSong?.url ?? null
    const hasAudio  = !!songUrl

    const args = [
      '-f',          'rawvideo',
      '-pix_fmt',    'rgba',
      '-video_size', '1280x720',
      '-framerate',  '30',
      '-i',          'pipe:0',
    ]

    if (hasAudio) {
      args.push(
        '-reconnect',           '1',
        '-reconnect_streamed',  '1',
        '-reconnect_delay_max', '5',
        '-i', songUrl,
      )
    }

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

    if (hasAudio) {
      args.push(
        '-map',  '1:a',
        '-c:a',  'libopus',
        '-b:a',  '128k',
        '-ar',   '48000',
        '-ac',   '2',
      )
    }

    args.push('-f', 'mpegts', 'pipe:1')

    ffmpegProc = spawn(ffmpegBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    ffmpegProc.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE') {
        console.error('[RTC] stdin error:', err.message)
      }
    })

    ffmpegProc.stderr.on('data', (d) => {
      const line = d.toString()
      if (/error|invalid|no such|failed/i.test(line) && !/^\s*$/.test(line)) {
        console.error('[RTC][ffmpeg]', line.trim().slice(0, 300))
      }
    })

    ffmpegProc.on('error', (err) => {
      console.error('[RTC] FFmpeg spawn error:', err.message)
    })

    ffmpegProc.on('exit', (code, signal) => {
      console.log(`[RTC] FFmpeg exited code=${code} signal=${signal}`)
      _cleanup(false)
    })

    playStream(ffmpegProc.stdout, streamer, { type: 'go-live' }).catch((err) => {
      const msg = err?.message ?? ''
      if (!msg.includes('ended') && !msg.includes('abort')) {
        console.error('[RTC] playStream error:', msg)
      }
    })

    const frameDelay = Math.floor(1000 / 30)
    let isWriting = false

    videoLoop = setInterval(async () => {
      if (isWriting) return
      if (!ffmpegProc || ffmpegProc.killed || ffmpegProc.stdin.destroyed) return
      isWriting = true
      try {
        const rgba = await getFrameFn()
        if (!rgba || rgba.length !== 3686400) return
        ffmpegProc.stdin.write(rgba)
      } catch (e) {
        if (e.code !== 'EPIPE') console.error('[RTC] Frame error:', e.message)
      } finally {
        isWriting = false
      }
    }, frameDelay)

    console.log(hasAudio ? '[RTC] ✅ Screen share started with audio' : '[RTC] ✅ Screen share started (video only)')

  } catch (e) {
    console.error('[RTC] Fatal error in startVideoStream:', e)
    _cleanup(true)
  }
}

export function stopVideoStream() {
  _cleanup(true)
  console.log('[RTC] 🛑 Video stream stopped')
}

function _cleanup(leaveVoice = true) {
  if (videoLoop) {
    clearInterval(videoLoop)
    videoLoop = null
  }

  if (ffmpegProc) {
    try {
      if (!ffmpegProc.stdin.destroyed) ffmpegProc.stdin.destroy()
      if (!ffmpegProc.killed)          ffmpegProc.kill('SIGKILL')
    } catch (_) {}
    ffmpegProc = null
  }

  if (streamer && leaveVoice) {
    try { streamer.stopStream() } catch (_) {}
    try { streamer.leaveVoice() } catch (_) {}
  }
}
