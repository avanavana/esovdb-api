/**
 *  @file Zotero Web API 3.0 sync methods and utility functions
 *  @author Avana Vana <dear.avana@gmail.com>
 *  @module zotero
 *  @see [Zotero Web API 3.0 › Write Requests]{@link www.zotero.org/support/dev/web_api/v3/write_requests}
 */

const dotenv = require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { Observable, Subject } = require('rxjs');
const webhooks = require('./webhooks');
const twitter = require('./twitter');
const batch = require('./batch');
const { processUpdates } = require('./esovdb');
const { sleep, queueAsync, formatDuration, formatDate, packageAuthors, getOp, sortDates } = require('./util');

const zoteroHeaders = {
  Authorization: 'Bearer ' + process.env.ZOTERO_API_KEY,
  'Zotero-API-Version': '3',
  'User-Agent': 'airtable-api-proxy/1.0.0',
};

const zoteroLibrary = axios.create({
  baseURL: `https://api.zotero.org/groups/${process.env.ZOTERO_GROUP}/`,
  // the above is set for a group library—for a personal library use:
  // baseURL: `https://api.zotero.org/users/${process.env.ZOTERO_USER}/`,
  headers: zoteroHeaders,
});

const zotero = axios.create({
  baseURL: 'https://api.zotero.org/',
  headers: zoteroHeaders,
});

zoteroLibrary.defaults.headers.post['Content-Type'] = 'application/json';

/** @constant {Map} parentCollections - Maps parent collections names from the ESOVDB to parent collection IDs in the Zotero library */
const parentCollections = new Map([
  ['series', 'HYQEFRGR'],
  ['topics', 'EGB8TQZ8']
]);

/** @constant {Map} topics - Maps ESOVDB topics to their collection keys in Zotero */
// prettier-ignore
const topics = new Map([
  ['Mantle Geodynamics, Geochemistry, Convection, Rheology, & Seismic Imaging and Modeling', '5XQD67DA'],
  ['Igneous & Metamorphic Petrology, Volcanism, & Hydrothermal Systems', 'L6JMIGTE'],
  ['Alluvial, Pluvial & Terrestrial Sedimentology, Erosion & Weathering, Geomorphology, Karst, Groundwater & Provenance', 'BV7G3CIC'],
  ['Early Earth, Life\'s Origins, Deep Biosphere, and the Formation of the Planet', '9DK53U7F'],
  ['Geological Stories, News, Tours, & Field Trips', 'XDFHQTC3'],
  ['History, Education, Careers, Field Work, Economic Geology, & Technology', 'M4NKIHBK'],
  ['Glaciation, Atmospheric Science, Carbon Cycle, & Climate', 'AD997U4T'],
  ['The Anthropocene', 'P2WNJD9N'],
  ['Geo-Archaeology', 'UJDCHPB5'],
  ['Paleoclimatology, Isotope Geochemistry, Radiometric Dating, Deep Time, & Snowball Earth', 'L4PLXHN8'],
  ['Seafloor Spreading, Oceanography, Paleomagnetism, & Geodesy', 'NPDV3BHH'],
  ['Tectonics, Terranes, Structural Geology, & Dynamic Topography', 'U3JYUDHI'],
  ['Seismology, Mass Wasting, Tsunamis, & Natural Disasters', '63TE3Y26'],
  ['Minerals, Mining & Resources, Crystallography, & Solid-state Chemistry', 'YY5W7DB8'],
  ['Marine & Littoral Sedimentology, Sequence Stratigraphy, Carbonates, Evaporites, Coal, Petroleum, and Mud Volcanism', '37J3LYFL'],
  ['Planetary Geology, Impact Events, Astronomy, & the Search for Extraterrestrial Life', 'HLV7WMZQ'],
  ['Paleobiology, Mass Extinctions, Fossils, & Evolution', 'VYWX6R2B']
]);

/** @constant {number} zoteroRateLimit - Time in seconds to wait between requests to the Zotero API to avoid rate-limiting */
const zoteroRateLimit = 10;

/**
 *  Updates specified fields for given items in a specified ESOVDB table via {@link esovdb.processUpdates} and then returns the result for logging
 *
 *  @async
 *  @function updateTable
 *  @requires esovdb:processUpdates
 *  @param {Object[]} items - An array of objects formatted as updates for Airtable (i.e. [ { id: 'recordId', fields: { 'Airtable Field': 'value', ... } }, ... ])
 *  @param {string} table - The name of a table in the ESOVDB (e.g., 'Videos', 'Series', etc)
 *  @returns {Object[]} The original array of Zotero items, {@link items}, passed through {@link esovdb:processUpdates}
 *  @sideEffects Makes one or more update requests to defined fields and tables on the ESOVDB
 *  @throws Will throw an error if no response is received from {@link esovdb:processUpdates}
 */

const updateTable = async (items, table) => {
  console.log(`Updating ${Object.keys(items[0].fields).map((field) => `"${field}"`).join(', ')} in "${table}" for ${items.length} item${items.length === 1 ? '' : 's'} on the ESOVDB...`);

  try {
    const response = await processUpdates(items, table);
    
    if (response.length > 0) {
      return response;
    } else {
      throw new Error(`[ERROR] Couldn't update ${items.length} item${items.length === 1 ? '' : 's'}.`);
    }
  } catch (err) {
    console.error(err.message);
  }
};

/**
 *  Fetches a fresh 'videoRecording' template from Zotero with which to structure items in posts to the Zotero API
 *
 *  @async
 *  @function getTemplate
 *  @requires axios
 *  @returns {Object} A Zotero new item template of type 'videoRecording'
 *  @throws Will throw an error if a template is not retrieved from the Zotero API
 *  @see [Zotero Web API 3.0 › Types & Fields › Getting a Template for a New Item]{@link https://www.zotero.org/support/dev/web_api/v3/types_and_fields#getting_a_template_for_a_new_item}
 */

const getTemplate = async () => {
  console.log('Retrieving template from Zotero...');
  try {
    const response = await zotero.get('items/new', { params: { itemType: 'videoRecording' } });

    if (response.data) {
      console.log('› Successfully retrieved template from Zotero.');
      return response.data;
    } else {
      throw new Error(`[ERROR] Couldn't retrieve template from Zotero.`);
    }
  } catch (err) {
    console.error(err.message);
  }
};

/**
 * @typedef {Object} ZoteroResponse
 * @property {?Object[]} successful - An array of succesfully added or updated Zotero item objects
 * @property {?string[]} unchanged - An array of Zotero item keys of Zotero items which remained unchanged after the POST request either because no changes were sent or the version sent was outdated
 * @property {?Object[]} failed - An array of Zotero item objects which failed in their attempts to be added or updated, perhaps due to format/syntactical or structural errors
 */

/**
 *  Adds or updates one or more objects in a Zotero Library depending on whether a given object is passed with Zotero key and version properties and returns a {@link ZoteroResponse} object from the Zotero API.
 *
 *  @async
 *  @function postItems
 *  @requires axios
 *  @param {Object[]} items - An array of objects formatted as Zotero objects according (e.g. items, collections) to the Zotero Web API 3.0 docs
 *  @returns {ZoteroResponse} An object containing an array of successfully added or updated Zotero item objects, an array of Zotero item keys of unchanged Zotero items, and an array of Zotero item objects of Zotero items which failed to be added or updated
 *  @see [Zotero Web API 3.0 › Write Requests › Deleting Multiple Objects]{@link https://www.zotero.org/support/dev/web_api/v3/write_requests#deleting_multiple_items} and [Zotero Web API 3.0 › Write Requests › Deleting Multiple Collections]{@link https://www.zotero.org/support/dev/web_api/v3/write_requests#deleting_multiple_collections}
 */

const postItems = async (path, items) => {
  try {
    const { data } = await zoteroLibrary.post(path, items);
    const successful = Object.values(data.successful);
    const unchanged = Object.values(data.unchanged);
    const failed = Object.values(data.failed);
    if (successful.length > 0) console.log(`› Successfully posted ${successful.length} item${successful.length === 1 ? '' : 's'}.`);
    if (unchanged.length > 0) console.log(`› ${unchanged.length} item${unchanged.length === 1 ? '' : 's'} left unchanged.`);
    
    if (failed.length > 0) { 
      fs.writeFile('.data/failed.json', JSON.stringify(failed), (err) => { if (err) throw new Error('[ERROR] Unable to write failed items to JSON.'); });  
      console.error(`› Failed to post ${failed.length} item${failed.length === 1 ? '' : 's'}.`);
    }
    
    return { successful, unchanged, failed };
  } catch (err) {
    console.error(err.message);
  }
};

/**
 *  Deletes one or more objects from a Zotero Library and returns a {@link ZoteroResponse} object from the Zotero API.
 *
 *  @async
 *  @function deleteItems
 *  @requires axios
 *  @param {string[]} items - An array of one or more Zotero Key strings
 *  @returns {Object} An object containing two arrays of Zotero Key strings, one for successful deletions, and one for failures, and a total number of successes. 
 *  @sideEffects Triggers webhook events 'videos.delete' or 'series.delete', depending on the parameter {@link kind}
 *  @see [Zotero Web API 3.0 › Write Requests › Creating Multiple Objects]{@link https://www.zotero.org/support/dev/web_api/v3/write_requests#creating_multiple_objects}
 */

const deleteItems = async (items, kind, res = false) => {
  let i = 0, deleted = [], queue = items.length;
  
  while (items.length) {
    console.log(`Deleting ${items.length === 1 ? kind.substr(0, kind.length - 1) : kind} ${i * 50 + 1}${items.length > 1 ? '-' : ''}${items.length > 1 ? i * 50 + (items.length < 50 ? items.length : 50) : ''} of ${queue} total from Zotero...`);
    const response = await zoteroLibrary.delete(kind, { params: { [`${kind.substr(0, kind.length - 1)}Key`]: items.splice(0, 50).map((item) => item.zoteroKey).join(',') } });
    if (response.status === 204) deleted = [ ...deleted, true ];
    if (items.length > 50) await sleep(zoteroRateLimit);
    i++;
  }
  
  if (kind === 'items') webhooks.subscriptions.trigger('videos.delete', { data: items });
  else if (kind === 'collections') webhooks.subscriptions.trigger('series.delete', { data: items });
 
  if (!deleted.some((response) => !response) && res) {
    console.log(`› Successfully deleted ${queue} item${queue === 1 ? '' : 's'}.`);
    return res.status(200).send(deleted);
  } else {
    if (res) res.status(404).send(`Unable to sync ${queue} deleted item${queue === 1 ? '' : 's'} with Zotero.`);
    throw new Error(`[ERROR] Unable to sync ${queue} deleted item${queue === 1 ? '' : 's'} with Zotero.`);
  }
};

/**
 *  Converts raw data for a single video from the ESOVDB into a format that can be accepted by Zotero in a single- or multiple-item write request
 *
 *  @async
 *  @function formatItems
 *  @requires fs
 *  @requires util.packageAuthors
 *  @requires util.formatDuration
 *  @requires util.formatDate
 *  @param {Object} video - An object representing a video from the ESOVDB, retrieved from the ESOVDB either through the API or through Airtable's automation feature
 *  @param {Object} template - A valid Zotero item template, retrieved from Zotero using {@link getTemplate}
 *  @returns {Object} A properly-formatted and populated object for use in either a single-item or multiple-item Zotero write request
 *  @sideEffects Can create a new Zotero series collection, and sync that Zotero series collection key back to the series on the ESOVDB
 *  @throws Will throw an error if unable to create a new series collection or sync a series collection key
 *  @see [Zotero Web API 3.0 › Write Requests › Item Requests]{@link https://www.zotero.org/support/dev/web_api/v3/write_requests#item_requests}
 */

const formatItems = async (video, template) => {
  let extras = [];
  video.presenters = packageAuthors(video.presentersFirstName, video.presentersLastName);
  if (video.topic) extras.push({ title: 'Topic', value: video.topic });
  if (video.location) extras.push({ title: 'Location', value: video.location });
  if (video.plusCode) extras.push({ title: 'Plus Code', value: video.plusCode });
  if (video.learnMore) extras.push({ title: 'Learn More', value: video.learnMore });
  
  const presenters = video.presenters.length > 0
      ? video.presenters.map((presenter) => !presenter.firstName || !presenter.lastName
        ? {
            creatorType: 'contributor',
            name: presenter.firstName || '' + presenter.lastName || '',
          }
        : {
            creatorType: 'contributor',
            firstName: presenter.firstName,
            lastName: presenter.lastName,
          })
      : {
          creatorType: 'contributor',
          name: 'Unknown',
        };

  const payload = {
    ...template,
    itemType: 'videoRecording',
    title: video.title || '',
    creators: presenters,
    abstractNote: video.desc || '',
    videoRecordingFormat: video.format || '',
    seriesTitle: video.series || '',
    volume: video.vol ? `${video.vol || ''}:${video.no || ''}` : video.no || '',
    numberOfVolumes: +video.seriesCount > 1 ? video.seriesCount : '',
    place: video.provider || '',
    studio: video.publisher || '',
    date: video.year || '',
    runningTime: formatDuration(video.runningTime) || '',
    language: video.language || '',
    ISBN: '',
    shortTitle: '',
    url: video.url || '',
    accessDate: formatDate(video.accessDate) || '',
    archive: 'Earth Science Online Video Database',
    archiveLocation: `https://airtable.com/appAqhfquNFMRAGhQ/tbl3WP689vHdmg7P2/viwD9Tpr6JAAr97CW/${video.recordId}?blocks=bipKEx011McOmAZW2`,
    libraryCatalog: '',
    callNumber: video.esovdbId || '',
    rights: '',
    extra: extras.map((item) => item.title + ': ' + item.value).join('\n'),
    tags: video.tags ? video.tags.map((tag) => ({ tag })) : [],
    collections: topics.get(video.topic) ? [ topics.get(video.topic) ] : [],
    relations: {},
  };
  
  if (video.zoteroKey && video.zoteroVersion) {
    payload.key = video.zoteroKey;
    payload.version = video.zoteroVersion;
  }
  
  if (video.series) {
    if (video.zoteroSeries) {
      payload.collections.push(video.zoteroSeries);
    } else {
      try {
        const { data } = await postItems('collections', [ { name: video.series, parentCollection: parentCollections.get('series') } ]);

        if (data.successful && Object.values(data.successful).length > 0) {
          console.log(`› Successfully created collection "${video.series}" under "Series".`)
          payload.collections.push(data.successful[0].key);
          const updateSeriesResponse = await updateTable([{ id: video.seriesId, fields: { 'Zotero Key': data.successful[0].key, 'Source': { name: 'Automation' } } }], 'Series');
          
          if (updateSeriesResponse && updateSeriesResponse.length > 0) {
            console.log('› Successfully synced series collection key with the ESOVDB.');
          } else {
            throw new Error('[ERROR] Failed to sync series collection key with the ESOVDB');
         } 
        } else {
          const message = data.failed.length > 1 && data.failed[0].message ? data.failed[0].message : '';
          throw new Error(`[ERROR] Failed to create series collection${message ? ' (' + message + ')' : ''}.`);
        }
      } catch (err) {
        console.error(err.message);
      }
    } 
  }
  
  return payload;
};

/**
 *  Takes a single video or array of videos successfully synced with Zotero and broadcasts them through a specified channel.
 *
 *  @async
 *  @function broadcastItems
 *  @param {string} channel - A string representation of a broadcast/social media channel (e.g. 'discord' or 'twitter')
 *  @param {(Object[])} videos - An array of one or more Zotero response objects, resulting from a successful Zotero sync
 *  @sideEffects Sends a message out as a broadcast to the specified channel, using the video data provided
 *  @returns {Object} A response object from the broadcast channel's web service
 */

const broadcastItems = async (channel, videos) => {
  let results;
  
  if (videos.length > 0) {
    switch (channel) {
      case 'discord':
        console.log('Posting new items to Discord in the #whats-new channel...');

        if (videos.length > 1) {
          results = await webhooks.execute(videos, 'discord', 'newSubmissionTotal')
        } else {
          results = await webhooks.execute(videos[0].data, 'discord', 'newSubmission');
        }

        if (results && results.config.data) console.log(`› Successfully posted to ESOVDB Discord in #whats-new.`);
        else throw new Error('[ERROR] Unable to post to ESOVDB Discord in #whats-new.');
        break;
      case 'twitter':
        console.log('Tweeting new items from @esovdb...');

        if (videos.length > 1) {
          results = await twitter.batchTweet(videos);
        } else {
          results = await twitter.tweet(videos[0].data);
        }

        if (results && results.id) console.log(`› Successfully tweeted from @esovdb.`);
        else throw new Error('[ERROR] Unable to tweet from @esovdb.');
        break;
      default:
        throw new Error('[ERROR] Unknown or invalid broadcast channel.');
    }
  }
}

/**
 *  Takes a single ESOVDB series record or an array of ESOVDB series records from Airtable sent through either POST or PUT [requests]{@link req} to this server's /zotero/collections API endpoint, maps those requested series objects to an array valid new or updated Zotero collections (depending on whether a Zotero key and version are passed), attempts to POST that array of formatted collections to a Zotero library using {@link postItems}, and then syncs the updated Zotero version (if updated) or newly acquired Zotero key and version (if created) back with the ESOVDB for each collection successfully posted to the Zotero library, using {@link updateTable}, sending a server response of 200 with the JSON of any successfully updated/added collections.
 *
 *  @async
 *  @function processCollections
 *  @param {(Object|Object[])} series - A single object or array of objects representing records from the ESOVDB series table in Airtable sent through an ESOVDB Airtable automation
 *  @param {('create'|'update)} op - String representation of the current batch operation 
 *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
 *  @sideEffects Formats new or updated collections to be compatible with Zotero, posts them to Zotero, triggers webhook events "series.create" or "series.update", depending on the parameter {@link op}
 */

const processCollections = async (series, op, res = null) => {
  const collections = series.map((collection) => {
    const payload = {
      name: collection.name,
      parentCollection: parentCollections.get('series')
    };
    
    if (collection.zoteroKey && collection.zoteroVersion) {
      payload.key = collection.zoteroKey;
      payload.version = collection.zoteroVersion;
    }
    
    return payload;
  });

  let i = 0,
    totalSuccessful = 0,
    totalUnchanged = 0,
    totalFailed = 0,
    posted = [],
    queue = collections.length;

  while (collections.length) {
    console.log(
      `Posting series collection${collections.length === 1 ? '' : 's'} ${
        i * 50 + 1
      }${collections.length > 1 ? '-' : ''}${
        collections.length > 1
          ? i * 50 +
            (collections.length < 50
              ? collections.length
              : 50)
          : ''
      } of ${queue} total to Zotero...`
    );
    
    let { successful, unchanged, failed } = await postItems('collections', collections.splice(0, 50));
    if (successful && successful.length > 0) posted = [ ...posted, ...successful ];
    totalSuccessful += successful.length;
    totalUnchanged += unchanged.length;
    totalFailed += failed.length;
    if (collections.length > 50) await sleep(zoteroRateLimit);
    i++;
  }

  console.log('Zotero response summary:');
  if (totalSuccessful > 0) console.log(`› [${totalSuccessful}] series collection${totalSuccessful === 1 ? '' : 's'} total added or updated.`);
  if (totalUnchanged > 0) console.log(`› [${totalUnchanged}] series collection${totalUnchanged === 1 ? '' : 's'} total left unchanged.`);
  if (totalFailed > 0) console.log(`› [${totalFailed}] series collection${totalFailed === 1 ? '' : 's'} total failed to add or update.`);
  
  if (posted.length > 0) {
    const collectionsToSync = posted.map(({ data: collection }) => ({
      id: series.filter((s) => s.name === collection.name)[0].id,
      fields: {
        'Zotero Key': collection.key,
        'Zotero Version': collection.version
      }
    }));
    
    if (op === 'create') webhooks.subscriptions.trigger('series.create', { data: posted });
    else if (op === 'update') webhooks.subscriptions.trigger('series.update', { data: posted });
    
    const updated = await updateTable(collectionsToSync, 'Series');

    if (updated && updated.length > 0) {
      console.log(`› [${updated.length}] collection${updated.length === 1 ? '\'s' : 's\''} Zotero key and version synced with the ESOVDB.`);
      if (res) res.status(200).send(JSON.stringify(updated));
    } else {
      if (res) res.status(404).send('Unable to sync Zotero collection updates with the ESOVDB.');
      throw new Error('[ERROR] Error syncing collections with the ESOVBD.');
    }
  } else {
    if (res) res.status(404).send('No collections were posted to Zotero.');
  }
}

/**
 *  Takes a single ESOVDB video record or an array of ESOVDB video records from Airtable sent through either POST or PUT [requests]{@link req} to this server's zotero/items API endpoint, retrieves a new item template from the Zotero API using {@link getTemplate}, maps those requested video objects to an array valid new or updated Zotero items (depending on whether a Zotero key and version are passed) using {@link formatItems}, attempts to POST that array of formatted items to a Zotero library using {@link postItems}, and then syncs the updated Zotero version (if updated) or newly acquired Zotero key and version (if created) back with the ESOVDB for each item successfully posted to the Zotero library, using {@link updateTable}, sending a server response of 200 with the JSON of any successfully updated/added items.
 *
 *  @async
 *  @function processItems
 *  @param {(Object|Object[])} videos - A single object or array of objects representing records from the ESOVDB videos table in Airtable, either originally retrieved through this server's esovdb/videos/list endpoint, or sent through an ESOVDB Airtable automation
 *  @param {('create'|'update)} op - String representation of the current batch operation 
 *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
 *  @sideEffects Formats new or updated items to be compatible with Zotero, posts them to Zotero, and then tweets and sends a message on Discord if data represents one or more new items, triggers webhook events "videos.create" or "videos.update", depending on the parameter {@link op}
 */

const processItems = async (videos, op, res = null) => {
  const template = await getTemplate();
  let items = await queueAsync(videos.map((video) => async () => await formatItems(video, template)));

  let i = 0,
    totalSuccessful = 0,
    totalUnchanged = 0,
    totalFailed = 0,
    posted = [],
    queue = items.length;

  while (items.length) {
    console.log(
      `Posting item${items.length === 1 ? '' : 's'} ${
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

    let { successful, unchanged, failed } = await postItems('items', items.splice(0, 50));
    if (successful && successful.length > 0) posted = [ ...posted, ...successful ];
    totalSuccessful += successful.length;
    totalUnchanged += unchanged.length;
    totalFailed += failed.length;
    if (items.length > 50) await sleep(zoteroRateLimit);
    i++;
  }

  console.log('Zotero response summary:');
  if (totalSuccessful > 0) console.log(`› [${totalSuccessful}] item${totalSuccessful === 1 ? '' : 's'} total added or updated.`);
  if (totalUnchanged > 0) console.log(`› [${totalUnchanged}] item${totalUnchanged === 1 ? '' : 's'} total left unchanged.`);
  if (totalFailed > 0) console.log(`› [${totalFailed}] item${totalFailed === 1 ? '' : 's'} total failed to add or update.`);

  if (posted.length > 0) {
    const itemsToSync = posted.map((item) => ({
      id: item.data.archiveLocation.match(/rec[\w]{14}$/)[0],
      fields: {
        'Zotero Key': item.key,
        'Zotero Version': item.version,
      }
    }));

    if (op === 'create') {
      const itemsToBroadcast = posted.map((item) => ( { data: { ...item.data, muted: videos.filter((video) => video.esovdbId === item.data.callNumber).shift().muted, featured: videos.filter((video) => video.esovdbId === item.data.callNumber).shift().featured }})).filter((item) => !item.data.muted);
      webhooks.subscriptions.trigger('videos.create', { data: posted });
      await broadcastItems('discord', itemsToBroadcast);
      await broadcastItems('twitter', itemsToBroadcast);
    } else if (op === 'update') {
      webhooks.subscriptions.trigger('videos.update', { data: posted });
    }

    const updated = await updateTable(itemsToSync, 'Videos');

    if (updated && updated.length > 0) {
      console.log(`› [${updated.length}] item${updated.length === 1 ? '\'s' : 's\''} Zotero key and version synced with the ESOVDB.`);
      if (res) res.status(200).send(JSON.stringify(updated));
    } else {
      if (res) res.status(404).send('Unable to sync Zotero item updates with the ESOVDB.');
      throw new Error('[ERROR] Error syncing items with the ESOVBD.');
    }
  } else {
    if (res) res.status(404).send('No items were posted to Zotero.');
  }
}

let timer;

/** @constant {Subject} itemsStream - Multicast observable subject that emits on each http PUT request to '/zotero/items' */
const itemsStream = new Subject();

/** @constant {Subject} collectionsStream - Multicast observable subject that emits on each http PUT request to '/zotero/collections' */
const collectionsStream = new Subject();

/** @constant {Observable} onComplete - Observable which instantly emits its complete notification */
const onComplete$ = new Observable(subscriber => { subscriber.complete(); });

/** @constant {Observer} itemsObserver - Subscribes to updates {@link stream} that are items. Observable generated from http PUT requests to '/zotero/items' */
const itemsObserver = {
    next: async ([ req, res ]) => {
      const data = await batch.append('items', 'update', Array.isArray(req.body) ? req.body : Array.of(req.body));
      console.log(`› Added item ${data.length} to batch.`);
      res.status(202).send(data);
      clearTimeout(timer);
      timer = setTimeout(() => { onComplete$.subscribe(itemsObserver); }, batch.interval()); 
    },
    err: (err) => { console.error(err) },
    complete: async () => {
      const data = await batch.get('items', 'update');
      processItems(data.sort(sortDates), 'update');   
      console.log(`› Successfully batch updated ${data.length} item${data.length > 1 ? '' : 's'}.`);
      await batch.clear('items', 'update');
      clearTimeout(timer);
    }
};

/** @constant {Observer} collectionsObserver - Subscribes to updates {@link stream} that are collections. Observable generated from http PUT requests to '/zotero/collections' */
const collectionsObserver = {
    next: async ([ req, res ]) => {
      const data = await batch.append('collections', 'update', Array.isArray(req.body) ? req.body : Array.of(req.body));
      console.log(`› Added collection ${data.length} to batch for update.`);
      res.status(202).send(data);
      clearTimeout(timer);
      timer = setTimeout(() => { onComplete$.subscribe(collectionsObserver); }, batch.interval()); 
    },
    err: (err) => { console.error(err) },
    complete: async () => {
      const data = await batch.get('collections', 'update');
      processCollections(data, 'update');
      console.log(`› Successfully batch updated ${data.length} collection${data.length > 1 ? '' : 's'}.`);
      await batch.clear('collections', 'update');
      clearTimeout(timer);
    }
};

/** @constant {Subscription} itemsSubscription - Subscription created from observing {@link itemsStream} with {@link itemsObserver} */
const itemsSubscription = itemsStream.subscribe(itemsObserver);

/** @constant {Subscription} collectionsSubscription - Subscription created from observing {@link collectionsStream} with {@link collectionsObserver} */
const collectionsSubscription = collectionsStream.subscribe(collectionsObserver);

module.exports = {
  
  /**
   *  Takes a single ESOVDB record or an array of ESOVDB records from Airtable sent through either POST or PUT [requests]{@link req} to this server's /zotero/:kind API endpoint, and then either processes it singularly or uses Redis sets to create a batch of multiple items to be processed together.
   *
   *  @async
   *  @method sync
   *  @requires batch
   *  @requires rxjs
   *  @requires redis
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {(Object|Object[])} req.body - A single object or array of objects representing records from the ESOVDB videos table in Airtable, sent through an ESOVDB Airtable automation
   *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
   *  @sideEffects Takes data received through the '/zotero/:kind' endpoint, creates a Redis set for created records, and Observable stream that populates a Redis set within a time window for updated records, and finally sends the batch to be processed
   */
  
  sync: async (req, res) => {
    try {
      const kind = req.params.kind;
      const op = getOp(req);
      const records = Array.isArray(req.body) ? req.body : Array.of(req.body);
      
      switch (op) {
        case 'create':
          if (records[0].batch && records[0].batchSize > 1) {
            let data = [];
            await batch.size(kind, op) === 0 && console.log(`Processing batch create request of ${records[0].batchSize} ${kind}…`);
            data = await batch.append(op, kind, records);
            console.log(`› Added ${kind.substr(0, kind.length - 1)} ${data.length} of ${records[0].batchSize} to batch for creation.`);
            
            if (await batch.size(kind, op) >= records[0].batchSize) {
              await batch.clear(kind, op);
              switch (kind) {
                case 'items':
                  await processItems(data.sort(sortDates), op, res);
                  break;
                case 'collections':
                  await processCollections(data, op, res);
                  break;
                default:
                  return res.status(400).send(`[ERROR] Unrecognized kind, "${kind}".`);
              }
              console.log(`› Successfully batch created ${records[0].batchSize} ${kind}.`);
            } else {
              return res.status(202).send(data);
            }
          } else {
            console.log(`Processing single create ${kind.substr(0, kind.length - 1)} request…`);
            switch (kind) {
              case 'items':
                await processItems(records, op, res);
                break;
              case 'collections':
                await processCollections(records, op, res);
                break;
              default:
                return res.status(400).send(`[ERROR] Unrecognized kind, "${kind}".`);
            }
            console.log(`› Successfully created the new ${kind.substr(0, kind.length - 1)}.`);
          }
          break;
        case 'update':
          console.log(`Processing update ${kind} request (length unknown)…`);
          switch (kind) {
            case 'items':
              itemsStream.next([ req, res ]);
              break;
            case 'collections':
              collectionsStream.next([ req, res ]);
              break;
            case 'collections-count':
              await processItems(records, op, res);
              break;
            default:
              return res.status(400).send(`[ERROR] Unrecognized kind, "${kind}".`);
          }
          break;
        case 'delete':
          if (records[0].batch && records[0].batchSize > 50) {
            let data = [];
            await batch.size(kind, op) === 0 && console.log(`Processing batch delete request of ${records[0].batchSize} ${kind}…`);
            data = await batch.append(op, kind, records);
            console.log(`› Added ${kind.substr(0, kind.length - 1)} ${data.length} of ${records[0].batchSize} to batch for deletion.`);
            
            if (await batch.size(kind, op) >= records[0].batchSize) {
              await batch.clear(kind, op);
              await deleteItems(data, kind, res);
              console.log(`› Successfully batch deleted ${records[0].batchSize} ${kind}.`);
            } else {
              return res.status(202).send(data);
            }
          } else {
            console.log(`Processing delete request for ${records.length} ${kind.substr(0, kind.length - 1)}${records.length === 1 ? '' : 's'}…`);
            await deleteItems(records, kind, res);
          }
          break;
        default:
          return res.status(400).send('Invalid operation.');
      }
    } catch (err) {
      console.error(err.message);
    }
  }
}