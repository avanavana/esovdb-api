/**
 *  @file ESOVDB Airtable API methods
 *  @author Avana Vana <dear.avana@gmail.com>
 *  @module esovdb
 *  @see {@link https://airtable.com/shrFBKQwGjstk7TVn|The Earth Science Online Video Database}
 */

const dotenv = require('dotenv').config();
const Airtable = require('airtable');
const Bottleneck = require('bottleneck');
const cache = require('./cache');
const { formatDuration, formatDate, packageAuthors, sleep } = require('./util');

const base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY,
}).base(process.env.AIRTABLE_BASE_ID);

/** @constant {Map} tables - Maps request table params to their proper names on the ESOVDB */
const tables = new Map([
  ['videos', 'Videos'],
  ['series', 'Series'],
  ['topics', 'Topics'],
  ['tags', 'Tags'],
  ['organizations', 'Organizations'],
  ['people', 'People'],
  ['submissions', 'Submissions'],
  ['issues', 'Issues']
]);

/** @constant {number} airtableRateLimit - Minimum time in ms to wait between requests using {@link Bottleneck} (default: 201ms ⋍ just under 5 req/s) */
const airtableRateLimit = 1005 / 5;

/** @constant {RegExp} regexYT - Regular expression for matching and extracting a YouTube videoId from a URL or on its own */
const regexYT = /^(?!rec)(?![\w\-]{12,})(?:.*youtu\.be\/|.*v=)?([\w\-]{10,12})&?.*$/;

const rateLimiter = new Bottleneck({ minTime: airtableRateLimit });

module.exports = {
  
  /**
   *  Retrieves a query of videos by first checking the cache for a matching, fresh request, and otherwise performs an Airtable select() API query, page by page {@link req.query.pageSize} videos at a time (default=100), until all or {@link req.query.maxRecords}, if specified, using Botleneck for rate-limiting.  
   *
   *  @method queryVideos
   *  @requires Airtable
   *  @requires Bottleneck
   *  @requires cache
   *  @requires util
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {?number} [req.params.pg] - An Express.js route param optionally passed after videos/query, which specifies which page (one-indexed) of a given {@link pageSize} number records should be sent in the [server response]{@link res}
   *  @param {number} [req.query.pageSize=100] - An [http request]{@link req} URL query param that specifies how many Airtable records to return in each API call
   *  @param {?number} [req.query.maxRecords] - An [http request]{@link req} URL query param that specifies the maximum number of Airtable records that should be sent in the [server response]{@link res}
   *  @param {?string} [req.query.createdAfter] - An [http request]{@link req} URL query param, in the format of a date string, parseable by Date.parse(), used to create a filterByFormula in an Airtable API call that returns only records created after the date in the given string
   *  @param {?string} [req.query.modifiedAfter] - An [http request]{@link req} URL query param, in the format of a date string, parseable by Date.parse(), used to create a filterByFormula in an Airtable API call that returns only records modified after the date in the given string
   *  @param {?string} [req.query.youTube] - A YouTube video's URL, short URL, or video ID
   *  @param {(!express:Response|Boolean)} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class, or false if not passed
   *  @sideEffects Queries the ESOVDB Airtable base, page by page, and either sends the retrieved data as JSON within an HTTPServerResponse object, or returns it as a JavaScript object
   *  @returns {Object[]} Array of ESOVDB video records as JavaScript objects (if no {@link res} object is provided)
   */
  
  queryVideos: (req, res = false) => {
    if (!req.params) req.params = {};
    if (!req.query) req.query = {};
    req.params.pg = !req.params.pg || !Number(req.params.pg) || +req.params.pg < 0 ? null : +req.params.pg - 1;
    
    if (!req.query.pageSize || !Number(req.query.pageSize || req.query.pageSize > 100)) {
      req.query.pageSize = 100;
    }
    
    if (!Number(req.query.maxRecords || req.query.maxRecords == 0)) {
      req.query.maxRecords = null;
    }
    
    if (req.query.maxRecords && +req.query.maxRecords < +req.query.pageSize) {
      req.query.pageSize = req.query.maxRecords;
    }
    
    let modifiedAfter,
        modifiedAfterDate,
        createdAfter,
        createdAfterDate,
        likeYTID;
    
    if (
      req.query.modifiedAfter &&
      typeof Date.parse(decodeURIComponent(req.query.modifiedAfter)) === 'number' &&
      Date.parse(decodeURIComponent(req.query.modifiedAfter)) > 0
    ) {
      modifiedAfter = Date.parse(decodeURIComponent(req.query.modifiedAfter));
      modifiedAfterDate = new Date(modifiedAfter);
    }

    if (
      req.query.createdAfter &&
      typeof Date.parse(decodeURIComponent(req.query.createdAfter)) === 'number' &&
      Date.parse(decodeURIComponent(req.query.createdAfter)) > 0
    ) {
      createdAfter = Date.parse(decodeURIComponent(req.query.createdAfter));
      createdAfterDate = new Date(createdAfter);
    }
    
    if (req.query.youTube && regexYT.test(decodeURIComponent(req.query.youTube))) likeYTID = regexYT.exec(decodeURIComponent(req.query.youTube))[1];
    
    let queryText = req.params.pg !== null
      ? `for page ${req.params.pg + 1} (${req.query.pageSize} results per page)`
      : `(${req.query.pageSize} results per page, ${req.query.maxRecords ? 'up to ' + req.query.maxRecords : 'for all'} results)`;
    
    queryText += modifiedAfterDate ? ', modified after ' + modifiedAfterDate.toLocaleString() : '';
    queryText += createdAfterDate ? ', created after ' + createdAfterDate.toLocaleString() : '';
    queryText += likeYTID ? `, matching YouTube ID "${likeYTID}"` : '';
    
    console.log(`Performing videos/query ${res ? 'external' : 'internal'} API request ${queryText}…`);

    const cachePath = `.cache${req.url}.json`;
    const cachedResult = cache.readCacheWithPath(cachePath);

    if (cachedResult !== null) {
      console.log('Cache hit. Returning cached result for ' + req.url);
      if (res) res.status(200).send(JSON.stringify(cachedResult));
      else return cachedResult;
    } else {
      console.log('Cache miss. Loading from Airtable for ' + req.url);

      let pg = 0;
      const ps = +req.query.pageSize;
      let filterStrings = [];
      let options = {
        pageSize: ps,
        view: 'All Online Videos',
        sort: [{ field: 'Modified', direction: 'desc' }],
        fields: [
          'Zotero Key',
          'Zotero Version',
          'Series Zotero Key',
          'Title',
          'URL',
          'Year',
          'Description',
          'Running Time',
          'Format',
          'Topic',
          'Tags',
          'Learn More',
          'Series Text',
          'Series Count Text',
          'Vol.',
          'No.',
          'Publisher Text',
          'Presenter First Name',
          'Presenter Last Name',
          'Language Code',
          'Location',
          'Plus Code',
          'Video Provider',
          'ESOVDBID',
          'Record ID',
          'ISO Added',
          'Created',
          'Modified'
        ],
      };

      if (req.query.maxRecords && !req.params.pg) options.maxRecords = +req.query.maxRecords;
      if (modifiedAfter) filterStrings.push(`IS_AFTER({Modified}, DATETIME_PARSE(${modifiedAfter}))`);
      if (createdAfter) filterStrings.push(`IS_AFTER(CREATED_TIME(), DATETIME_PARSE(${createdAfter}))`);
      if (likeYTID) filterStrings.push(`REGEX_MATCH({URL}, "${likeYTID}")`);
      if (filterStrings.length > 0) options.filterByFormula = `AND(${filterStrings.join(',')})`;
      
      let data = [];

      rateLimiter.wrap(
        base('Videos')
          .select(options)
          .eachPage(
            function page(records, fetchNextPage) {
              if (!req.params.pg || pg == req.params.pg) {
                console.log(`Retrieving records ${pg * ps + 1}-${(pg + 1) * ps}…`);
                
                records.forEach((record) => {
                  let row = {
                    zoteroKey: record.get('Zotero Key') || '',
                    zoteroVersion: record.get('Zotero Version') || null,
                    zoteroSeries: record.get('Series Zotero Key') || '',
                    title: record.get('Title') || '',
                    url: record.get('URL') || '',
                    year: record.get('Year') || null,
                    desc: record.get('Description') || '',
                    runningTime: formatDuration(record.get('Running Time')) || '',
                    format: record.get('Format') || '',
                    topic: record.get('Topic') || '',
                    tags: record.get('Tags') || [],
                    learnMore: record.get('Learn More'),
                    series: record.get('Series Text') || '',
                    seriesCount: +record.get('Series Count Text') || '',
                    vol: record.get('Vol.') || null,
                    no: record.get('No.') || null,
                    publisher: record.get('Publisher Text') || '',
                    presenters: packageAuthors(
                      record.get('Presenter First Name'),
                      record.get('Presenter Last Name')
                    ),
                    language: record.get('Language Code') || '',
                    location: record.get('Location') || '',
                    plusCode: record.get('Plus Code') || '',
                    provider: record.get('Video Provider') || '',
                    esovdbId: record.get('ESOVDBID') || '',
                    recordId: record.get('Record ID') || '',
                    accessDate: formatDate(record.get('ISO Added')) || '',
                    created: record.get('Created'),
                    modified: record.get('Modified'),
                  };

                  data.push(row);
                });

                if (pg == req.params.pg) {
                  console.log(`[DONE] Retrieved ${data.length} records.`);
                  cache.writeCacheWithPath(cachePath, data);
                  if (res) return res.status(200).send(JSON.stringify(data));
                } else {
                  console.log(`Successfully retrieved ${records.length} records.`);
                }

                pg++;
                fetchNextPage();
              } else {
                pg++;
                fetchNextPage();
              }
            },
            function done(err) {
              if (err) {
                console.error(err);
                if (res) return res.status(400).send(JSON.stringify(err));
                else throw new Error(err.message);
              } else {
                console.log(`[DONE] Retrieved ${data.length} records.`);
                cache.writeCacheWithPath(cachePath, data);
                if (res) return res.status(200).send(JSON.stringify(data));
              }
            }
          )
      );
      
      if (!res) return data;
    }
  },
  
  /**
   *  Retrieves a list of ESOVDB videos that are on YouTube by first checking the cache for a matching, fresh request, and otherwise performs an Airtable select() API query for 100 videos, sorted by oldest first, using Bottleneck for rate-limiting.  
   *
   *  @method queryYouTubeVideos
   *  @requires Airtable
   *  @requires Bottleneck
   *  @requires cache
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {string} [req.params.id] - A YouTube video's URL, short URL, or video ID, passed last, as a required URL parameter
   *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
   *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
   *  @sideEffects Queries the ESOVDB Airtable base, page by page, and either sends the retrieved data as JSON within an HTTPServerResponse object, or returns it as a JavaScript object
   *  @returns {Object} Object with collection or properties for identifying and linking to an ESOVDB record on YouTube
   */
  
  queryYouTubeVideos: (req, res) => {    
    let videoId;
    
    if (req.params.id && regexYT.test(decodeURIComponent(req.params.id))) {
      videoId = regexYT.exec(decodeURIComponent(req.params.id))[1];
    } else {
      if (res) {
        return res.status(400).send('Missing parameter "id".');
      } else {
        throw new Error('Missing parameter "id".');
      }
    }
    
    console.log(`Performing videos/youtube ${res ? 'external' : 'internal'} API request for YouTube ID "${videoId}"…`);

    const cachePath = `.cache${req.url}.json`;
    const cachedResult = cache.readCacheWithPath(cachePath);

    if (cachedResult !== null) {
      console.log('Cache hit. Returning cached result for ' + req.url);
      if (res) return res.status(200).send(JSON.stringify(cachedResult));
      else return cachedResult;
    } else {
      console.log('Cache miss. Loading from Airtable for ' + req.url);

      let options = {
        pageSize: 1,
        maxRecords: 1,
        view: 'All Online Videos',
        sort: [{ field: 'Created' }],
        filterByFormula: `AND({Video Provider} = 'YouTube', REGEX_MATCH({URL}, "${videoId}"))`,
        fields: [
          'YouTube Video ID',
          'Record ID',
          'ESOVDBID',
          'Zotero Key',
          'ISO Added'
        ],
      };
      
      let data = [];
      
      rateLimiter.wrap(
        base('Videos')
          .select(options)
          .eachPage(
            function page(records, fetchNextPage) {
                records.forEach((record) => {
                  let row = {
                    videoId: record.get('YouTube Video ID') || '',
                    recordId: record.get('Record ID') || '',
                    esovdbId: record.get('ESOVDBID') || '',
                    zoteroKey: record.get('Zotero Key') || '',
                    added: formatDate(record.get('ISO Added')) || ''
                  };

                  data.push(row);
                });
              
                fetchNextPage();
            },
            function done(err) {
              if (err) {
                console.error(err);
                if (res) res.status(400).end(JSON.stringify(err));
                else throw new Error(err.message);
              } else {
                if (data.length > 0) {
                  console.log(`[DONE] Retrieved matching record.`);
                  cache.writeCacheWithPath(cachePath, data[0]);
                  if (res) return res.status(200).send(JSON.stringify(data[0]));
                } else {
                  console.error(`[ERROR] Unable to find matching record.`);
                  if (res) return res.status(404).send('Unable to find matching record.');
                }
              }
            }
          )
      );
      
      if (!res && data.length > 0) return data[0];
    }
  },
  
  /**
   *  Updates one or more Airtable records using the non-destructive Airtable update() method, at most 10 at a time, until all provided records have been updated, using Bottleneck for rate-limiting.
   *
   *  @method processUpdates
   *  @requires Airtable
   *  @requires Bottleneck
   *  @param {Object[]} items - An array of objects formatted as updates for Airtable (i.e. [ { id: 'recordId', fields: { 'Airtable Field': 'value', ... } }, ... ])
   *  @param {string} table - The name of a table in the ESOVDB (e.g., 'Videos', 'Series', etc)
   *  @returns {Object[]} The original array of video update objects, {@link videos}, passed to {@link processUpdates}
   */
  
  processUpdates: (items, table) => {
    let i = 0, updates = [ ...items ], queue = items.length;

    while (updates.length) {
      console.log(
        `Updating record${updates.length === 1 ? '' : 's'} ${
          i * 10 + 1
        }${updates.length > 1 ? '-' : ''}${
          updates.length > 1
            ? i * 10 +
              (updates.length < 10
                ? updates.length
                : 10)
            : ''
        } of ${queue} total…`
      );

      i++, rateLimiter.wrap(base(table).update(updates.splice(0, 10)));
    }
    
    return items;
  },
  
  /**
   *  Passes the body of an HTTP POST request to this server on to {@link processUpdates} for updating records on Airtable and sends a 200 server response with the array of objects originally passed to it in the [request body]{@link req.body}.
   *
   *  @async
   *  @method updateTable
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {Object[]} req.body - An array of objects formatted as updates for Airtable (i.e. [ { id: 'recordId', fields: { 'Airtable Field': 'value', ... } }, ... ]) passed as the body of the [server request]{@link req}
   *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
   */
  
  updateTable: async (req, res) => {
    if (req.body.length > 0) {
      console.log(`Performing ${req.params.table}/update API request for ${req.body.length} record${req.body.length === 1 ? '' : 's'}…`);
      const data = await module.exports.processUpdates(req.body, tables.get(req.params.table));
      res.status(200).send(JSON.stringify(data));
    }
  },
  
  /**
   *  Merges previously cached ESOVDB videos data (the vast majority of all videos in the DB) with videos modified in the past 24 hours.
   *
   *  @async
   *  @method updateLatest
   *  @param {Boolean} [useCache=true] - Whether or not data on the 'latest' data (i.e. modifications to ESOVDB videos data made in the past 24 hours) should be pulled from the cache, or freshly retrieved from the ESOVDB Airtable
   *  @sideEffects Reads from and writes to (overwrites) a JSON file containing all video data in the ESOVDB with any modifications made in the past 24 hours
   *  @returns {Object[]} Returns all ESOVDB videos data with any (if there are any) modifications made in the past 24 hours
   */
  
  updateLatest: async (useCache = true) => {
    let result, lastTime = new Date(); lastTime.setHours(0); lastTime.setMinutes(0); lastTime.setSeconds(0); lastTime.setMilliseconds(0); lastTime.setDate(lastTime.getDate() - 1);
    const modifiedAfter = encodeURIComponent(lastTime.toLocaleString());
    const existing = cache.readCacheWithPath('.cache/v1/videos/query/all.json', false);
    const cachedModified = useCache ? cache.readCacheWithPath('.cache/v1/videos/query/latest.json') : null;
    const modified = cachedModified ? cachedModified : await module.exports.queryVideos({ url: 'v1/videos/query/latest', query: { modifiedAfter } });
    await sleep(5);

    if (modified.length > 0) {
      result = [ ...existing.filter((e) => !modified.some((m) => m.recordId === e.recordId)), ...modified ].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
      cache.writeCacheWithPath('.cache/v1/videos/query/all.json', result);
      console.log('› Overwrote existing video data with modified videos and rewrote cache.');
    } else {
      result = existing;
      console.log('› Retrieved existing video data, no new videos to cache.');
    }
    
    console.log(`[DONE] Successfully retrieved ${result.length} videos.`);
    return result;
  },
  
  /**
   *  Passes the body of an HTTP POST request to this server on to {@link updateLatest}, which merges previously cached ESOVDB videos data (the vast majority of all videos in the DB) with videos modified in the past 24 hours.
   *
   *  @async
   *  @method getLatest
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {Object[]} req.body - An array of objects formatted as updates for Airtable (i.e. [ { id: 'recordId', fields: { 'Airtable Field': 'value', ... } }, ... ]) passed as the body of the [server request]{@link req}
   *  @param {!express:Response} [res=false] - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class or Boolean false, by default, which allows the function to distinguish between external clients, which need to be sent an HTTPServerResponse object, and internal usage of the function, which need to return a value
   *  @sideEffects Overwrites a JSON file containing all video data in the ESOVDB with any modifications made in the past 24 hours. If {@link res} is provided, sends an HTTPServerResponse object to the requesting client
   *  @returns {Object[]} If {@link res} is not provided (i.e. internal consumption of this API method), returns all ESOVDB videos data with any modifications made in the past 24 hours
   */
  
  getLatest: async (req, res = false) => {
    try {
      console.log(`Performing videos/all ${res ? 'external' : 'internal'} API request…`);
      const latest = await module.exports.updateLatest(req.headers && req.headers['esovdb-no-cache'] && req.headers['esovdb-no-cache'] === process.env.ESOVDB_NO_CACHE ? false : true);
      if (res) res.status(200).send(JSON.stringify(latest));
      else return latest;
    } catch (err) {
      if (res) res.status(400).end(JSON.stringify(err));
      else throw new Error(err.message);
    }
  }
};
