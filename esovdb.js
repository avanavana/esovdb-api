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
        createdAfterDate;
    
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
    
    let queryText = req.params.pg !== null
      ? `for page ${req.params.pg + 1} (${req.query.pageSize} results per page)`
      : `(${req.query.pageSize} results per page, ${req.query.maxRecords ? 'up to ' + req.query.maxRecords : 'for all'} results)`;
    
    queryText += modifiedAfterDate ? ', modified after ' + modifiedAfterDate.toLocaleString() : '';
    queryText += createdAfterDate ? ', created after ' + createdAfterDate.toLocaleString() : '';
    
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
      if (modifiedAfter) options.filterByFormula = `IS_AFTER({Modified}, DATETIME_PARSE(${modifiedAfter}))`;
      if (createdAfter) options.filterByFormula = `IS_AFTER(CREATED_TIME(), DATETIME_PARSE(${createdAfter}))`;
      
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
                    zoteroVersion: record.get('Zotero Version') || '',
                    zoteroSeries: record.get('Series Zotero Key') || '',
                    title: record.get('Title') || '',
                    url: record.get('URL') || '',
                    year: record.get('Year') || '',
                    desc: record.get('Description') || '',
                    runningTime: formatDuration(record.get('Running Time')) || '',
                    format: record.get('Format') || '',
                    topic: record.get('Topic'),
                    learnMore: record.get('Learn More'),
                    series: record.get('Series Text') || '',
                    seriesCount: record.get('Series Count Text') || '',
                    vol: record.get('Vol.') || '',
                    no: record.get('No.') || '',
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
                if (res) res.status(400).end(JSON.stringify(err));
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
   *  Retrieves a query of YouTube videos by first checking the cache for a matching, fresh request, and otherwise performs an Airtable select() API query for 200 videos (the maximum that can be uploaded to a YouTube playquery in a day), 100 videos at a time, sorted by oldest first, using Botleneck for rate-limiting.  
   *
   *  @method queryYouTubeVideos
   *  @requires Airtable
   *  @requires Bottleneck
   *  @requires cache
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {?number} [req.params.pg] - An Express.js route param optionally passed after videos/youtube, which specifies which page (one-based) the [server response]{@link res} should start from—every response sends two pages of 100 records each, for a maximum of 200 (based on YouTube's quota for adding to playquerys)
   *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
   *  @param {(!express:Response|Boolean)} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class, or false if not passed
   *  @sideEffects Queries the ESOVDB Airtable base, page by page, and either sends the retrieved data as JSON within an HTTPServerResponse object, or returns it as a JavaScript object
   *  @returns {Object[]} Array of ESOVDB YouTube video records as JavaScript objects (if no {@link res} object is provided)
   */
  
  queryYouTubeVideos: (req, res = null) => {
    if (!req.params) req.params = {};
    if (!req.query) req.query = {};
    req.params.pg = !req.params.pg || !Number(req.params.pg) || +req.params.pg < 0 ? null : +req.params.pg - 1;
    
    let queryText = req.params.pg !== null
      ? `for pages ${req.params.pg + 1}-${req.params.pg + 2}, 100 records per page`
      : 'for all records, 100 at a time';
    
    console.log(`Performing videos/youtube ${res ? 'external' : 'internal'} API request ${queryText}…`);

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
      const options = {
        pageSize: 100,
        view: 'All Online Videos',
        sort: [{ field: 'Created' }],
        filterByFormula: `{Video Provider} = 'YouTube'`,
        fields: [
          'Title',
          'YouTube Video ID',
          'Topic'
        ],
      };
      
      if (Number(req.params.pg) && req.params.pg > 0) options.maxRecords = 200;
      
      let data = [];
      
      rateLimiter.wrap(
        base('Videos')
          .select(options)
          .eachPage(
            function page(records, fetchNextPage) {
              if (!req.params.pg || pg == req.params.pg) {
                console.log(`Retrieving records ${pg * 100 + 1}-${(pg + 1) * 100}…`);

                records.forEach((record) => {
                  let row = {
                    title: record.get('Title') || '',
                    videoId: record.get('YouTube Video ID') || '',
                    topic: record.get('Topic') || ''
                  };

                  data.push(row);
                });

                console.log(`Successfully retrieved ${records.length} records.`);

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
                if (res) res.status(400).end(JSON.stringify(err));
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
  
  updateLatest: async (useCache = true) => {
    let result, lastTime = new Date(); lastTime.setHours(0); lastTime.setMinutes(0); lastTime.setSeconds(0); lastTime.setMilliseconds(0); lastTime.setDate(lastTime.getDate() - 1);
    const modifiedAfter = encodeURIComponent(lastTime.toLocaleString());
    const existing = cache.readCacheWithPath('.cache/videos/query/all.json', false);
    const cachedModified = useCache ? cache.readCacheWithPath('.cache/videos/query/latest.json') : null;
    const modified = cachedModified ? cachedModified : await module.exports.queryVideos({ url: '/videos/query/latest', query: { modifiedAfter } });
    await sleep(5);

    if (modified.length > 0) {
      result = [ ...existing.filter((e) => !modified.some((m) => m.recordId === e.recordId)), ...modified ].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
      cache.writeCacheWithPath('.cache/videos/query/all.json', result);
      console.log('› Overwrote existing video data with modified videos and rewrote cache.');
    } else {
      result = existing;
      console.log('› Retrieved existing video data, no new videos to cache.');
    }
    
    console.log(`[DONE] Successfully retrieved ${result.length} videos.`);
    return result;
  },
  
  getLatest: async (req, res = false) => {
    try {
      console.log(`Performing videos/all ${res ? 'external' : 'internal'} API request…`);
      const latest = await module.exports.updateLatest(req.headers['esovdb-no-cache'] === process.env.ESOVDB_NO_CACHE ? false : true);
      if (res) res.status(200).send(JSON.stringify(latest));
      else return latest;
    } catch (err) {
      if (res) res.status(400).end(JSON.stringify(err));
      else throw new Error(err.message);
    }
  }
};
