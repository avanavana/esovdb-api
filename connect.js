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

function cachePathForRequest(req) {
  return '.cache' + req.path + '.json';
}

module.exports = {
  listVideos: (req, res) => {
    const cachePath = cachePathForRequest(req);
    const cachedResult = cache.readCacheWithPath(cachePath);

    if (cachedResult != null) {
      console.log('Cache hit. Returning cached result for ' + req.path);
      sendResultWithResponse(cachedResult, res);
    } else {
      console.log('Cache miss. Loading from Airtable for ' + req.path);

      let pg = 0;
      const ps = 3;
      let data = [];
      
      rateLimiter.wrap(
        base(videos)
          .select({
            pageSize: ps,
            maxRecords: 9,
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
          })
          .eachPage(
            function page(records, fetchNextPage) {
              if (!req.params.page || pg == req.params.page) {
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
                
                if (pg == req.params.page) {
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