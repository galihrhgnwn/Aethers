import { getUserSession, isUserLoggedIn } from '../core/userSessionManager.js'
import { addToQueue, getQueue } from '../core/queue.js'
import { getConfig } from '../utils/serverConfig.js'
import { playSong, getPlayerState } from '../core/player.js'
import { infoEmbed, errorEmbed, formatDuration } from '../utils/embeds.js'
import {
  EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ButtonBuilder, ButtonStyle
} from 'discord.js'
import { userInVoice } from '../utils/checkPermissions.js'
import * as serverPlaylistStore from '../utils/serverPlaylistStore.js'
import { searchSongs } from '../utils/searcher.js'
import { detectInputType } from '../utils/urlParser.js'
import { getVideoInfo } from '../core/downloader.js'

// Helper: require login
async function requireLogin(message) {
  const userId = message.author.id
  if (!isUserLoggedIn(userId)) {
    await message.reply({ embeds: [
      new EmbedBuilder()
        .setDescription(
          `❌ You need to connect your YouTube account first.\n` +
          `Run \`/smusic auth login\` to get started.`
        )
        .setColor(0xFF0000)
        .setFooter({ text: 'smusic bot' })
    ] })
    return false
  }
  return true
}

export async function handlePlaylist(message, args) {
  const sub = args[0]?.toLowerCase()
  const userId = message.author.id
  const guildId = message.guild.id

  switch (sub) {
    case 'list':
    case undefined:
      return handlePlaylistList(message, userId)

    case 'play':
      return handlePlaylistPlay(message, userId, args.slice(1).join(' '))

    case 'search':
      return handlePlaylistSearch(message, userId, args.slice(1).join(' '))

    case 'create':
      return handlePlaylistCreate(message, guildId, args.slice(1).join(' '))

    case 'add':
      return handlePlaylistAdd(message, guildId, args.slice(1))

    case 'remove':
      return handlePlaylistRemove(message, guildId, args.slice(1))

    case 'delete':
      return handlePlaylistDelete(message, guildId, args.slice(1).join(' '))

    case 'view':
      return handlePlaylistView(message, guildId, args.slice(1).join(' '))

    default:
      return message.reply({ embeds: [errorEmbed(
        'Usage:\n' +
        ' `/smusic playlist create <name>`\n' +
        ' `/smusic playlist add <name> <query>`\n' +
        ' `/smusic playlist remove <name> <number>`\n' +
        ' `/smusic playlist delete <name>`\n' +
        ' `/smusic playlist view <name>`\n' +
        ' `/smusic playlist list`'
      )] })
  }
}

async function fetchUserPlaylists(yt) {
  try {
    // Coba getLibraryPlaylists dulu (lebih ringan)
    const result = await yt.music.getLibraryPlaylists()
    const contents = result?.contents || []

    return contents
      .filter(p => p && (p.id || p.playlist_id))
      .slice(0, 50) // batasi 50 playlist
      .map(p => ({
        id: p.id || p.playlist_id || '',
        title: (() => {
          if (typeof p.title === 'string') return p.title
          if (p.title?.text) return p.title.text
          if (p.title?.runs) return p.title.runs.map(r => r.text).join('')
          return 'Unknown Playlist'
        })(),
        subtitle: {
          text: (() => {
            if (typeof p.subtitle === 'string') return p.subtitle
            if (p.subtitle?.text) return p.subtitle.text
            if (p.subtitle?.runs) return p.subtitle.runs.map(r => r.text).join('')
            if (p.song_count) return `${p.song_count} songs`
            if (p.item_count) return `${p.item_count} songs`
            return ''
          })()
        }
      }))
      .filter(p => p.id && p.title)

  } catch (e) {
    console.error('[Playlist] fetchUserPlaylists error:', e.message)

    // Fallback: coba getLibrary biasa
    try {
      const library = await yt.music.getLibrary()
      const items = []

      // Safely iterate contents
      if (library?.contents && Array.isArray(library.contents)) {
        for (const section of library.contents) {
          const sectionItems = section?.contents || section?.items || []
          if (Array.isArray(sectionItems)) {
            items.push(...sectionItems)
          }
        }
      }

      return items
        .filter(i => i && (i.id || i.playlist_id))
        .slice(0, 50)
        .map(i => ({
          id: i.id || i.playlist_id || '',
          title: i.title?.text || i.title || i.name || 'Unknown',
          subtitle: { text: i.subtitle?.text || i.item_count || '' }
        }))
        .filter(p => p.id)

    } catch (e2) {
      console.error('[Playlist] Fallback also failed:', e2.message)
      throw new Error(`Cannot fetch playlists: ${e2.message}`)
    }
  }
}

// /smusic playlist / /smusic playlist list
async function handlePlaylistList(message, userId) {
  const guildId = message.guild.id
  const serverPlaylists = serverPlaylistStore.getGuildPlaylists(guildId)
  const serverPlaylistNames = Object.keys(serverPlaylists)

  const serverDesc = serverPlaylistNames.length
    ? serverPlaylistNames.map(name => {
        const pl = serverPlaylists[name]
        return `**${pl.name}** — ${pl.songs.length} lagu — dibuat oleh <@${pl.createdBy}>`
      }).join('\n')
    : '_Belum ada playlist server._'

  const embed = new EmbedBuilder()
    .setTitle('📋 Playlists')
    .setColor(0xFF0000)
    .addFields({ name: '📁 Server Playlists', value: serverDesc })

  let youtubePlaylists = []
  let youtubeError = null
  const loggedIn = isUserLoggedIn(userId)

  if (loggedIn) {
    try {
      const yt = await getUserSession(userId)
      youtubePlaylists = await fetchUserPlaylists(yt)
    } catch (e) {
      youtubeError = e.message
    }
  }

  if (loggedIn) {
    const ytDesc = youtubePlaylists.length
      ? youtubePlaylists.slice(0, 15).map((p, i) => `**${i + 1}.** ${p.title} (${p.subtitle?.text || '? songs'})`).join('\n')
      : youtubeError ? `❌ Error: ${youtubeError}` : '_Tidak ada playlist di library._'

    embed.addFields({ name: '📺 YouTube Playlists', value: ytDesc })
  }

  // Select menu for both if available
  const options = []

  // Add server playlists to options
  serverPlaylistNames.slice(0, 10).forEach(name => {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(`Server: ${name}`.slice(0, 100))
        .setValue(`server_${name}`)
    )
  })

  // Add YT playlists to options
  youtubePlaylists.slice(0, 25 - options.length).forEach(p => {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(`YT: ${p.title}`.slice(0, 100))
        .setDescription(p.subtitle?.text?.slice(0, 100) || '')
        .setValue(`yt_${p.id}`)
    )
  })

  if (options.length) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('playlist_pick_combined')
      .setPlaceholder('Pilih playlist untuk diputar')
      .addOptions(options)

    const row = new ActionRowBuilder().addComponents(selectMenu)
    const reply = await message.reply({ embeds: [embed], components: [row] })

    const collector = reply.createMessageComponentCollector({
      filter: i => i.user.id === message.author.id && i.customId === 'playlist_pick_combined',
      time: 60_000,
      max: 1
    })

    collector.on('collect', async interaction => {
      await interaction.deferUpdate()
      const val = interaction.values[0]
      if (val.startsWith('server_')) {
        const name = val.replace('server_', '')
        await handleServerPlaylistPlay(message, name, reply)
      } else {
        const playlistId = val.replace('yt_', '')
        await loadAndQueuePlaylist(message, userId, playlistId, null, reply)
      }
    })

    collector.on('end', (_, reason) => {
      if (reason === 'time') reply.edit({ components: [] }).catch(() => {})
    })
  } else {
    await message.reply({ embeds: [embed] })
  }
}

// /smusic playlist play <nama atau ID>
async function handlePlaylistPlay(message, userId, query) {
  if (!userInVoice(message)) {
    return message.reply({ embeds: [errorEmbed('Join a voice channel first')] })
  }
  if (!query) {
    return message.reply({ embeds: [errorEmbed('Provide a playlist name. Usage: `/smusic playlist play <nama>`')] })
  }

  // Fallback check: Server playlist first
  const serverPl = serverPlaylistStore.getPlaylist(message.guild.id, query)
  if (serverPl) {
    return handleServerPlaylistPlay(message, serverPl.name)
  }

  // If not found in server playlists, try YouTube library (requires login)
  if (!isUserLoggedIn(userId)) {
    return message.reply({ embeds: [errorEmbed(
      `Playlist **${query}** tidak ditemukan di server.\n` +
      `Jika ini playlist YouTube Music kamu, silakan login dengan \`/smusic auth login\`.`
    )] })
  }

  const loading = await message.reply({ embeds: [infoEmbed('⏳ Searching your YouTube playlists...')] })

  try {
    const yt = await getUserSession(userId)
    const playlists = await fetchUserPlaylists(yt)

    // Cari playlist by name (case-insensitive)
    const match = playlists.find(p =>
      p.title?.toLowerCase().includes(query.toLowerCase())
    )

    if (!match) {
      return loading.edit({ embeds: [errorEmbed(
        `Playlist "${query}" not found in your library or server playlists.\n` +
        `Run \`/smusic playlist list\` to see available playlists.`
      )] })
    }

    const playlistId = match.id || match.playlist_id
    await loadAndQueuePlaylist(message, userId, playlistId, match.title, loading)

  } catch (e) {
    console.error('[Playlist] Play error:', e)
    await loading.edit({ embeds: [errorEmbed(`Failed: ${e.message}`)] })
  }
}

async function handleServerPlaylistPlay(message, name, editTarget = null) {
  const guildId = message.guild.id
  const pl = serverPlaylistStore.getPlaylist(guildId, name)
  if (!pl) {
    const err = errorEmbed(`Playlist **${name}** tidak ditemukan.`)
    if (editTarget) return editTarget.edit({ embeds: [err], components: [] })
    return message.reply({ embeds: [err] })
  }

  if (!pl.songs.length) {
    const err = errorEmbed(`Playlist **${name}** kosong.`)
    if (editTarget) return editTarget.edit({ embeds: [err], components: [] })
    return message.reply({ embeds: [err] })
  }

  const { quality } = getConfig(guildId)
  let added = 0
  for (const s of pl.songs) {
    addToQueue(guildId, {
      ...s,
      requester: message.author.tag,
      requesterId: message.author.id,
      quality,
      startTime: null
    })
    added++
  }

  const embed = new EmbedBuilder()
    .setTitle(`📁 Playlist: ${pl.name}`)
    .setDescription(`✅ Berhasil menambahkan **${added}** lagu ke antrean.`)
    .setColor(0xFF0000)

  if (editTarget) {
    await editTarget.edit({ embeds: [embed], components: [] })
  } else {
    await message.reply({ embeds: [embed] })
  }

  if (getPlayerState(guildId) !== 'playing' && getPlayerState(guildId) !== 'paused') {
    await playSong(guildId, message.member.voice.channel, message.channel)
  }
}

async function handlePlaylistCreate(message, guildId, name) {
  if (!name) return message.reply({ embeds: [errorEmbed('Gunakan: `/smusic playlist create <nama>`')] })

  if (serverPlaylistStore.getPlaylist(guildId, name)) {
    return message.reply({ embeds: [errorEmbed(`Playlist **${name}** sudah ada.`)] })
  }

  serverPlaylistStore.createPlaylist(guildId, name, message.author.id)
  await message.reply({ embeds: [infoEmbed(`✅ Playlist **${name}** berhasil dibuat!`)] })
}

async function handlePlaylistAdd(message, guildId, args) {
  if (args.length < 2) return message.reply({ embeds: [errorEmbed('Gunakan: `/smusic playlist add <nama-playlist> <judul/url>`')] })

  if (!userInVoice(message)) return message.reply({ embeds: [errorEmbed('Join a voice channel first')] })

  const playlistName = args[0]
  const query = args.slice(1).join(' ')

  const pl = serverPlaylistStore.getPlaylist(guildId, playlistName)
  if (!pl) return message.reply({ embeds: [errorEmbed(`Playlist **${playlistName}** tidak ditemukan.`)] })

  const loading = await message.reply({ embeds: [infoEmbed(`⏳ Mencari **${query}**...`)] })

  try {
    let songObj = null
    const type = detectInputType(query)

    if (type === 'youtube_video') {
      const info = await getVideoInfo(query)
      songObj = {
        videoId: info.videoId,
        title: info.title,
        url: info.url,
        duration: info.duration,
        thumbnail: info.thumbnail
      }
    } else {
      const results = await searchSongs(query, message.author.id, 1)
      if (!results.length) return loading.edit({ embeds: [errorEmbed('Lagu tidak ditemukan.')] })
      const picked = results[0]
      songObj = {
        videoId: picked.videoId,
        title: picked.title,
        url: picked.url,
        duration: picked.duration.seconds || picked.duration || 0,
        thumbnail: picked.thumbnail?.url || picked.thumbnail || ''
      }
    }

    serverPlaylistStore.addSongToPlaylist(guildId, playlistName, songObj)
    await loading.edit({ embeds: [infoEmbed(`✅ **${songObj.title}** ditambahkan ke playlist **${pl.name}**.`)] })
  } catch (e) {
    await loading.edit({ embeds: [errorEmbed(e.message)] })
  }
}

async function handlePlaylistRemove(message, guildId, args) {
  if (args.length < 2) return message.reply({ embeds: [errorEmbed('Gunakan: `/smusic playlist remove <nama-playlist> <nomor>`')] })

  const playlistName = args[0]
  const index = parseInt(args[1], 10) - 1

  if (isNaN(index)) return message.reply({ embeds: [errorEmbed('Nomor lagu tidak valid.')] })

  const success = serverPlaylistStore.removeSongFromPlaylist(guildId, playlistName, index)
  if (success) {
    await message.reply({ embeds: [infoEmbed(`✅ Lagu ke-${index + 1} dihapus dari playlist **${playlistName}**.`)] })
  } else {
    await message.reply({ embeds: [errorEmbed('Playlist tidak ditemukan atau nomor lagu tidak valid.')] })
  }
}

async function handlePlaylistDelete(message, guildId, name) {
  if (!name) return message.reply({ embeds: [errorEmbed('Gunakan: `/smusic playlist delete <nama>`')] })

  const pl = serverPlaylistStore.getPlaylist(guildId, name)
  if (!pl) return message.reply({ embeds: [errorEmbed(`Playlist **${name}** tidak ditemukan.`)] })

  serverPlaylistStore.deletePlaylist(guildId, name)
  await message.reply({ embeds: [infoEmbed(`🗑 Playlist **${name}** dihapus.`)] })
}

async function handlePlaylistView(message, guildId, name) {
  if (!name) return message.reply({ embeds: [errorEmbed('Gunakan: `/smusic playlist view <nama>`')] })

  const pl = serverPlaylistStore.getPlaylist(guildId, name)
  if (!pl) return message.reply({ embeds: [errorEmbed(`Playlist **${name}** tidak ditemukan.`)] })

  if (!pl.songs.length) return message.reply({ embeds: [infoEmbed(`Playlist **${pl.name}** masih kosong.`)] })

  const ITEMS_PER_PAGE = 10
  const pages = Math.ceil(pl.songs.length / ITEMS_PER_PAGE)
  let currentPage = 1

  const generateEmbed = (page) => {
    const start = (page - 1) * ITEMS_PER_PAGE
    const end = start + ITEMS_PER_PAGE
    const items = pl.songs.slice(start, end)

    const lines = items.map((s, i) => {
      const dur = s.duration ? `\`${formatDuration(s.duration)}\`` : '`?:??`'
      return `**${start + i + 1}.** ${s.title} — ${dur}`
    })

    return new EmbedBuilder()
      .setTitle(`📁 Playlist: ${pl.name}`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Page ${page}/${pages} • Total: ${pl.songs.length} lagu` })
      .setColor(0xFF0000)
  }

  const getRow = (page) => {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('prev_pl_page')
        .setLabel('Prev')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 1),
      new ButtonBuilder()
        .setCustomId('next_pl_page')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === pages)
    )
  }

  const msg = await message.reply({ embeds: [generateEmbed(1)], components: pages > 1 ? [getRow(1)] : [] })
  if (pages === 1) return

  const collector = msg.createMessageComponentCollector({ time: 60000 })
  collector.on('collect', async (i) => {
    if (i.user.id !== message.author.id) return i.reply({ content: 'Not your command', ephemeral: true })
    if (i.customId === 'prev_pl_page') currentPage--
    if (i.customId === 'next_pl_page') currentPage++
    await i.update({ embeds: [generateEmbed(currentPage)], components: [getRow(currentPage)] })
  })

  collector.on('end', () => {
    msg.edit({ components: [] }).catch(() => {})
  })
}

// /smusic playlist search <nama>
async function handlePlaylistSearch(message, userId, query) {
  if (!await requireLogin(message)) return
  if (!query) {
    return message.reply({ embeds: [errorEmbed('Provide a search query.')] })
  }

  const loading = await message.reply({ embeds: [infoEmbed(`⏳ Searching playlists for "${query}"...`)] })

  try {
    const yt = await getUserSession(userId)

    // Search playlist di YouTube Music
    const searchResult = await yt.music.search(query, { type: 'playlist' })
    const playlists = searchResult?.playlists?.contents || []

    if (!playlists.length) {
      return loading.edit({ embeds: [errorEmbed(`No playlists found for "${query}"`)] })
    }

    const desc = playlists.slice(0, 5).map((p, i) => {
      const name = p.title || 'Unknown'
      const author = p.author?.name || ''
      const count = p.song_count || ''
      return `**${i + 1}.** ${name}\n└ ${author}${count ? ' • ' + count + ' songs' : ''}`
    }).join('\n\n')

    const embed = new EmbedBuilder()
      .setTitle(`🔍 Playlist Search: "${query}"`)
      .setDescription(desc)
      .setColor(0xFF0000)
      .setFooter({ text: 'smusic bot' })

    const buttons = playlists.slice(0, 5).map((_, i) =>
      new ButtonBuilder()
        .setCustomId(`playlist_search_${i}`)
        .setLabel(String(i + 1))
        .setStyle(ButtonStyle.Secondary)
    )
    const row = new ActionRowBuilder().addComponents(buttons)
    const reply = await loading.edit({ embeds: [embed], components: [row] })

    const collector = reply.createMessageComponentCollector({
      filter: i =>
        i.user.id === message.author.id &&
        i.customId.startsWith('playlist_search_'),
      time: 30_000,
      max: 1
    })

    collector.on('collect', async interaction => {
      if (!userInVoice(message)) {
        return interaction.reply({
          embeds: [errorEmbed('Join a voice channel first')],
          ephemeral: true
        })
      }
      const index = parseInt(interaction.customId.replace('playlist_search_', ''))
      const picked = playlists[index]
      const disabledRow = new ActionRowBuilder().addComponents(
        buttons.map(b => ButtonBuilder.from(b).setDisabled(true))
      )
      await interaction.update({ components: [disabledRow] })
      const playlistId = picked.id || picked.playlist_id
      await loadAndQueuePlaylist(message, userId, playlistId, picked.title, null)
    })

    collector.on('end', (_, reason) => {
      if (reason === 'time') reply.edit({ components: [] }).catch(() => {})
    })

  } catch (e) {
    console.error('[Playlist] Search error:', e)
    await loading.edit({ embeds: [errorEmbed(`Failed: ${e.message}`)] })
  }
}

// Helper: load playlist dan tambah ke queue
async function loadAndQueuePlaylist(message, userId, playlistId, playlistTitle, editTarget) {
  const guildId = message.guild.id

  try {
    const yt = await getUserSession(userId)
    const pl = await yt.music.getPlaylist(playlistId)
    const songs = pl?.contents || pl?.tracks || []

    if (!songs.length) {
      const embed = errorEmbed('This playlist is empty.')
      if (editTarget) return editTarget.edit({ embeds: [embed], components: [] })
      return message.channel.send({ embeds: [embed] })
    }

    const { quality } = getConfig(guildId)
    const title = playlistTitle || pl?.header?.title?.text || 'Playlist'

    let added = 0
    for (const s of songs) {
      try {
        const videoId = s.id || s.videoId
        if (!videoId) continue

        const title = typeof s.title === 'string'
          ? s.title
          : s.title?.text || s.title?.runs?.[0]?.text || 'Unknown'

        const thumbnail = s.thumbnail?.contents?.[0]?.url
          || s.thumbnail?.[0]?.url
          || s.thumbnails?.[0]?.url
          || ''

        addToQueue(guildId, {
          videoId,
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          duration: s.duration?.seconds || s.duration || 0,
          thumbnail,
          requester: message.author.tag,
          requesterId: message.author.id,
          quality,
          startTime: null
        })
        added++
      } catch (songErr) {
        console.warn('[Playlist] Skip song due to error:', songErr.message)
        continue
      }
    }

    const successEmbed = new EmbedBuilder()
      .setTitle(`📋 ${title}`)
      .setDescription(`✅ Added **${added}** songs to queue`)
      .setColor(0xFF0000)
      .setFooter({ text: 'smusic bot' })

    if (editTarget) {
      await editTarget.edit({ embeds: [successEmbed], components: [] })
    } else {
      await message.channel.send({ embeds: [successEmbed] })
    }

    if (getPlayerState(guildId) !== 'playing' && getPlayerState(guildId) !== 'paused') {
      await playSong(guildId, message.member.voice.channel, message.channel)
    }

  } catch (e) {
    console.error('[Playlist] Load error:', e)
    const embed = errorEmbed(`Failed to load playlist: ${e.message}`)
    if (editTarget) editTarget.edit({ embeds: [embed], components: [] }).catch(() => {})
    else message.channel.send({ embeds: [embed] }).catch(() => {})
  }
}