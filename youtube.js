/**
 *  @file YouTube API Functions
 *  @author Avana Vana <avana@esovdb.org>
 *  @version 3.0.0
 *  @module youtube
 */

const dotenv = require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const cache = require('./cache');
const { sleep, formatYTDuration, validateAndParseDate, normalizeUnicodeTitle, normalizeUnicodeDescription, detectYouTubeCourse } = require('./util');
const esovdb = require('./esovdb');

const youtube = axios.create({ baseURL: 'https://youtube.googleapis.com/youtube/v3/' });

/** @constant {RegExp} regexYTChannel - Regular expression to match a valid YouTube channel URL and extract its channelId. */
const regexYTChannel = /^(?:https?:\/\/(?:www\.)?youtube\.com\/channel\/)?(UC[\w-]{21}[AQgw])(?:\/|\/videos)?$/;

/** @constant {RegExp} regexYTPlaylist - Regular expression to match a valid YouTube playlist URL and extract its playlistId. */
const regexYTPlaylist = /(?!.*\?.*\bv=)(?!rec)(?:youtu\.be\/|youtube\.com\/(?:playlist|list|embed|watch)(?:\.php)?(?:\?.*list=|\/)|)([\w\-]{12,})/;

/** @constant {RegExp} regexDate - Regular expression to match dates in any of the formats YYYY-mm-DD, YYYY-mm, or YYYY. */
const regexDate = /^2[0-9]{3}(?:-[0-1][0-9](?:-[0-3][0-9])?)?$/;

/** @constant {('any'|'short'|'medium'|'long')} videoLengths - Enum values accepted by the YouTube Data API for video duration in search queries */
const videoLengths = [ 'any', 'short', 'medium', 'long' ];

const isPlaylistCourse = async (playlistId) => {
  console.log('Attempting to detect whether playlist is course...');
  const { data } = await axios.get(`https://www.youtube.com/playlist?list=${playlistId}`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' }, responseType: 'text' });
  return detectYouTubeCourse(data);
}

const getChannelResultsPage = async (channelId, length = 'any', publishedAfter = null, nextPageToken = null) => {
  try {
    const params = new URLSearchParams({
      part: 'snippet,id',
      channelId,
      maxResults: 50,
      order: 'date',
      type: 'video',
      videoDuration: length,
      key: process.env.YOUTUBE_API_KEY
    });

    if (publishedAfter) params.set('publishedAfter', publishedAfter);
    if (nextPageToken) params.set('pageToken', nextPageToken);
    const { data } = await youtube.get(`search${'?' + params.toString()}`);
    if (!data) throw new Error(`Couldn't connect to YouTube for search request.`);
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err.message }
  }
}

const getPlaylistItemsResultsPage = async (playlistId, nextPageToken = null) => {
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      playlistId,
      maxResults: 50,
      key: process.env.YOUTUBE_API_KEY
    });
    
    if (nextPageToken) params.set('pageToken', nextPageToken);
    const { data } = await youtube.get(`playlistItems${'?' + params.toString()}`);
    if (!data) throw new Error(`Couldn't connect to YouTube for playlist items request.`);
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err.message }
  }
};

const getPlaylistResultsPage = async (id) => {
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      id,
      maxResults: 50,
      key: process.env.YOUTUBE_API_KEY
    });
   
    const { data: { items: [ playlist ] } } = await youtube.get(`playlists${'?' + params.toString()}`);
    if (!playlist) throw new Error(`Couldn't connect to YouTube for playlist metadata request.`);
    return playlist;
  } catch (err) {
    return null;
  }
};

const getVideoDetailsPage = async (videoIds) => {
  try {
    const params = new URLSearchParams({
      part: 'contentDetails,snippet,id',
      maxResults: 50,
      key: process.env.YOUTUBE_API_KEY,
    });

    const { data } = await youtube.get(`videos${'?' + params.toString() + '&id=' + videoIds.join(',')}`);
    if (!data) throw new Error(`Couldn't connect to YouTube for video details request.`);
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err.message }
  }
}

const appendChannelResultPage = (list, page) => [
  ...list, 
  ...page.data.items.map((video) => ({
    id: video.id.videoId,
    title: normalizeUnicodeTitle(video.snippet.title),
    description: normalizeUnicodeDescription(video.snippet.description),
    channel: video.snippet.channelTitle,
    channelId: video.snippet.channelId,
    year: video.snippet.publishedAt.substr(0, 4),
    date: video.snippet.publishedAt
}))];

const appendPlaylistItemsResultPage = (list, page, playlistTitle) => [
  ...list, 
  ...page.data.items.map((video) => ({
    id: video.snippet.resourceId.videoId,
    title: normalizeUnicodeTitle(video.snippet.title),
    description: normalizeUnicodeDescription(video.snippet.description),
    playlist: playlistTitle,
    channel: video.snippet.channelTitle,
    channelId: video.snippet.channelId,
    position: video.snippet.position,
    year: video.snippet.publishedAt.substr(0, 4),
    date: video.snippet.publishedAt
}))];

const appendDetailsResultPage = (list, page) => [
  ...list,
  ...page.data.items.map((video) => ({
    id: video.id,
    duration: formatYTDuration(video.contentDetails.duration)
}))];

const appendVideoDetails = (list, page) => [
  ...list,
  ...page.data.items.map((video) => ({
    id: video.id,
    title: normalizeUnicodeTitle(video.snippet.title),
    description: normalizeUnicodeDescription(video.snippet.description),
    channel: video.snippet.channelTitle,
    channelId: video.snippet.channelId,
    year: video.snippet.publishedAt.substr(0, 4),
    date: video.snippet.publishedAt,
    duration: formatYTDuration(video.contentDetails.duration)
}))];

/**
  *  Collects all videos, with video details, from a given YouTube channel and returns them as an array of objects
  *
  *  @method collectAllChannelVideos
  *  @param {string} channelId - The channel ID of the YouTube channel that should be collected
  *  @param {('any'|'long'|'medium'|'short')} [length='any'] - The length of the videos to query, one of 'any' or 'long', 'medium', or 'short', with 'any' as the default
  *  @param {string} [publishedAfter] - The date after which the videos should be collected, in one of the formats 'YYYY-MM-DD', 'YYYY-MM', or 'YYYY'
  *  @returns {(Promise<object[]>|null)} - An array of objects containing the details of the videos collected or null, if no videos were found or retrieved
  */

const collectAllChannelVideos = async (channelId, length = 'any', publishedAfter) => {
  let i = 1, videos = [];

  console.log(`Retrieving video IDs from channel "${channelId}"...`);
  let result = await getChannelResultsPage(channelId, length, publishedAfter);
  
  if (result && result.error) {
    const err = new Error((result.error.errors && result.error.errors[0] && result.error.errors[0].message) || result.error.message || 'YouTube channel query failed.');
    err.status = result.error.code || 502;
    err.code = 'YOUTUBE_CHANNEL_QUERY_FAILED';
    err.details = result.error;
    throw err;
  }
  
  // return res.status(500).send(JSON.stringify(result.error));
  // const pages = Math.ceil(result.data.pageInfo.totalResults / result.data.pageInfo.resultsPerPage);
  videos = appendChannelResultPage(videos, result);
  
  const maxPages = 200;
  let nextPageToken = result && result.data ? result.data.nextPageToken : null;

  while (nextPageToken) {
    if (i >= maxPages) {
      const err = new Error('YouTube max pages limit reached.');
      err.status = 502;
      err.code = 'YOUTUBE_PAGINATION_LIMIT';
      throw err;
    }
    
    console.log(`Retrieving video data from page ${i}...`);
    i++, await sleep(0.2);
    result = await getChannelResultsPage(channelId, length, publishedAfter, nextPageToken);
    
    if (result && result.error) {
      const err = new Error((result.error.errors && result.error.errors[0] && result.error.errors[0].message) || result.error.message || 'YouTube channel query failed');
      err.status = result.error.code || 502;
      err.code = 'YOUTUBE_CHANNEL_QUERY_FAILED';
      err.details = result.error;
      throw err;
    }
    
    videos = appendChannelResultPage(videos, result);
    nextPageToken = result && result.data ? result.data.nextPageToken : null;
  }

  if (videos.length) {
    let videoDetails = [], videoIds = videos.map((video) => video.id);

    while (videoIds.length > 0) {
      let videoDetailsPage = await getVideoDetailsPage(videoIds.splice(0, 50));
      
      if (videoDetailsPage && videoDetailsPage.error) {
        const err = new Error((videoDetailsPage.error.errors && videoDetailsPage.error.errors[0] && videoDetailsPage.error.errors[0].message) || videoDetailsPage.error.message || 'YouTube video details query failed');
        err.status = videoDetailsPage.error.code || 502;
        err.code = 'YOUTUBE_CHANNEL_QUERY_FAILED';
        err.details = videoDetailsPage.error;
        throw err;
      }
      
      videoDetails = appendDetailsResultPage(videoDetails, videoDetailsPage);
    }

    videos = videos.map((video) => {
      const match = videoDetails.find((details) => details.id === video.id);
      return Object.assign({}, video, { duration: match ? match.duration : null });
    });
    
    console.log(`Successfully retrieved data for ${videos.length} video${videos.length === 1 ? '' : 's'} from channel "${videos[0].channel}".`);
    return videos;
  } else {
    console.log('No videos were retrieved for the requested channel and video duration.');
    return null
  }
}

const processChannelVideos = async (channelId, length, publishedAfter) => {
  try {
    const videos = await collectAllChannelVideos(channelId, length, publishedAfter ? publishedAfter.toISOString() : undefined);

    if (!videos || !videos.length) return { status: 204 }

    const itemsToAdd = videos.map((video) => ({
      fields: {
        'URL': `https://youtu.be/${video.id}`,
        'Title': video.title || '',
        'Description': video.description || '',
        'Year': +video.year || null,
        'Date': video.date || null,
        'Running Time': +video.duration || null,
        'Medium': 'Online Video',
        'YouTube Channel Title': video.channel || '',
        'YouTube Channel ID': video.channelId || '',
        'Submission Source': 'ESOVDB API Channel Watch',
        'Submitted by': 'ESOVDB API'
      }
    }));

    const data = await esovdb.processAdditions(itemsToAdd, 'Submissions');
    return { status: 201, data: { ...data, channel: videos[0].channel, channelId: videos[0].channelId }}
  } catch (error) {
    console.error(`Error processing videos from YouTube channel ${channelId}:`, error)
    return { status: error && error.status ? error.status : 500, error } 
  }
}

/**
  *  Collects all videos, with video details, from a given YouTube playlist or course and returns them as an array of objects
  *
  *  @method collectAllPlaylistVideos
  *  @param {string} playlistId - The playlist ID of the YouTube playlist that should be collected
  *  @returns {(Promise<object[]>|null)} - An array of objects containing the details of the videos collected or null, if no videos were found or retrieved
  */

const collectAllPlaylistVideos = async (playlistId) => {
  let i = 1, videos = [];

  console.log(`Retrieving metadata from playlist "${playlistId}"...`);
  const isCourse = await isPlaylistCourse(playlistId);
  console.log(`› Playlist is${!isCourse ? ' NOT' : ''} of type "course".`);
  let result = await getPlaylistResultsPage(playlistId);

  if (result && result.error) {
    const err = new Error((result.error.errors && result.error.errors[0] && result.error.errors[0].message) || result.error.message || 'YouTube playlist metadata query failed.');
    err.status = result.error.code || 502;
    err.code = 'YOUTUBE_PLAYLIST_QUERY_FAILED';
    err.details = result.error;
    throw err;
  }

  const playlistTitle = result && result.snippet && result.snippet.title ? result.snippet.title : playlistId;
  console.log(`Retrieving video IDs from${isCourse ? ' course' : ''} playlist "${playlistTitle}"...`);
  result = await getPlaylistItemsResultsPage(playlistId);

  if (result && result.error) {
    const err = new Error((result.error.errors && result.error.errors[0] && result.error.errors[0].message) || result.error.message || 'YouTube playlist items query failed.');
    err.status = result.error.code || 502;
    err.code = 'YOUTUBE_PLAYLIST_QUERY_FAILED';
    err.details = result.error;
    throw err;
  }

  videos = appendPlaylistItemsResultPage(videos, result, playlistTitle);

  const maxPages = 200;
  let nextPageToken = result && result.data ? result.data.nextPageToken : null;

  while (nextPageToken) {
    if (i >= maxPages) {
      const err = new Error('YouTube max pages limit reached.');
      err.status = 502;
      err.code = 'YOUTUBE_PAGINATION_LIMIT';
      throw err;
    }

    console.log(`Retrieving video data from page ${i + 1}...`);
    i++, await sleep(0.2);
    result = await getPlaylistItemsResultsPage(playlistId, nextPageToken);

    if (result && result.error) {
      const err = new Error((result.error.errors && result.error.errors[0] && result.error.errors[0].message) || result.error.message || 'YouTube playlist query failed');
      err.status = result.error.code || 502;
      err.code = 'YOUTUBE_PLAYLIST_QUERY_FAILED';
      err.details = result.error;
      throw err;
    }

    videos = appendPlaylistItemsResultPage(videos, result, playlistTitle);
    nextPageToken = result && result.data ? result.data.nextPageToken : null;
  }

  if (videos.length) {
    let videoDetails = [], videoIds = videos.map((video) => video.id);

    while (videoIds.length > 0) {
      let videoDetailsPage = await getVideoDetailsPage(videoIds.splice(0, 50));

      if (videoDetailsPage && videoDetailsPage.error) {
        const err = new Error((videoDetailsPage.error.errors && videoDetailsPage.error.errors[0] && videoDetailsPage.error.errors[0].message) || videoDetailsPage.error.message || 'YouTube video details query failed');
        err.status = videoDetailsPage.error.code || 502;
        err.code = 'YOUTUBE_PLAYLIST_QUERY_FAILED';
        err.details = videoDetailsPage.error;
        throw err;
      }

      videoDetails = appendDetailsResultPage(videoDetails, videoDetailsPage);
    }

    videos = videos.map((video) => {
      const match = videoDetails.find((details) => details.id === video.id);
      return Object.assign({}, video, { isCourseVideo: isCourse, duration: match ? match.duration : null });
    });

    console.log(`Successfully retrieved data for ${videos.length} video${videos.length === 1 ? '' : 's'} from${isCourse ? ' course' : ''} playlist "${playlistTitle}".`);
    return videos;
  } else {
    console.log(`No videos were retrieved for the requested${isCourse ? ' course' : ''} playlist.`);
    return null;
  }
};

module.exports = {
  getChannelVideos: async (req, res) => {
    try {
      if (!req.body.channel) return res.status(400).send('Channel ID or URL required.');
      const match = regexYTChannel.exec(req.body.channel);
      if (!match || !match[1]) return res.status(400).send('Invalid channel ID or URL.');
      const channelId = match[1];
      const videos = await collectAllChannelVideos(channelId, req.body.length, req.body.publishedAfter);
      return videos ? res.status(200).send(videos) : res.status(204).send('No videos retrieved.');
    } catch (error) {
      console.error(`[ERROR] getChannelVideos(${req.body && req.body.channel ? req.body.channel : 'unknown'}):`, error);
      
      return res.status(error && error.status ? error.status : 500).send(JSON.stringify({
        error: {
          code: error && error.code ? error.code : 'YOUTUBE_CHANNEL_FETCH_FAILED',
          message: error && error.message ? error.message : 'Failed to retrieve channel videos.'
        }
      }));
    }
  },
  
  getPlaylistVideos: async (req, res) => {
    try {
      if (!req.body.playlist) return res.status(400).send('Playlist ID or URL required.');
      const match = regexYTPlaylist.exec(req.body.playlist);
      if (!match || !match[1]) return res.status(400).send('Invalid playlist ID or URL.');
      const playlistId = match[1];
      const videos = await collectAllPlaylistVideos(playlistId);
      return videos ? res.status(200).send(videos) : res.status(204).send('No videos retrieved.');
    } catch (error) {
      console.error(`[ERROR] getPlaylistVideos(${req.body && req.body.channel ? req.body.channel : 'unknown'}):`, error);
      
      return res.status(error && error.status ? error.status : 500).send(JSON.stringify({
        error: {
          code: error && error.code ? error.code : 'YOUTUBE_PLAYLIST_FETCH_FAILED',
          message: error && error.message ? error.message : 'Failed to retrieve playlist videos.'
        }
      }));
    }
  },
  
  getVideo: async (videoId) => {
    console.log(`Retrieving data for video with ID "${videoId}"...`);
    const result = await getVideoDetailsPage([ videoId ]);
    if (result.error || !result.data.items.length) throw new Error(result.error);
    const video = appendVideoDetails([], result)[0];
    console.log(`Successfully retrieved data for "${video.title}" from channel "${video.channel}".`);
    return video;
  }
}