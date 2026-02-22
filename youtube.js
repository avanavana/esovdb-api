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
const { sleep, formatYTDuration, validateAndParseDate } = require('./util');
const esovdb = require('./esovdb');

const youtube = axios.create({ baseURL: 'https://youtube.googleapis.com/youtube/v3/' });

/** @constant {RegExp} regexYTChannel - Regular expression to match a valid YouTube channel URL and extract its channelId. */
const regexYTChannel = /^(?:https?:\/\/(?:www\.)?youtube\.com\/channel\/)?(UC[\w-]{21}[AQgw])(?:\/|\/videos)?$/;

/** @constant {RegExp} regexYTPlaylist - Regular expression to match a valid YouTube playlist URL and extract its playlistId. */
const regexYTPlaylist = /(?!.*\?.*\bv=)(?!rec)(?:youtu\.be\/|youtube\.com\/(?:playlist|list|embed|watch)(?:\.php)?(?:\?.*list=|\/)|)([\w\-]{12,})/;

/** @constant {RegExp} regexData - Regular expression to match dates in any of the formats YYYY-mm-DD, YYYY-mm, or YYYY. */
const regexDate = /^2[0-9]{3}(?:-[0-1][0-9](?:-[0-3][0-9])?)?$/;

/** @constant {('any'|'short'|'medium'|'long')} videoLengths - Enum values accepted by the YouTube Data API for video duration in search queries */
const videoLengths = [ 'any', 'short', 'medium', 'long' ];

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
    title: video.snippet.title,
    description: video.snippet.description,
    channel: video.snippet.channelTitle,
    channelId: video.snippet.channelId,
    year: video.snippet.publishedAt.substr(0, 4),
    date: video.snippet.publishedAt
}))];

const appendPlaylistItemsResultPage = (list, page, playlistTitle) => [
  ...list, 
  ...page.data.items.map((video) => ({
    id: video.snippet.resourceId.videoId,
    title: video.snippet.title,
    description: video.snippet.description,
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
    title: video.snippet.title,
    description: video.snippet.description,
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
   *  @param {string} channelId - The channel ID of the YouTube channel that should be watched
   *  @param {('any'|'long'|'medium'|'short')} [length='any'] - The length of the videos to query, one of 'any' or 'long', 'medium', or 'short', with 'any' as the default
   *  @param {string} [publishedAfter] - The date after which the videos should be collected, in one of the formats 'YYYY-MM-DD', 'YYYY-MM', or 'YYYY'
   *  @returns {(Promise<object[]>|null)} - An array of objects containing the details of the videos collected or null, if no videos were found or retrieved
   */

const collectAllChannelVideos = async (channelId, length = 'any', publishedAfter) => {
  let i = 2, videos = [];

  console.log(`Retrieving video IDs from channel "${channelId}"...`);
  let result = await getChannelResultsPage(channelId, length, publishedAfter);
  if (result.error) return res.status(500).send(JSON.stringify(result.error));
  const pages = Math.ceil(result.data.pageInfo.totalResults / result.data.pageInfo.resultsPerPage);
  videos = appendChannelResultPage(videos, result);

  while (i <= pages) {
    console.log(`Retrieving video data from page ${i} of ${pages})...`);
    i++, await sleep(0.2);
    result = await getChannelResultsPage(channelId, length, publishedAfter, result.data.nextPageToken);
    if (result.error) return res.status(500).send(JSON.stringify(result.error));
    videos = appendChannelResultPage(videos, result);
  }

  if (videos.length) {
    let videoDetails = [], videoIds = videos.map((video) => video.id);

    while (videoIds.length > 0) {
      let videoDetailsPage = await getVideoDetailsPage(videoIds.splice(0, 50));
      videoDetails = appendDetailsResultPage(videoDetails, videoDetailsPage);
    }

    videos = videos.map((video) => ({ ...video, duration: videoDetails.filter((details) => details.id === video.id)[0].duration }));
    
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
    return { status: 500, error } 
  }
}

module.exports = {
  getChannelVideos: async (req, res) => {
    if (!req.body.channel) return res.status(400).send('Channel ID or URL required.');
    const channelId = regexYTChannel.exec(req.body.channel)[1];
    const videos = await collectAllChannelVideos(channelId, req.body.length, req.body.publishedAfter);
    return videos ? res.status(200).send(videos) : res.status(204).send('No videos retrieved.');
  },
  
  getPlaylistVideos: async (req, res) => {
    if (!req.body.playlist) return res.status(400).send('Playlist ID or URL required.');
    let i = 2, videos = [], playlistId = regexYTPlaylist.exec(req.body.playlist)[1];
    console.log(`Retrieving metadata from playlist "${playlistId}"...`);
    let playlistData = await getPlaylistResultsPage(playlistId);
    const playlistTitle = playlistData ? playlistData.snippet.title : playlistId;
    console.log(`Retrieving video IDs from playlist "${playlistTitle}"...`);
    let result = await getPlaylistItemsResultsPage(playlistId);
    if (result.error) return res.status(500).send(JSON.stringify(result.error));
    const pages = Math.ceil(result.data.pageInfo.totalResults / result.data.pageInfo.resultsPerPage);
    videos = appendPlaylistItemsResultPage(videos, result, playlistTitle);

    while (i <= pages) {
      console.log(`Retrieving video data from page ${i} of ${pages})...`);
      i++, await sleep(0.2);
      result = await getPlaylistItemsResultsPage(playlistId, result.data.nextPageToken);
      if (result.error) return res.status(500).send(JSON.stringify(result.error));
      videos = appendPlaylistItemsResultPage(videos, result, playlistTitle);
    }

    if (videos.length) {
      let videoDetails = [], videoIds = videos.map((video) => video.id);

      while (videoIds.length > 0) {
        let videoDetailsPage = await getVideoDetailsPage(videoIds.splice(0, 50));
        videoDetails = appendDetailsResultPage(videoDetails, videoDetailsPage);
      }

      videos = videos.map((video) => ({ ...video, duration: videoDetails.filter((details) => details.id === video.id)[0].duration }));
      
      console.log(`Successfully retrieved data for ${videos.length} video${videos.length === 1 ? '' : 's'} from playlist "${playlistTitle}".`);
      return res.status(200).send(videos);
    } else {
      console.log('No videos were retrieved for the requested playlist.');
      return res.status(204).send('No videos retrieved.');
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