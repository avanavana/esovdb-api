const dotenv = require('dotenv').config();
const Airtable = require('airtable');

const base = new Airtable({
 apiKey: process.env.AIRTABLE_API_KEY
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
    req.params.pg = (!req.params.pg || !Number(req.params.pg) || +req.params.pg < 0) ? null : +req.params.pg - 1;
    if (!req.query.ps || !Number(req.query.ps || req.query.ps > 100)) { req.query.ps = 100; }
    if (!Number(req.query.max || req.query.max == 0)) { req.query.max = null; }
    if (req.query.max && +req.query.max < +req.query.ps) { req.query.ps = req.query.max ;}
    const queryText = req.params.pg !== null ? ('for page ' + (req.params.pg + 1) + ' (' + req.query.ps + ' results per page)') : ('(' + req.query.ps + ' results per page, ' + (req.query.max ? 'up to ' + req.query.max : 'for all') + ' results)');
    console.log(`Performing videos/list API request ${queryText}`);

    const cachePath = cachePathForRequest(req.url);
    const cachedResult = cache.readCacheWithPath(cachePath);
    
    if (cachedResult != null) {
      console.log('Cache hit. Returning cached result for ' + req.url);
      sendResultWithResponse(cachedResult, res);
    } else {
      console.log('Cache miss. Loading from Airtable for ' + req.url);

      let pg = 0;
      const ps = +req.query.ps;
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
          'ISO Added'
        ]
      };
      
      if (req.query.max) options.maxRecords = +req.query.max;

      rateLimiter.wrap(
        base(videos)
          .select(options)
          .eachPage(
            function page(records, fetchNextPage) {
              if (!req.params.pg || pg == req.params.pg) {
                records.forEach(record => {
                  let row = {
                    title: record.get('Title'),
                    url: record.get('URL'),
                    year: record.get('Year'),
                    desc: record.get('Description'),
                    runningTime: util.formatDuration(record.get('Running Time')),
                    format: record.get('Format'),
                    topic: record.get('Topic'),
                    learnMore: record.get('Learn More'),
                    series: record.get('Series Text'),
                    vol: record.get('Vol.'),
                    no: record.get('No.'),
                    publisher: record.get('Publisher Text'),
                    presenters: util.formatAuthors(record.get('Presenter First Name'), record.get('Presenter Last Name'), true),
                    language: record.get('Language Code'),
                    location: record.get('Location'),
                    plusCode: record.get('Plus Code'),
                    provider: record.get('Video Provider'),
                    esovdbId: record.get('ESOVDBID'),
                    accessDate: util.formatDate(record.get('ISO Added'))
                  };

                  data.push(row);
                });

                console.log(`Returning records ${pg * ps + 1}-${(pg + 1) * ps}`);
                
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
  }
};