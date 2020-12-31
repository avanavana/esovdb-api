const dotenv = require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { postUpdates } = require('./esovdb');
const { formatDuration, formatDate, packageAuthors } = require('./util');

const zoteroHeaders = {
  Authorization: 'Bearer ' + process.env.ZOTERO_API_KEY,
  'Zotero-API-Version': '3',
  'User-Agent': 'airtable-api-proxy/1.0.0',
};

const zoteroLibrary = axios.create({
  baseURL: `https://api.zotero.org/users/${process.env.ZOTERO_USER}/`,
  headers: zoteroHeaders,
});

const zotero = axios.create({
  baseURL: 'https://api.zotero.org/',
  headers: zoteroHeaders,
});

zoteroLibrary.defaults.headers.post['Content-Type'] = 'application/json';

const sleep = (seconds) => {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
};

const updateVideos = async (items) => {
  console.log(`Updating Zotero key and version for ${items.length} item${items.length > 1 ? 's' : ''} on the ESOVDB...`);

  try {
    const response = await postUpdates(items);
    
    if (response.length > 0) {
      return response;
    } else {
      let error = `[ERROR] Couldn't update ${items.length} item${items.length > 1 ? 's' : ''} on the ESOVDB.`;
      console.error(error);
      throw new Error(error);
    }
  } catch (err) {
    console.error(err);
    throw new Error(err);
  }
};

const getTemplate = async () => {
  console.log('Retrieving template from Zotero...');
  try {
    const response = await zotero.get('items/new', {
      params: { itemType: 'videoRecording' },
    });

    if (response.data) {
      console.log('› Successfully retrieved template.');
    }
    return response.data;
  } catch (err) {
    console.error(err);
    throw new Error(err);
  }
};

const postItems = async (items) => {
  try {
    const response = await zoteroLibrary.post('items', items);
    
    const successful = Object.values(response.data.successful);
    const unchanged = Object.values(response.data.unchanged);
    const failed = Object.values(response.data.failed);

    if (successful.length > 0) {
      console.log(`› Successfully posted ${successful.length} item${successful.length > 1 ? 's' : ''}.`);
    }
    
    if (unchanged.length > 0) {
      console.log(`› ${unchanged.length} item${unchanged.length > 1 ? 's' : ''} left unchanged.`);
    }

    if (failed.length > 0) {
      console.error(`› Failed to post ${failed.length} video${failed.length > 1 ? 's' : ''}.`);
      const failedItems = JSON.stringify(response.data.failed);

      fs.writeFile('failed.json', failedItems, 'utf8', (err) => {
        if (err) console.error('[ERROR] An error occured while writing JSON Object to File.');
      });
    }

    return { successful: successful, unchanged: unchanged, failed: failed };
  } catch (err) {
    console.error(err);
    throw new Error(err);
  }
};

const formatItems = (video, template) => {
  let extras = [];
  
  video.presenters = packageAuthors(video.presentersFirstName, video.presentersLastName);

  if (video.topic) extras.push({ title: 'Topic', value: video.topic });
  if (video.location) extras.push({ title: 'Location', value: video.location });
  if (video.plusCode)
    extras.push({ title: 'Plus Code', value: video.plusCode });
  if (video.learnMore)
    extras.push({ title: 'Learn More', value: video.learnMore });

  const presenters =
    video.presenters.length > 0
      ? video.presenters.map((presenter) => {
          if (presenter.lastName !== 'Unknown') {
            return !presenter.firstName || !presenter.lastName
              ? {
                  creatorType: 'contributor',
                  name: presenter.firstName || '' + presenter.lastName || '',
                }
              : {
                  creatorType: 'contributor',
                  firstName: presenter.firstName,
                  lastName: presenter.lastName,
                };
          }
        })
      : [];

  const payload = {
    ...template,
    itemType: 'videoRecording',
    title: video.title || '',
    creators: presenters,
    abstractNote: video.desc || '',
    videoRecordingFormat: video.format || '',
    seriesTitle: video.series[0] || '',
    volume: video.vol ? `${video.vol || ''}:${video.no || ''}` : video.no || '',
    numberOfVolumes: video.seriesCount > 1 ? video.seriesCount : '',
    place: video.provider || '',
    studio: video.publisher[0] || '',
    date: video.year || '',
    runningTime: formatDuration(video.runningTime) || '',
    language: video.language || '',
    ISBN: '',
    shortTitle: '',
    url: video.url || '',
    accessDate: formatDate(video.accessDate) || '',
    archive: 'Earth Science Online Video Database',
    archiveLocation:
      'https://airtable.com/tbl3WP689vHdmg7P2/viwD9Tpr6JAAr97CW/' +
      video.recordId,
    libraryCatalog: '',
    callNumber: video.esovdbId || '',
    rights: '',
    extra: extras.map((item) => item.title + ': ' + item.value).join('\n'),
    tags: [],
    collections: ['7J7AJ2BH'],
    relations: {},
  };
  
  if (video.zoteroKey && video.zoteroVersion) {
    payload.key = video.zoteroKey;
    payload.version = video.zoteroVersion;
  }
  
  return payload;
};

module.exports = {
  syncItems: async (req, res) => {    
    const videos = Array.isArray(req.body) ? req.body : Array.of(req.body);
    const template = await getTemplate();
    let items = videos.map((video) => formatItems(video, template));
    
    let i = 0,
      totalSuccessful = 0,
      totalUnchanged = 0,
      totalFailed = 0,
      posted = [],
      queue = items.length;

    while (items.length > 0) {
      console.log(
        `Posting item${items.length > 1 ? 's' : ''} ${
          i * 50 + 1
        }${items.length > 1 ? '-' : ''}${
          items.length > 1
            ? i * 50 +
              (items.length < 50
                ? items.length
                : 50)
            : ''
        } of ${queue} total to Zotero...`
      );

      let { successful, unchanged, failed } = await postItems(
        items.slice(0, 50)
      );

      if (successful.length > 0) posted = [...posted, ...successful];

      totalSuccessful += successful.length;
      totalUnchanged += unchanged.length;
      totalFailed += failed.length;
      
      if (items.length > 50) await sleep(10);

      i++, (items = items.slice(50));
    }

    console.log('[DONE] Posted to Zotero:');
    
    if (totalSuccessful > 0)
      console.log(`› [${totalSuccessful}] item${totalSuccessful > 1 ? 's' : ''} total added or updated.`);

    if (totalUnchanged > 0)
      console.log(`› [${totalUnchanged}] item${totalUnchanged > 1 ? 's' : ''} total left unchanged.`);

    if (totalFailed > 0)
      console.log(`› [${totalUnchanged}] item${totalFailed > 1 ? 's' : ''} total failed to add or update.`);

    if (posted.length > 0) {
      const itemsToSync = posted.map((item) => ({
        id: item.data.archiveLocation.match(/rec[\w]{14}$/)[0],
        fields: {
          'Zotero Key': item.key,
          'Zotero Version': item.version,
        }
      }));

      const updated = await updateVideos(itemsToSync);

      if (updated && updated.length > 0) {
        console.log(`› [${updated.length}] item${updated.length > 1 ? 's\'' : '\'s'} Zotero key and version synced with the ESOVDB.`);
        res.status(200).send(JSON.stringify(updated));
      } else {
        console.error('[ERROR] Error syncing items with the ESOVBD.');
        res.status(404).send('Unable to sync Zotero updates with the ESOVDB.');
      }
    } else {
      res.status(404).send('No items were posted to Zotero.');
    }
  }
}