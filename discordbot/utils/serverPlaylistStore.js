import fs from 'fs';
import path from 'path';

const PLAYLIST_FILE = './data/server-playlists.json';

function loadPlaylists() {
    try {
        if (!fs.existsSync(PLAYLIST_FILE)) {
            return {};
        }
        const data = fs.readFileSync(PLAYLIST_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error('[PlaylistStore] Error loading playlists:', e);
        return {};
    }
}

function savePlaylists(data) {
    try {
        const dir = path.dirname(PLAYLIST_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[PlaylistStore] Error saving playlists:', e);
    }
}

export function getGuildPlaylists(guildId) {
    const data = loadPlaylists();
    return data[guildId] || {};
}

export function getPlaylist(guildId, name) {
    const playlists = getGuildPlaylists(guildId);
    // Case-insensitive lookup
    const key = Object.keys(playlists).find(k => k.toLowerCase() === name.toLowerCase());
    return key ? playlists[key] : null;
}

export function createPlaylist(guildId, name, creatorId) {
    const data = loadPlaylists();
    if (!data[guildId]) data[guildId] = {};

    data[guildId][name] = {
        name,
        createdBy: creatorId,
        songs: []
    };

    savePlaylists(data);
}

export function addSongToPlaylist(guildId, name, song) {
    const data = loadPlaylists();
    if (!data[guildId]) return;

    const key = Object.keys(data[guildId]).find(k => k.toLowerCase() === name.toLowerCase());
    if (!key) return;

    data[guildId][key].songs.push({
        videoId: song.videoId,
        title: song.title,
        url: song.url,
        duration: song.duration,
        thumbnail: song.thumbnail
    });

    savePlaylists(data);
}

export function removeSongFromPlaylist(guildId, name, index) {
    const data = loadPlaylists();
    if (!data[guildId]) return false;

    const key = Object.keys(data[guildId]).find(k => k.toLowerCase() === name.toLowerCase());
    if (!key) return false;

    if (index < 0 || index >= data[guildId][key].songs.length) return false;

    data[guildId][key].songs.splice(index, 1);
    savePlaylists(data);
    return true;
}

export function deletePlaylist(guildId, name) {
    const data = loadPlaylists();
    if (!data[guildId]) return;

    const key = Object.keys(data[guildId]).find(k => k.toLowerCase() === name.toLowerCase());
    if (!key) return;

    delete data[guildId][key];
    savePlaylists(data);
}
