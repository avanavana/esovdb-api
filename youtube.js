/**
 *  @file YouTube API Functions
 *  @author Avana Vana <avana@esovdb.org>
 *  @version 2.2.0
 *  @module youtube
 */

const dotenv = require('dotenv').config();
const axios = require('axios');
const { sleep, formatYTDuration } = require('./util');

const youtube = axios.create({ baseURL: 'https://youtube.googleapis.com/youtube/v3/' });

const regexYTChannel = /^(?:https?:\/\/(?:www\.)?youtube\.com\/channel\/)?(UC[\w-]{21}[AQgw])(?:\/|\/videos)?$/;
const regexYTPlaylist = /(?!.*\?.*\bv=)(?!rec)(?:youtu\.be\/|youtube\.com\/(?:playlist|list|embed|watch)(?:\.php)?(?:\?.*list=|\/)|)([\w\-]{12,})/;

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

module.exports = {
  getChannelVideos: async (req, res) => {
    if (!req.body.channel) return res.status(400).send('Channel ID or URL required.');
    let i = 2, videos = [], channelId = regexYTChannel.exec(req.body.channel)[1];
    console.log(`Retrieving video IDs from channel "${channelId}"...`);
    let result = await getChannelResultsPage(channelId, req.body.length || 'any', req.body.publishedAfter);
    if (result.error) return res.status(400).send(JSON.stringify(result.error));
    const pages = Math.ceil(result.data.pageInfo.totalResults / result.data.pageInfo.resultsPerPage);
    videos = appendChannelResultPage(videos, result);

    while (i <= pages) {
      console.log(`Retrieving video data from page ${i} of ${pages})...`);
      i++, await sleep(0.2);
      result = await getChannelResultsPage(channelId, req.body.length || 'any', req.body.publishedAfter, result.data.nextPageToken);
      if (result.error) return res.status(400).send(JSON.stringify(result.error));
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
      return res.status(200).send(videos);
    } else {
      console.log('No videos were retrieved for the requested channel and video duration.');
      return res.status(204).send('No videos retrieved.');
    }
  },
  
  getPlaylistVideos: async (req, res) => {
    if (!req.body.playlist) return res.status(400).send('Playlist ID or URL required.');
    let i = 2, videos = [], playlistId = regexYTPlaylist.exec(req.body.playlist)[1];
    console.log(`Retrieving metadata from playlist "${playlistId}"...`);
    let playlistData = await getPlaylistResultsPage(playlistId);
    const playlistTitle = playlistData ? playlistData.snippet.title : playlistId;
    console.log(`Retrieving video IDs from playlist "${playlistTitle}"...`);
    let result = await getPlaylistItemsResultsPage(playlistId);
    if (result.error) return res.status(400).send(JSON.stringify(result.error));
    const pages = Math.ceil(result.data.pageInfo.totalResults / result.data.pageInfo.resultsPerPage);
    videos = appendPlaylistItemsResultPage(videos, result, playlistTitle);

    while (i <= pages) {
      console.log(`Retrieving video data from page ${i} of ${pages})...`);
      i++, await sleep(0.2);
      result = await getPlaylistItemsResultsPage(playlistId, result.data.nextPageToken);
      if (result.error) return res.status(400).send(JSON.stringify(result.error));
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