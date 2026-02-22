/**
 *  @file ESOVDB Airtable API methods
 *  @author Avana Vana <avana@esovdb.org>
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
  [ 'videos', 'Videos' ],
  [ 'series', 'Series' ],
  [ 'topics', 'Topics' ],
  [ 'tags', 'Tags' ],
  [ 'organizations', 'Organizations' ],
  [ 'people', 'People' ],
  [ 'submissions', 'Submissions' ],
  [ 'issues', 'Issues ']
]);

/** @constant {number} airtableRateLimit - Minimum time in ms to wait between requests using {@link Bottleneck} (default: 201ms ⋍ just under 5 req/s) */
const airtableRateLimit = 1005 / 5;

/** @constant {RegExp} regexYT - Regular expression for matching and extracting a YouTube videoId from a URL or on its own */
const regexYT = /^(?!rec)(?![\w\-]{12,})(?:.*youtu\.be\/|.*v=)?([\w\-]{10,12})&?.*$/;

/** @constant {RegExp} regexYTVideoId - Regular expression for matching and extracting a YouTube videoId purely on its own */
const regexYTVideoId = /[\w\-]{10,12}/;

const rateLimiter = new Bottleneck({ minTime: airtableRateLimit });

/** @constant {Map} formatFields - Maps each format, as passed in the URL query params to a list of fields that Airtable should retrieve, for that format. */
const formatFields = new Map([
  [ 'zotero', [ 'Zotero Key', 'Zotero Version', 'Series Zotero Key', 'Title', 'URL', 'Year', 'Description', 'Running Time', 'Format', 'Topic', 'Tags', 'Learn More', 'Series Text', 'Series Count Text', 'Vol.', 'No.', 'Publisher Text', 'Presenter First Name', 'Presenter Last Name', 'Language Code', 'Location', 'Plus Code', 'Video Provider', 'ESOVDBID', 'Record ID', 'ISO Added', 'Created', 'Modified' ]],
  [ 'yt', [ 'YouTube Video ID', 'Record ID', 'ESOVDBID', 'Zotero Key', 'ISO Added' ]],
  [ 'youtube', [ 'YouTube Video ID', 'Record ID', 'ESOVDBID', 'Zotero Key', 'ISO Added' ]]
]);

/** @constant {Object} videoFormat - A collection of formatting methods that can be used to transform ESOVDB Airtable output into different formats */
const videoFormat = {
  
  /**
   *  Formats a video from the ESOVDB according to the Zotero item template specification, returning each as a JavaScript Object
   *
   *  @method toZoteroJSON
   *  @param {AirtableRecord} record - The Airtable record class instance to format
   *  @returns {Object} An ESOVDB video, formatted according to the Zotero item template specification, for synchronizing with the Zotero library
   */
  
  toZoteroJSON: (record) => ({
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
    presenters: packageAuthors(record.get('Presenter First Name'), record.get('Presenter Last Name')),
    language: record.get('Language Code') || '',
    location: record.get('Location') || '',
    plusCode: record.get('Plus Code') || '',
    provider: record.get('Video Provider') || '',
    esovdbId: record.get('ESOVDBID') || '',
    recordId: record.get('Record ID') || '',
    accessDate: formatDate(record.get('ISO Added')) || '',
    created: record.get('Created'),
    modified: record.get('Modified'),
  }),
  
  /**
   *  Formats a video from the ESOVDB to a JavaScript Object with useful information for locating it in either the ESOVDB or the Zotero library, by its YouTube videoId, if it has one
   *
   *  @method toYTJSON
   *  @param {AirtableRecord} record - The Airtable record class instance to format
   *  @returns {Object} An ESOVDB video, formatted as a JavaScript Object with useful information for locating it in either the ESOVDB or the Zotero library, by its YouTube videoId, if it has one
   */
  
  toYTJSON: (record) => ({
    videoId: record.get('YouTube Video ID') || '',
    recordId: record.get('Record ID') || '',
    esovdbId: record.get('ESOVDBID') || '',
    zoteroKey: record.get('Zotero Key') || '',
    added: formatDate(record.get('ISO Added')) || ''
  }),
  
  /**
   *  Formats a video from the ESOVDB to a JavaScript object from the raw JSON provided by Airtable, including all available fields.
   *
   *  @method toJSON
   *  @param {AirtableRecord} record - The Airtable record class instance to format
   *  @returns {Object} An ESOVDB video, formatted as a JavaScript Object based on the raw JSON response from Airtable, including all available fields.
   */
  
   toJSON: (record) => ({ id: record.id, ...record._rawJson.fields }),
  
  /**
   *  @method toCSV 
   *  @todo Will eventually format an Airtable record class instance as a line in a CSV file to be included in a larger CSV response, i.e. with each field's value in order, separated by commas, and surrounded by double quotes, if the field's value contains a comma
   */
  
//  toCSV: (record) => {},
  
 /**
  *  @method toXML
  *  @todo Will eventually format an Airtable record class instance as an XML object to be included in a larger XML response
  */
  
//   toXML: (video) => {},
  
 /**
  *  @method toKML
  *  @todo Will eventually format an Airtable record class instance as an Google Earth KML object to be included in a larger Google Earth KML response, if the Airtable record has location data, such that the response can be imported into and plotted with Google Earth
  */
  
//   toKML: (video) => {},
  
 /**
  *  @method toGeoJSON
  *  @todo Will eventually format an Airtable record class instance as an GeoJSON Object, if the Airtable record has location data, such that the response can be used with GIS software
  */
  
//   toGeoJSON: (video) => {}
}

/**
   *  Maps a URL query parameter for video format to the appropriate formatting function
   *
   *  @function getFormat
   *  @param {Function} [def=videoFormat.toZoteroJSON] - The default formatting function to use, if no 'format' URL query parameter is sent with the request
   *  @param {string} [param=null] - The value of the URL query parameter 'format', sent with the request
   *  @returns {Function} A formatting method from the {@link videoFormat} object mapped to the URL query parameter, or by default, the {@link videoFormat.toZoteroJSON} method
   */

const getFormat = (param = null, def = videoFormat.toZoteroJSON) => {
  switch (param) {
    case 'raw':
    case 'json':
      return videoFormat.toJSON;
    case 'zotero':
      return videoFormat.toZoteroJSON;
    case 'yt':
    case 'youtube':
      return videoFormat.toYTJSON;
    default:
      return def;
  }
}

module.exports = {
  
  /**
   *  Retrieves videos from the ESOVDB by first checking the cache for a matching, fresh request, and otherwise performing an Airtable select() API query, page by page {@link req.query.pageSize} videos at a time (default=100), until all or {@link req.query.maxRecords}, if specified, using Botleneck for rate-limiting.  
   *
   *  @method queryVideos
   *  @requires Airtable
   *  @requires Bottleneck
   *  @requires cache
   *  @requires util
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {number} [req.params.pg] - An Express.js route param optionally passed after videos/query, which specifies which page (one-indexed) of a given {@link pageSize} number records should be sent in the [server response]{@link res}
   *  @param {number} [req.query.pageSize=100] - An [http request]{@link req} URL query param that specifies how many Airtable records to return in each API call
   *  @param {number} [req.query.maxRecords] - An [http request]{@link req} URL query param that specifies the maximum number of Airtable records that should be sent in the [server response]{@link res}
   *  @param {string} [req.query.createdAfter] - An [http request]{@link req} URL query param, in the format of a date string, parseable by Date.parse(), used to create a filterByFormula in an Airtable API call that returns only records created after the date in the given string
   *  @param {string} [req.query.modifiedAfter] - An [http request]{@link req} URL query param, in the format of a date string, parseable by Date.parse(), used to create a filterByFormula in an Airtable API call that returns only records modified after the date in the given string
   *  @param {string} [req.query.youTube] - A YouTube video's URL, short URL, or video ID
   *  @param {string} [req.query.searchText] - A string of text to search within multiple fields in the ESOVDB
   *  @param {(!express:Response|Boolean)} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class, or false if not passed
   *  @sideEffects Queries the ESOVDB Airtable base, page by page, and either sends the retrieved data as JSON within an HTTPServerResponse object, or returns it as a JavaScript Object
   *  @returns {Object[]} Array of ESOVDB video records as JavaScript objects (if no {@link res} object is provided)
   */
  
  queryVideos: (req, res = false) => {
    if (!req.params) req.params = {};
    if (!req.query) req.query = {};
    req.params.pg = !req.params.pg || !Number(req.params.pg) || +req.params.pg < 0 ? null : +req.params.pg - 1;
    
    if (!req.query.pageSize || isNaN(req.query.pageSize) || +req.query.pageSize > 100 || +req.query.pageSize <= 0)
      req.query.pageSize = 100
    
    if (!req.query.maxRecords || isNaN(req.query.maxRecords) || +req.query.maxRecords <= 0)
      req.query.maxRecords = null;
    
    if (req.query.maxRecords && +req.query.maxRecords < +req.query.pageSize)
      req.query.pageSize = req.query.maxRecords;
    
    let modifiedAfter,
        modifiedAfterDate,
        createdAfter,
        createdAfterDate,
        likeYTID,
        searchText;
    
    if (
      req.query.modifiedAfter &&
      !isNaN(Date.parse(decodeURIComponent(req.query.modifiedAfter))) &&
      Date.parse(decodeURIComponent(req.query.modifiedAfter)) > 0
    ) {
      modifiedAfter = Date.parse(decodeURIComponent(req.query.modifiedAfter));
      modifiedAfterDate = new Date(modifiedAfter);
    }

    if (
      req.query.createdAfter &&
      !isNaN(Date.parse(decodeURIComponent(req.query.createdAfter))) &&
      Date.parse(decodeURIComponent(req.query.createdAfter)) > 0
    ) {
      createdAfter = Date.parse(decodeURIComponent(req.query.createdAfter));
      createdAfterDate = new Date(createdAfter);
    }
    
    if (req.query.youTube && regexYT.test(decodeURIComponent(req.query.youTube))) likeYTID = regexYT.exec(decodeURIComponent(req.query.youTube))[1];
    
    if (req.query.searchText) searchText = decodeURIComponent(req.query.searchText).toLowerCase();
    
    let queryText = req.params.pg !== null ?
      `for page ${req.params.pg + 1} (${req.query.pageSize} results per page)` :
      `(${req.query.pageSize} results per page, ${req.query.maxRecords ? 'up to ' + req.query.maxRecords : 'for all'} results)`;
    
    queryText += modifiedAfterDate ? ', modified after ' + modifiedAfterDate.toLocaleString() : '';
    queryText += createdAfterDate ? ', created after ' + createdAfterDate.toLocaleString() : '';
    queryText += likeYTID ? `, matching YouTube ID "${likeYTID}"` : '';
    queryText += searchText ? `, matching text (case-insensitive) "${searchText}"` : '';
    
    console.log(`Performing videos/query ${res ? 'external' : 'internal'} API request ${queryText}...`);

    const cachePath = `.cache${req.url}.json`;
    const cachedResult = cache.readCacheWithPath(cachePath);

    if (cachedResult !== null) {
      console.log(`Cache hit. Returning cached result for ${req.url}...`);
      if (res) return res.status(200).send(JSON.stringify(cachedResult));
      else return cachedResult;
    } else {
      console.log(`Cache miss. Loading from Airtable for ${req.url}...`);

      let data = [],
          pg = 0,
          ps = +req.query.pageSize,
          filterStrings = [],
          options = {
            pageSize: ps,
            view: 'All Online Videos',
            sort: [{ field: 'Modified', direction: 'desc' }]
          };
      
      if (formatFields.get(req.query.format))
        options.fields = formatFields.get(req.query.format);
      
      if (req.query.maxRecords && !req.params.pg)
        options.maxRecords = +req.query.maxRecords;
      
      if (modifiedAfter)
        filterStrings.push(`IS_AFTER({Modified}, "${modifiedAfterDate.toISOString()}")`);
      
      if (createdAfter)
        filterStrings.push(`IS_AFTER(CREATED_TIME(), "${createdAfterDate.toISOString()}")`);
      
      if (likeYTID)
        filterStrings.push(`REGEX_MATCH({URL}, "${likeYTID}")`);
      
      if (searchText)
        filterStrings.push(`OR(REGEX_MATCH(LOWER({Title}&''), "${searchText}"),REGEX_MATCH(LOWER({Description}&''), "${searchText}"),REGEX_MATCH(LOWER({Tags}&''), "${searchText}"))`);
      
      if (filterStrings.length > 0)
        options.filterByFormula = filterStrings.length > 1 ? `AND(${filterStrings.join(',')})` : filterStrings[0]

      rateLimiter.wrap(
        base('Videos')
          .select(options)
          .eachPage(
            function page(records, fetchNextPage) {
              if (!req.params.pg || pg == req.params.pg) {
                console.log(`Retrieving records ${pg * ps + 1}-${(pg + 1) * ps}...`);                
                data = [ ...data, ...records.map((record) => getFormat(req.query.format, videoFormat.toZoteroJSON)(record)) ];

                if (pg == req.params.pg) {
                  console.log(`[DONE] Retrieved ${data.length} records.`);
                  cache.writeCacheWithPath(cachePath, data);
                  if (res) return res.status(200).send(JSON.stringify(data));
                } else {
                  console.log(`Successfully retrieved ${records.length} records.`);
                }

                pg++, fetchNextPage();
              } else {
                pg++, fetchNextPage();
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
   *  Retrieves submissions from the ESOVDB by first checking the cache for a matching, fresh request, and otherwise performing an Airtable select() API query, page by page {@link req.query.pageSize} submissions at a time (default=100), until all or {@link req.query.maxRecords}, if specified, using Botleneck for rate-limiting.  
   *
   *  @method queryVideos
   *  @requires Airtable
   *  @requires Bottleneck
   *  @requires cache
   *  @requires util
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {string} [req.query.createdAfter] - An [http request]{@link req} URL query param, in the format of a date string, parseable by Date.parse(), used to create a filterByFormula in an Airtable API call that returns only records created after the date in the given string
   *  @param {(!express:Response|Boolean)} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class, or false if not passed
   *  @sideEffects Queries the ESOVDB Airtable base, page by page, and either sends the retrieved data as JSON within an HTTPServerResponse object, or returns it as a JavaScript Object
   *  @returns {Object[]} Array of ESOVDB submission records as JavaScript objects (if no {@link res} object is provided)
   */

  querySubmissions: (req, res = false) => {
    console.log('starting querySubmissions');
    if (!req.params) req.params = {};
    if (!req.query) req.query = {};
    req.params.pg = !req.params.pg || !Number(req.params.pg) || +req.params.pg < 0 ? null : +req.params.pg - 1;
    
    if (!req.query.pageSize || isNaN(req.query.pageSize) || +req.query.pageSize > 100 || +req.query.pageSize <= 0)
      req.query.pageSize = 100
    
    if (!req.query.maxRecords || isNaN(req.query.maxRecords) || +req.query.maxRecords <= 0)
      req.query.maxRecords = null;
    
    if (req.query.maxRecords && +req.query.maxRecords < +req.query.pageSize)
      req.query.pageSize = req.query.maxRecords;

    let createdAfter, createdAfterDate;

    if (
      req.query.createdAfter &&
      !isNaN(Date.parse(decodeURIComponent(req.query.createdAfter))) &&
      Date.parse(decodeURIComponent(req.query.createdAfter)) > 0
    ) {
      createdAfter = Date.parse(decodeURIComponent(req.query.createdAfter));
      createdAfterDate = new Date(createdAfter);
    } else {
      createdAfterDate = null
    }

    console.log(`Querying submissions created ${createdAfterDate ? 'after ' + createdAfterDate.toLocaleString() : 'since the beginning'}...`);

    const cachePath = `.cache${req.url}.json`;
    const cachedResult = cache.readCacheWithPath(cachePath);

    if (cachedResult !== null) {
      console.log(`Cache hit. Returning cached result for ${req.url}...`);
      return res ? res.status(200).send(JSON.stringify(cachedResult)) : cachedResult;
    } else {
      console.log(`Cache miss. Loading from Airtable for ${req.url}...`);

      let data = [],
          pg = 0,
          ps = +req.query.pageSize,
          filterStrings = [],
          options = {
            pageSize: ps,
            view: 'Open Submissions',
            sort: [{ field: 'Created', direction: 'desc' }]
          };
      
      if (req.query.maxRecords && !req.params.pg)
        options.maxRecords = +req.query.maxRecords;
      
      if (createdAfter)
        filterStrings.push(`IS_AFTER(CREATED_TIME(), "${createdAfterDate.toISOString()}")`);
      
      if (filterStrings.length > 0)
        options.filterByFormula = filterStrings.length > 1 ? `AND(${filterStrings.join(',')})` : filterStrings[0]

      rateLimiter.wrap(
        base('Submissions')
          .select(options)
          .eachPage(
            function page(records, fetchNextPage) {
              if (!req.params.pg || pg == req.params.pg) {
                console.log(`Retrieving records ${pg * ps + 1}-${(pg + 1) * ps}...`);
                data = [ ...data, ...records.map((record) => ({ id: record.id, ...record.fields })) ];

                if (pg == req.params.pg) {
                  console.log(`[DONE] Retrieved ${data.length} records.`);
                  cache.writeCacheWithPath(cachePath, data);
                  if (res) return res.status(200).send(JSON.stringify(data));
                } else {
                  console.log(`Successfully retrieved ${records.length} records.`);
                }

                pg++, fetchNextPage();
              } else {
                pg++, fetchNextPage();
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
   *  Retrieves a video from the ESOVDB, searching the 'Videos' table, given a YouTube video URL or ID, and returns a match's ESOVDB details in JSON format.
   *
   *  @method queryYouTubeVideos
   *  @requires Airtable
   *  @requires Bottleneck
   *  @requires cache
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {string} [req.params.id] - URL parameter representing a YouTube video's URL, short URL, or video ID, passed last, as a required URL parameter.  Either this or req.query.id is required.
   *  @param {string} [req.query.id] - URL query parameter representing a YouTube video's URL, short URL, or video ID, passed last, as a required URL parameter. Either this or req.params.id is required.
   *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
   *  @sideEffects Queries the ESOVDB Airtable base, page by page, and either sends the retrieved data as JSON within an HTTPServerResponse object, or returns it as a JavaScript Object
   *  @returns {Object} Object with collection or properties for identifying and linking to an ESOVDB record on YouTube
   */
  
  queryYouTubeVideos: (req, res) => {
    let videoId;
    
    if (req.params.id && regexYT.test(decodeURIComponent(req.params.id))) {
      videoId = regexYT.exec(decodeURIComponent(req.params.id))[1];
    } else if (req.query.id && regexYT.test(decodeURIComponent(req.query.id))) {
      videoId = regexYT.exec(decodeURIComponent(req.query.id))[1];
    } else {
      if (res) {
        return res.status(400).send('Missing parameter "id".');
      } else {
        throw new Error('Missing parameter "id".');
      }
    }
    
    console.log(`Performing videos/youtube ${res ? 'external' : 'internal'} API request for YouTube ID "${videoId}"...`);

    const cachePath = `.cache${req.url}.json`;
    const cachedResult = cache.readCacheWithPath(cachePath);

    if (cachedResult !== null) {
      console.log(`Cache hit. Returning cached result for ${req.url}...`);
      if (res) return res.status(200).send(JSON.stringify(cachedResult));
      else return cachedResult;
    } else {
      console.log(`Cache miss. Loading from Airtable for ${req.url}...`);

      let data = [],
          options = {
            pageSize: 1,
            maxRecords: 1,
            view: 'All Online Videos',
            sort: [{ field: 'Created' }],
            filterByFormula: `AND({Video Provider} = 'YouTube', REGEX_MATCH({URL}, "${videoId}"))`
          };
      
      options.fields = formatFields.get(req.query.format) ? formatFields.get(req.query.format) : formatFields.get('youtube');
      
      rateLimiter.wrap(
        base('Videos')
          .select(options)
          .eachPage(
            function page(records, fetchNextPage) {
              data = [ ...data, ...records.map((record) => getFormat(req.query.format, videoFormat.toYTJSON)(record)) ];
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
   *  Retrieves a video from the ESOVDB, searching the 'Videos' table first, then the 'Submissions' table, given a YouTube video URL or ID, and returns a match's ESOVDB details in JSON format.
   *
   *  @method queryYouTubeVideosAndSubmissions
   *  @requires Airtable
   *  @requires Bottleneck
   *  @requires cache
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {string} [req.params.id] - URL parameter representing a YouTube video's URL, short URL, or video ID, passed last, as a required URL parameter.  Either this or req.query.id is required.
   *  @param {string} [req.query.id] - URL query parameter representing a YouTube video's URL, short URL, or video ID, passed last, as a required URL parameter. Either this or req.params.id is required.
   *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
   *  @sideEffects Queries the ESOVDB Airtable base, page by page, and either sends the retrieved data as JSON within an HTTPServerResponse object, or returns it as a JavaScript Object
   *  @returns {Object} Object with collection or properties for identifying and linking to an ESOVDB record on YouTube
   */
  
  queryYouTubeVideosAndSubmissions: (req, res) => {
    
  },
  
  /**
   *  Given a single ESOVDB Airtable record ID, returns that video's ESOVDB Airtable record data, in a neutral JSON format
   *
   *  @method getVideoById
   *  @requires Airtable
   *  @requires Bottleneck
   *  @requires cache
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {string} [req.params.id] - A video's ESOVDB Airtable record ID, passed as a URL query parameter.  Either this or req.query.id is required.
   *  @param {string} [req.query.id] - A video's ESOVDB Airtable record ID, passed as a URL query parameter. Either this or req.params.id is required.
   *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
   *  @sideEffects Selects a single record from the ESOVDB Airtable base, and either sends the retrieved data as JSON within an HTTPServerResponse object, or returns it as a JavaScript Object
   *  @returns {Object} A JavaScript Object representing the entire Airtable record matching the specified video's ESOVDB Airtable record ID, with all of its fields
   */
  
  getVideoById: (req, res) => {
    const id = req.params.id || req.query.id || null;

    if (id && /^rec[\w]{14}$/.test(id)) {
      const cachePath = `.cache${req.url}.json`;
      const cachedResult = cache.readCacheWithPath(cachePath);

      if (cachedResult !== null) {
        console.log(`Cache hit. Returning cached result for ${req.url}...`);
        if (res) return res.status(200).send(JSON.stringify(cachedResult));
        else return cachedResult;
      } else {
        console.log(`Cache miss. Loading from Airtable for ${req.url}...`);
      
        try {
          rateLimiter.wrap(
            base('Videos')
              .find(req.params.id, function(error, record) {
                if (error) {
                  console.error(`[ERROR] Unable to find record "${id}".`);
                  if (res) return res.status(404).send('Unable to find matching record.');
                  else return;
                } else {
                  const data = getFormat(req.query.format, videoFormat.toJSON)(record);
                  console.log(`[DONE] Retrieved record "${id}".`);
                  cache.writeCacheWithPath(cachePath, data);
                  if (res) return res.status(200).send(JSON.stringify(data));
                  else return data;
                }
              })
          );
        } catch (err) {
          console.error(`[ERROR] ${err.message}.`);
          if (res) return res.status(404).send(err.message);
          else return;
        }
      }
    } else {
      console.error(`[ERROR] Invalid or no ESOVDB record ID specified.`);
      if (res) return res.status(400).send('Invalid or no ESOVDB record ID specified.');
      else return;
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
      const batch = updates.splice(0, 10);
      
      console.log(
        `Updating record${batch.length === 1 ? '' : 's'} ${
          i * 10 + 1
        }${batch.length > 1 ? '-' : ''}${
          batch.length > 1
            ? i * 10 +
              (batch.length < 10
                ? batch.length
                : 10)
            : ''
        } of ${queue} total in table "${table}"...`
      );
  
      i++;
      rateLimiter.wrap(base(table).update(batch));
    }
    
    return items;
  },

//   processAdditions: (items, table) => {
//     let i = 0, additions = [ ...items ], queue = items.length, results = [];

//     while (additions.length) {
//       const batch = additions.splice(0, 10);
      
//       console.log(
//         `Creating record${batch.length === 1 ? '' : 's'} ${
//           i * 10 + 1
//         }${batch.length > 1 ? '-' : ''}${
//           batch.length > 1
//             ? i * 10 +
//               (batch.length < 10
//                 ? batch.length
//                 : 10)
//             : ''
//         } of ${queue} total in table "${table}"...`
//       );

//       i++;
//       rateLimiter.wrap(
//         base(table).create(batch, function(err, data) {
//           if (err) throw new Error(err); 
//           console.log('Successfully created batch.');
//           console.log(data); // TODO: remove
//           results.push(...data);
//         }));
//     }
    
//     console.log(`Successfully created ${results.length > 1 ? results.length + ' new records' : '1 new record'} in table "${table}" on ESOVDB.`);
//     console.log(results); // TODO: remove
//     return results;
//   },
  
  processAdditions: async (items, table) => {
    let i = 0, additions = [ ...items ], queue = items.length, results = [];

    while (additions.length) {
      const batch = additions.splice(0, 10);

      console.log(
        `Creating record${batch.length === 1 ? '' : 's'} ${
          i * 10 + 1
        }${batch.length > 1 ? '-' : ''}${
          batch.length > 1
            ? i * 10 +
              (batch.length < 10
                ? batch.length
                : 10)
            : ''
        } of ${queue} total in table "${table}"...`
      );

      i++;

      const created = await rateLimiter.wrap(base(table).create(batch));
      const createdArray = Array.isArray(created) ? created : [ created ];
      for (let j = 0; j < createdArray.length; j++) results.push(createdArray[j]);
    }

    console.log(`Successfully created ${results.length > 1 ? results.length + ' new records' : '1 new record'} in table "${table}" on ESOVDB.`);
    return results;
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
      console.log(`Performing ${req.params.table}/update API request for ${req.body.length} record${req.body.length === 1 ? '' : 's'}...`);
      const data = module.exports.processUpdates(req.body, tables.get(req.params.table));
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
    const modified = cachedModified ? cachedModified : await module.exports.queryVideos({ url: '/v1/videos/query/latest', query: { modifiedAfter } });
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
   *  Merges previously cached ESOVDB submissions data with submissions modified in the past 24 hours.
   *
   *  @async
   *  @method updateLatestSubmissions
   *  @param {Boolean} [useCache=true] - Whether or not data on the 'latest' data (i.e. modifications to ESOVDB submissions data made in the past 24 hours) should be pulled from the cache, or freshly retrieved from the ESOVDB Airtable
   *  @sideEffects Reads from and writes to (overwrites) a JSON file containing all submissions data in the ESOVDB with any modifications made in the past 24 hours
   *  @returns {Object[]} Returns all ESOVDB submissions data with any (if there are any) modifications made in the past 24 hours
   */
  
  updateLatestSubmissions: async (useCache = true) => {
    let result, lastTime = new Date(); lastTime.setHours(0); lastTime.setMinutes(0); lastTime.setSeconds(0); lastTime.setMilliseconds(0); lastTime.setDate(lastTime.getDate() - 1);
    const createdAfter = encodeURIComponent(lastTime.toLocaleString());
    const existing = cache.readCacheWithPath('.cache/v1/submissions/query/all.json', false);
    const cachedModified = useCache ? cache.readCacheWithPath('.cache/v1/submissions/query/latest.json') : null;
    const modified = cachedModified ? cachedModified : await module.exports.querySubmissions({ url: '/v1/submissions/query/latest', query: { createdAfter } });
    await sleep(5);

    if (modified.length > 0) {
      result = [ ...existing.filter((e) => !modified.some((m) => m.recordId === e.recordId)), ...modified ].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
      cache.writeCacheWithPath('.cache/v1/submissions/query/all.json', result);
      console.log('› Overwrote existing submission data with modified submissions and rewrote cache.');
    } else {
      result = existing;
      console.log('› Retrieved existing submission data, no new submissions to cache.');
    }
    
    console.log(`[DONE] Successfully retrieved ${result.length} submissions.`);
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
      console.log(`Performing videos/all ${res ? 'external' : 'internal'} API request...`);
      const latest = await module.exports.updateLatest(req.headers && req.headers['esovdb-no-cache'] && req.headers['esovdb-no-cache'] === process.env.ESOVDB_NO_CACHE ? false : true);
      if (res) res.status(200).send(JSON.stringify(latest));
      else return latest;
    } catch (err) {
      if (res) res.status(500).end(JSON.stringify(err));
      else throw new Error(err.message);
    }
  },
  
  /**
   *  Passes the body of an HTTP POST request to this server on to {@link updateLatest}, which merges previously cached ESOVDB submissions data with submissions modified in the past 24 hours.
   *
   *  @async
   *  @method getLatestSubmissions
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {Object[]} req.body - An array of objects formatted as updates for Airtable (i.e. [ { id: 'recordId', fields: { 'Airtable Field': 'value', ... } }, ... ]) passed as the body of the [server request]{@link req}
   *  @param {!express:Response} [res=false] - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class or Boolean false, by default, which allows the function to distinguish between external clients, which need to be sent an HTTPServerResponse object, and internal usage of the function, which need to return a value
   *  @sideEffects Overwrites a JSON file containing all video data in the ESOVDB with any modifications made in the past 24 hours. If {@link res} is provided, sends an HTTPServerResponse object to the requesting client
   *  @returns {Object[]} If {@link res} is not provided (i.e. internal consumption of this API method), returns all ESOVDB submissions data with any modifications made in the past 24 hours
   */
  
  getLatestSubmissions: async (req, res = false) => {
    try {
      console.log(`Performing submissions/all ${res ? 'external' : 'internal'} API request...`);
      const latest = await module.exports.updateLatestSubmissions(req.headers && req.headers['esovdb-no-cache'] && req.headers['esovdb-no-cache'] === process.env.ESOVDB_NO_CACHE ? false : true);
      if (res) res.status(200).send(JSON.stringify(latest));
      else return latest;
    } catch (err) {
      if (res) res.status(500).end(JSON.stringify(err));
      else throw new Error(err.message);
    }
  },
  
  newVideoSubmission: async (req, res) => {
    try {
      if (!regexYTVideoId.test(req.params.id)) return res.status(400).send('Invalid YouTube Video ID.');
      const { getVideo } = require('./youtube');
      const video = await getVideo(req.params.id);  
      const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim();
      
      rateLimiter.wrap(
        base('Submissions').create({
          'Title': video.title || '',
          'URL': `https://youtu.be/${video.id}`,
          'Description': video.description || '',
          'Year': +video.year || null,
          'Date': video.date || null,
          'Running Time': +video.duration || null,
          'Medium': 'Online Video',
          'YouTube Channel Title': video.channel || '',
          'YouTube Channel ID': video.channelId || '',
          'Submission Source': 'Is YouTube Video on ESOVDB?',
          'Submitted by': ip || ''
        }, function(err, record) {
          if (err) throw new Error(err); 
          console.log(`Successfully created new submission on ESOVDB for YouTube video "${video.title || 'Title Unknown'}" (https://youtu.be/${video.id}).`);
          return res.status(200).send(JSON.stringify(video));
        }));
    } catch (err) {
      res.status(500).end(JSON.stringify(err));
    }
  }
};
