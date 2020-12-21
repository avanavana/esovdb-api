const dotenv = require('dotenv').config();
const Airtable = require('airtable');

const base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY,
}).base(process.env.AIRTABLE_BASE_ID);

const view = 'All Online Videos';
const videos = 'Videos';

const Bottleneck = require('bottleneck');
const rateLimiter = new Bottleneck({ minTime: 1005 / 5 });
const cache = require('./cache');
const util = require('./util');

function sendResultWithResponse(data, res) {
  res.status(200).end(JSON.stringify(data));
}

function cachePathForRequest(url) {
  return '.cache' + url + '.json';
}

module.exports = {
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

    const cachePath = cachePathForRequest(req.url);
    const cachedResult = cache.readCacheWithPath(cachePath);

    if (cachedResult != null) {
      console.log('Cache hit. Returning cached result for ' + req.url);
      sendResultWithResponse(cachedResult, res);
    } else {
      console.log('Cache miss. Loading from Airtable for ' + req.url);

      let pg = 0;
      const ps = +req.query.pageSize;
      let data = [];
      let options = {
        pageSize: ps,
        view: view,
        fields: [
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
                    title: record.get('Title') || '',
                    url: record.get('URL') || '',
                    year: record.get('Year') || '',
                    desc: record.get('Description') || '',
                    runningTime:
                      util.formatDuration(record.get('Running Time')) || '',
                    format: record.get('Format') || '',
                    topic: record.get('Topic'),
                    learnMore: record.get('Learn More'),
                    series: record.get('Series Text') || '',
                    seriesCount: record.get('Series Count Text') || '',
                    vol: record.get('Vol.') || '',
                    no: record.get('No.') || '',
                    publisher: record.get('Publisher Text') || '',
                    presenters: util.packageAuthors(
                      record.get('Presenter First Name'),
                      record.get('Presenter Last Name')
                    ),
                    language: record.get('Language Code') || '',
                    location: record.get('Location') || '',
                    plusCode: record.get('Plus Code') || '',
                    provider: record.get('Video Provider') || '',
                    esovdbId: record.get('ESOVDBID') || '',
                    recordId: record.get('Record ID') || '',
                    accessDate: util.formatDate(record.get('ISO Added')) || '',
                    created: record.get('Created'),
                    modified: record.get('Modified')
                  };

                  data.push(row);
                });

                console.log(
                  `Successfully retrieved ${data.length} records.`
                );

                if (pg == req.params.pg) {
                  sendResultWithResponse(data, res);
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
                cache.writeCacheWithPath(cachePath, data);
                sendResultWithResponse(data, res);
              }
            }
          )
      );
    }
  },
};
