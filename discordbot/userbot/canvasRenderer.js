import { createCanvas, loadImage } from 'canvas'
import fetch from 'node-fetch'

const WIDTH = 1280
const HEIGHT = 720
const canvas = createCanvas(WIDTH, HEIGHT)
const ctx = canvas.getContext('2d')

// Cache image based on URL
const imageCache = new Map()

async function fetchThumbnail(url) {
  if (!url) return null
  if (imageCache.has(url)) return imageCache.get(url)
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('Bad response')
    const buffer = await res.arrayBuffer()
    const img = await loadImage(Buffer.from(buffer))
    imageCache.set(url, img)
    return img
  } catch (e) {
    console.warn(`[Renderer] Failed to load thumbnail: ${url}`)
    imageCache.set(url, null) // Cache failure so we don't spam fetch
    return null
  }
}

function formatDuration(seconds) {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function truncateString(str, num) {
  if (!str) return ''
  if (str.length <= num) return str
  return str.slice(0, num) + '...'
}

function fillRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fill()
}

function drawThumbnail(ctx, img, x, y, size, radius) {
  if (radius) {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + size - radius, y)
    ctx.quadraticCurveTo(x + size, y, x + size, y + radius)
    ctx.lineTo(x + size, y + size - radius)
    ctx.quadraticCurveTo(x + size, y + size, x + size - radius, y + size)
    ctx.lineTo(x + radius, y + size)
    ctx.quadraticCurveTo(x, y + size, x, y + size - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
    ctx.clip()
  }

  if (img) {
    // Fill bounds, maintaining aspect ratio roughly by drawing in center
    ctx.drawImage(img, x, y, size, size)
  } else {
    ctx.fillStyle = '#222222'
    ctx.fillRect(x, y, size, size)
  }

  if (radius) ctx.restore()
}

export async function initRenderer() {
  // Preload any local assets or fonts if needed here
  console.log('[Renderer] Initialized')
}

export async function renderFrame(state) {
  // Clear background
  ctx.fillStyle = '#0f0f0f'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  if (!state.currentSong && state.queue.length === 0) {
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 36px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('Nothing is playing right now', WIDTH / 2, HEIGHT / 2)
    return canvas.toBuffer('raw')
  }

  const { currentSong } = state

  // If there's a current song, we need to preload its thumbnail 
  // Normally we shouldn't await in a tight loop, so it's a bit tricky.
  // But we have a cache. The first frame might not have the image, 
  // but it will trigger the fetch.
  // To not block the frame generation, we just do a non-blocking fetch trigger and use what's in cache.
  if (currentSong && currentSong.thumbnail && !imageCache.has(currentSong.thumbnail)) {
    // Fire and forget
    fetchThumbnail(currentSong.thumbnail).catch(() => {})
  }

  // Draw current song details
  if (currentSong) {
    const thumbX = 100
    const thumbY = 100
    const thumbSize = 200

    const img = imageCache.get(currentSong.thumbnail)
    drawThumbnail(ctx, img, thumbX, thumbY, thumbSize, 12)

    const textX = thumbX + thumbSize + 40
    let currentY = thumbY + 30

    // Now playing label
    ctx.fillStyle = '#ff0000'
    ctx.font = 'bold 14px Arial'
    ctx.textAlign = 'left'
    ctx.fillText('🎵 NOW PLAYING', textX, currentY)
    currentY += 40

    // Title
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 28px Arial'
    ctx.fillText(truncateString(currentSong.title, 40), textX, currentY)
    currentY += 30

    // Requester
    ctx.fillStyle = '#aaaaaa'
    ctx.font = '14px Arial'
    ctx.fillText(`Requested by: ${currentSong.requester || 'Unknown'}`, textX, currentY)
    currentY += 50

    // Progress Bar
    const barWidth = 600
    const barHeight = 8
    
    // Background bar
    ctx.fillStyle = '#333333'
    ctx.fillRect(textX, currentY, barWidth, barHeight)

    // Filled bar
    let progressRatio = 0
    if (currentSong.duration && currentSong.duration > 0) {
      progressRatio = state.elapsed / currentSong.duration
      progressRatio = Math.max(0, Math.min(progressRatio, 1))
    }
    
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(textX, currentY, barWidth * progressRatio, barHeight)
    
    // Timestamps
    currentY += 25
    ctx.fillStyle = '#888888'
    ctx.font = '12px Arial'
    ctx.fillText(`${formatDuration(state.elapsed)} / ${formatDuration(currentSong.duration)}`, textX, currentY)
  }

  // Draw Separator
  const sepY = 400
  ctx.fillStyle = '#333333'
  ctx.fillRect(100, sepY, WIDTH - 200, 1)

  ctx.fillStyle = '#0f0f0f'
  const textWidth = 80
  ctx.fillRect((WIDTH / 2) - (textWidth / 2), sepY - 10, textWidth, 20)
  
  ctx.fillStyle = '#666666'
  ctx.font = '12px Arial'
  ctx.textAlign = 'center'
  ctx.fillText('UP NEXT', WIDTH / 2, sepY + 4)

  // Draw Queue Items
  const qStartX = 100
  let qStartY = sepY + 40
  const maxQueue = Math.min(state.queue.length, 3)

  ctx.textAlign = 'left'
  
  for (let i = 0; i < maxQueue; i++) {
    const item = state.queue[i]
    
    // Check thumbnail request
    if (item.thumbnail && !imageCache.has(item.thumbnail)) {
      fetchThumbnail(item.thumbnail).catch(() => {})
    }
    
    const thumbImg = imageCache.get(item.thumbnail)
    drawThumbnail(ctx, thumbImg, qStartX, qStartY, 60, 0)
    
    ctx.fillStyle = '#cccccc'
    ctx.font = '14px Arial'
    ctx.fillText(`${i + 1}. ${truncateString(item.title, 35)}`, qStartX + 80, qStartY + 35)

    qStartY += 80
  }

  if (state.queue.length > 3) {
    ctx.fillStyle = '#666666'
    ctx.font = '12px Arial'
    ctx.fillText(`+ ${state.queue.length - 3} more...`, qStartX + 80, qStartY + 10)
  }

  // Draw Footer Badges
  const badgeY = HEIGHT - 40
  let badgeX = 100

  if (state.isLooping) {
    ctx.fillStyle = '#ff000033'
    fillRoundRect(ctx, badgeX, badgeY - 15, 60, 22, 11)
    
    ctx.fillStyle = '#ff0000'
    ctx.font = 'bold 12px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('🔁 LOOP', badgeX + 30, badgeY)
    badgeX += 70
  }

  if (state.isAutoplay) {
    ctx.fillStyle = '#ff000033'
    fillRoundRect(ctx, badgeX, badgeY - 15, 96, 22, 11)
    
    ctx.fillStyle = '#ff0000'
    ctx.font = 'bold 12px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('✨ AUTOPLAY', badgeX + 48, badgeY)
  }

  ctx.fillStyle = '#444444'
  ctx.font = '11px Arial'
  ctx.textAlign = 'right'
  ctx.fillText('smusic bot', WIDTH - 100, HEIGHT - 20)

  // Return raw RGBA buffer
  return canvas.toBuffer('raw')
}
