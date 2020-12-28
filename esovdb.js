/**
 * @file ESOVDB Airtable API methods
 * @author Avana Vana <dear.avana@gmail.com>
 * @module esovdb
 * @see {@link https://airtable.com/shrFBKQwGjstk7TVn|The Earth Science Online Video Database}
 */

const dotenv = require('dotenv').config();
const Airtable = require('airtable');
const Bottleneck = require('bottleneck');
const cache = require('./cache');
const { formatDuration, formatDate, packageAuthors } = require('./util');

const base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY,
}).base(process.env.AIRTABLE_BASE_ID);

const view = 'All Online Videos';
const videos = 'Videos';

const rateLimiter = new Bottleneck({ minTime: 1005 / 5 });

module.exports = {
  
  /*
   *  Retrieves a list of videos page by page {@link pageSize} videos at a time (default=100), until all or {@link maxRecords}, if specified
   *
   *  @method listVideos
   *  @param {Object} req
   *  @param {Object} res
   *  @returns 
   */
  
  listVideos: (req, res) => {
    req.params.pg =
      !req.params.pg || !Number(req.params.pg) || +req.params.pg < 0 
        ? null 
        : +req.params.pg - 1;
    
    if (
      !req.query.pageSize ||
      !Number(req.query.pageSize || req.query.pageSize > 100)
    ) {
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
      modifiedSincAfter = new Date(modifiedAfter);
    }

    if (
      req.query.createdAfter &&
      typeof Date.parse(decodeURIComponent(req.query.createdAfter)) === 'number' &&
      Date.parse(decodeURIComponent(req.query.createdAfter)) > 0
    ) {
      createdAfter = Date.parse(decodeURIComponent(req.query.createdAfter));
      createdAfterDate = new Date(createdAfter);
    }
    
    let queryText =
      req.params.pg !== null
        ? 'for page ' +
          (req.params.pg + 1) +
          ' (' +
          req.query.pageSize +
          ' results per page)'
        : '(' +
          req.query.pageSize +
          ' results per page, ' +
          (req.query.maxRecords ? 'up to ' + req.query.maxRecords : 'for all') +
          ' results)';
    
    queryText += modifiedAfterDate ? ', modified after ' + modifiedAfterDate.toLocaleString() : '';
    queryText += createdAfterDate ? ', created after ' + createdAfterDate.toLocaleString() : '';
    
    console.log(`Performing videos/list API request ${queryText}`);

    const cachePath = `.cache${req.url}.json`;
    const cachedResult = cache.readCacheWithPath(cachePath);

    if (cachedResult != null) {
      console.log('Cache hit. Returning cached result for ' + req.url);
      res.status(200).send(JSON.stringify(cachedResult));
    } else {
      console.log('Cache miss. Loading from Airtable for ' + req.url);

      let pg = 0;
      const ps = +req.query.pageSize;
      let data = [];
      let options = {
        pageSize: ps,
        view: view,
        sort: [{ field: 'Modified', direction: 'desc' }],
        fields: [
          'Zotero Key',
          'Zotero Version',
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

      if (req.query.maxRecords) options.maxRecords = +req.query.maxRecords;
      if (modifiedAfter) options.filterByFormula = `IS_AFTER({Modified}, DATETIME_PARSE(${modifiedAfter}))`;
      if (createdAfter) options.filterByFormula = `IS_AFTER(CREATED_TIME(), DATETIME_PARSE(${createdAfter}))`;

      rateLimiter.wrap(
        base(videos)
          .select(options)
          .eachPage(
            function page(records, fetchNextPage) {
              if (!req.params.pg || pg == req.params.pg) {
                console.log(
                  `Retrieving records ${pg * ps + 1}-${(pg + 1) * ps}...`
                );
                
                records.forEach((record) => {
                  let row = {
                    zoteroKey: record.get('Zotero Key') || '',
                    zoteroVersion: record.get('Zotero Version') || '',
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
                    modified: record.get('Modified')
                  };

                  data.push(row);
                });

                console.log(
                  `Successfully retrieved ${records.length} records.`
                );

                if (pg == req.params.pg) {
                  res.status(200).send(JSON.stringify(data));
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
                res.status(400).end(JSON.stringify(err));
              } else {
                console.log(
                  `[DONE] Retrieved ${data.length} records.`
                );
                cache.writeCacheWithPath(cachePath, data);
                res.status(200).send(JSON.stringify(data));
              }
            }
          )
      );
    }
  },
  updateVideos: (req, res) => {
    let i = 0, updates = req.body, queue = req.body.length;

    if (queue > 0) {
      console.log(`Performing videos/update API request for ${queue} records...`);
    
      while (updates.length > 0) {
        console.log(
          `Updating record${updates.length > 1 ? 's' : ''} ${
            i * 50 + 1
          }${updates.length > 1 ? '-' : ''}${
            updates.length > 1
              ? i * 50 +
                (updates.length < 50
                  ? updates.length
                  : 50)
              : ''
          } of ${queue} total...`
        );

        rateLimiter.wrap(base(videos).update(updates.slice(0, 50)));
        i++, updates = updates.slice(50);
      }
      
      res.status(200).send(JSON.stringify(updates));
    }
  }
};
