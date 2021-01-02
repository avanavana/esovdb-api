/**
 * @file Zotero Web API 3.0 methods and utility functions
 * @author Avana Vana <dear.avana@gmail.com>
 * @module zotero
 * @see [Zotero Web API 3.0 › Write Requests]{@link www.zotero.org/support/dev/web_api/v3/write_requests}
 */

const dotenv = require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { processUpdates } = require('./esovdb');
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

/*
 * Utility sleep function based on units of seconds that returns a promise and can be consumed by async/await
 *
 * @function sleep
 * @param {number} seconds - The number of seconds to sleep for (i.e. the number of seconds after which the promise will resolve)
 * @returns {Promise} Resolves after a specified [number]{@link seconds} of seconds
 *
 */

const sleep = (seconds) => {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
};

/*
 *  Passes items succesfully added to or updated on Zotero and returned with Zotero keys and/or new version numbers to {@link esovdb.processUpdates} and then returns its result for logging
 *
 *  @async
 *  @function updateVideos
 *  @requires esovdb
 *  @param {Object[]} items - An array of objects formatted as updates for Airtable (i.e. [ { id: 'recordId', fields: { 'Airtable Field': 'value', ... } }, ... ])
 *  @returns {Object[]} The original array of Zotero items, {@link items}, passed through {@link esovdb.processUpdates}
 */

const updateVideos = async (items) => {
  console.log(`Updating Zotero key and version for ${items.length} item${items.length > 1 ? 's' : ''} on the ESOVDB...`);

  try {
    const response = await processUpdates(items);
    
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

/*
 *  Fetches a fresh 'videoRecording' template from Zotero with which to structure items in posts to the Zotero API
 *
 *  @async
 *  @function getTemplate
 *  @requires axios
 *  @requires zotero
 *  @returns {Object} A Zotero new item template of type 'videoRecording'
 *
 *  @see [Zotero Web API 3.0 › Types & Fields › Getting a Template for a New Item]{@link https://www.zotero.org/support/dev/web_api/v3/types_and_fields#getting_a_template_for_a_new_item}
 */

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

/**
 * @typedef {Object} ZoteroResponse
 * @property {(Object[]|null)} successful - An array of succesfully added or updated Zotero item objects
 * @property {(string[]|null)} unchanged - An array of Zotero item keys of Zotero items which remained unchanged after the POST request either because no changes were sent or the version sent was outdated
 * @property {(Object[]|null)} failed - An array of Zotero item objects which failed in their attempts to be added or updated, perhaps due to format/syntactical or structural errors
 */

/*
 *  Adds or updates one or more items in a Zotero Library depending on whether a given item object is passed with Zotero key and version properties and returns a {@link ZoteroResponse} object from the Zotero API.  Failed items are also written to failed.json for forensic/debugging purposes.
 *
 *  @async
 *  @function updateVideos
 *  @requires fs
 *  @requires axios
 *  @requires zoteroLibrary
 *  @param {Object[]} items - An array of objects formatted as Zotero items according to the Zotero Web API 3.0 docs
 *  @returns {ZoteroResponse} An object containing an array of successfully added or updated Zotero item objects, an array of Zotero item keys of unchanged Zotero items, and an array of Zotero item objects of Zotero items which failed to be added or updated
 *
 *  @see [Zotero Web API 3.0 › Write Requests › Creating Multiple Objects]{@link https://www.zotero.org/support/dev/web_api/v3/write_requests#creating_multiple_objects}
 */

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

/*
 *  Converts raw data for a single video from the ESOVDB into a format that can be accepted by Zotero in a single- or multiple-item write request
 *
 *  @function formatItems
 *  @requires util.packageAuthors
 *  @requires util.formatDuration
 *  @requires util.formatDate
 *  @param {Object} video - An object representing a video from the ESOVDB, retrieved from the ESOVDB either through the API or through Airtable's automation feature
 *  @param {Object} template - A valid Zotero item template, retrieved from Zotero using {@link getTemplate}
 *  @returns {Object} A properly-formatted and populated object for use in either a single-item or multiple-item Zotero write request
 *
 *  @see [Zotero Web API 3.0 › Write Requests › Item Requests]{@link https://www.zotero.org/support/dev/web_api/v3/write_requests#item_requests}
 */

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
  
  /*
   *  Takes a single ESOVDB video object or an array of ESOVDB video objects from Airtable sent through either POST or PUT [requests]{@link req} to this server's /zotero API endpoint, retrieves a new item template from the Zotero API using {@link getTemplate}, maps those requested video objects to an array valid new or updated Zotero items (depending on whether a Zotero key and version are passed) using {@link formatItems}, attempts to POST that array of formatted items to a Zotero library using {@link postItems}, and then syncs the updated Zotero version (if updated) or newly acquired Zotero key and version (if created) back with the ESOVDB for each item successfully posted to the Zotero library, using {@link updateVideos}, sending a server response of 200 with the JSON of any successfully updated/added items.
   *
   *  @async
   *  @method syncItems
   *  @requires getTemplate
   *  @requires formatItems
   *  @requires postItems
   *  @requires updateVideos
   *  @param {Object} req - Express.js request object, an enhanced version of Node's http.IncomingMessage class
   *  @param {(Object|Object[])} req.body - A single object or array of objects representing records from the ESOVDB videos table in Airtable, either originally retrieved through this server's esovdb/videos/list endpoint, or sent through an ESOVDB Airtable automation
   *  @param {Object} res - Express.js request object, an enhanced version of Node's http.ServerResponse class
   */
  
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

    while (items.length) {
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

      let { successful, unchanged, failed } = await postItems(items.splice(0, 50));

      if (successful.length > 0) posted = [...posted, ...successful];

      totalSuccessful += successful.length;
      totalUnchanged += unchanged.length;
      totalFailed += failed.length;
      
      if (items.length > 50) await sleep(10);

      i++;
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