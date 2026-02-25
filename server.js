/**
 *  @file Express server with IP validation middleware and graceful cleanup
 *  @author Avana Vana <avana@esovdb.org>
 *  @version 4.0.0
 */

const dotenv = require('dotenv').config();
const express = require('express');
const cleanUp = require('node-cleanup');
const cors = require('cors');
const { db, monitor } = require('./batch');
const { appReady, patternsToRegEx } = require('./util');
const esovdb = require('./esovdb');
const webhooks = require('./webhooks');
const youtube = require('./youtube');
const zotero = require('./zotero');

const app = express();

const middleware = {
  
  /**
   *  Middleware for blacklisting or whitelisting IP addresses and/or IP address ranges, which can be passed to specific endpoints
   *
   *  @method validateReq
   *  @requires util.patternsToRegEx
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
   *  @param {!express:NextFunction} next - The next middleware function in the stack
   */
  
  validateReq: (req, res, next) => {
    const d = new Date(), ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim();

    if (patternsToRegEx(process.env.IP_BLACKLIST).test(ip)) {
      const err = {
        Error: 'Access denied.',
      };

      console.error(`[${d.toLocaleString()}] (${ip})\n${err.Error}`);
      res.status(401).send(JSON.stringify(err));
    } else {
      console.log(`[${d.toLocaleString()}] (${ip})\nAccess granted.`);
      next();
    }
  },
  
  auth: (req, res, next) => {
    if (req.headers['x-esovdb-key'] && req.headers['x-esovdb-key'] === process.env.ESOVDB_KEY) {
      console.log('ESOVDB key validated.');
      next();
    } else if (req.headers['esovdb-key'] && req.headers['esovdb-key'] === process.env.ESOVDB_KEY) {
      console.log('ESOVDB key validated (using deprecated header—update this client!');
      next();
    } else if (req.headers['X-RapidAPI-Proxy-Secret'] && req.headers['X-RapidAPI-Proxy-Secret'] === process.env.RAPIDAPI_SECRET) {
      console.log('RapidAPI proxy secret validated.');
      next();
    } else {
      const d = new Date(), ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim();
      console.error(`[${d.toLocaleString()}] (${ip}) Unauthorized attempted access of ${req.path} without a valid ESOVDB key.`);
      res.status(401).send('Unauthorized access. Visit https://rapidapi.com/the-earth-science-online-video-database-the-earth-science-online-video-database-default/api/the-earth-science-online-video-database for access.');
    }
  },
  
  allowCORS: (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    next();
  }
}

/**
 *  API endpoint for querying the entire ESOVDB—returns JSON. Used with the premium header 'esovdb-no-cache', always returns fresh results.
 *  @requires esovdb
 *  @callback esovdb.getLatest
 */

app.get('/v1/videos', [ middleware.auth, middleware.validateReq ], (req, res) => {
  esovdb.getLatest(req, res);
});

/**
 *  API endpoint for querying the ESOVDB—returns JSON. All request params and request query params documented in [esovdb.queryVideos]{@link esovdb.queryVideos}.
 *  @requires esovdb
 *  @callback esovdb.queryVideos
 */

app.get('/v1/videos/query/:pg?', [ middleware.auth, middleware.validateReq ], (req, res) => {
  esovdb.queryVideos(req, res);
});

/**
 *  API endpoint for querying the ESOVDB (Video table) for a single YouTube video—returns simplified JSON. All request params and request query params documented in [esovdb.queryYouTubeVideos]{@link esovdb.queryYouTubeVideos}.
 *  @requires esovdb
 *  @callback esovdb.queryYouTubeVideos
 */

app.get('/v1/videos/youtube/:id?', [ middleware.validateReq, middleware.allowCORS ], (req, res) => {
  esovdb.queryYouTubeVideos(req, res);
});

/**
 *  API endpoint for selecting a single video from the ESOVDB by its ESOVDB Airtable ID—returns JSON. With the premium header 'esovdb-no-cache' this endpoint always returns fresh results.
 *  @requires esovdb
 *  @callback esovdb.getVideoById
 */

app.get('/v1/videos/:id', [ middleware.auth, middleware.validateReq ], (req, res) => {
  esovdb.getVideoById(req, res);
});

/**
 *  API endpoint for back-syncing Zotero data with the ESOVDB after adding or updating items on Zotero.
 *  @requires esovdb
 *  @callback esovdb.updateVideos
 */

app.post('/:table/update', [ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res) => {
  esovdb.updateTable(req, res);
});

/**
 *  Combined API endpoints for ESOVDB POST (onCreateRecord), PUT (onUpdateRecord), OPTIONS (CORS pre-flight), and DELETE (onDeleteRecord) automations
 *  @requires zotero
 *  @callback zotero.sync
 */

app.route('/zotero/:kind')
  .post([ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res) => {
    console.log('Performing zotero/${req.params.kind}/create API request...');
    zotero.sync(req, res);
  })
  .put([ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res) => {
    console.log('Performing zotero/${req.params.kind}/update API request...');
    zotero.sync(req, res);
  })
  .options(cors())
  .delete([ middleware.auth, middleware.validateReq, cors(), express.urlencoded({ extended: true }), express.json() ], (req, res) => {
    console.log('Performing zotero/${req.params.kind}/delete API request...');
    zotero.sync(req, res);
  });

/**
 *  API POST endpoint for broadcasting batches of new submissions from the ESOVDB YouTube Watchlist Github Actions Workflow
 *  @requires webhooks
 *  @callback webhooks.execute
 */

app.post('/webhooks/discord/watchlist-submission-total', [ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], async (req, res) => {
  console.log('Performing webhooks/discord/newWatchlistSubmissionTotal API request...');
  const response = await webhooks.execute(req.body, 'discord', 'newWatchlistSubmissionTotal');
  if (!response || response.status >= 400) throw new Error('[ERROR] Unable to send Discord watchlist submission total webhook.');
  res.status(200).send(response.config && response.config.data ? response.config.data : 'OK');
});

/**
 *  API POST endpoint for handling new submissions from the ESOVDB Discord #submissions channel
 *  @requires webhooks
 *  @callback webhooks.execute
 */

app.post('/webhooks/discord', [ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], async (req, res) => {
  console.log('Performing webhooks/discord/userSubmission API request...');
  const response = await webhooks.execute(req.body, 'discord', 'userSubmission');
  if (!response || response.status >= 400) throw new Error('[ERROR] Unable to respond to Discord user submission.');
  res.status(200).send(response.config && response.config.data ? response.config.data : 'OK');
});

/**
 *  Combined API endpoints sfor handling new submissions sent to the ESOVDB Twitter account, @esovdb with a hashtag of #submit, as well as Twitter's webhook verification
 *  @requires webhooks
 *  @callback webhooks.execute
 */

app.route('/webhooks/twitter')
  .all([ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res, next) => { next(); })
  .post(async (req, res) => {
    console.log('Performing webhooks/twitter API request...');
    const response = await webhooks.execute(req.body, 'twitter', '{event.type}');
    if (!response || response.status >= 400) throw new Error('[ERROR] Unable to respond to Twitter webhook event.');
    res.status(200).send(response.config && response.config.data ? response.config.data : 'OK');
  })
  .get((req, res) => {
    res.status(200).send('OK (Placeholder)');
  });

/**
 *  Combined API endpoints for managing ESOVDB webhook subscriptions
 *  @requires webhooks
 *  @callback webhooks.list, webhooks.manage
 */

app.route('/webhooks')
  .get([ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res) => {
    console.log('Performing webhooks/list API request...');
    webhooks.list(req, res);
  })
  .post([ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res) => {
    console.log('Performing webhooks/create API request...');
    webhooks.manage(req, res);
  })
  .put([ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res) => {
    console.log('Performing webhooks/update API request...');
    webhooks.manage(req, res);
  })
  .options(cors())
  .delete([ middleware.auth, middleware.validateReq, cors(), express.urlencoded({ extended: true }), express.json() ], (req, res) => {
    console.log('Performing webhooks/delete API request...');
    webhooks.manage(req, res);
  });

/**
 *  API endpoint for submitting a YouTube channel's videos to the ESOVDB
 *  @requires youtube
 *  @callback - youtube.getChannelVideos
 */

app.post('/submissions/youtube/channel', [ middleware.auth, middleware.validateReq, cors(), express.urlencoded({ extended: true }), express.json() ], (req, res) => {
  console.log('Performing submissions/youtube channel API request...');
  youtube.getChannelVideos(req, res);
});

/**
 *  API endpoint for submitting a YouTube playlist's videos to the ESOVDB
 *  @requires youtube
 *  @callback - youtube.getPlaylistVideos
 */

app.post('/submissions/youtube/playlist', [ middleware.auth, middleware.validateReq, cors(), express.urlencoded({ extended: true }), express.json() ], (req, res) => {
  console.log('Performing submissions/youtube playlist API request...');
  youtube.getPlaylistVideos(req, res);
});

/**
 *  API endpoint for submitting a single YouTube video to the ESOVDB (e.g. via "Is Video on ESOVDB?" iOS shorcut)
 *  @requires esovdb
 *  @callback - esovdb.newVideoSubmission
 */

app.post('/submissions/youtube/video/:id', [ middleware.auth, middleware.validateReq, cors(), express.urlencoded({ extended: true }), express.json() ], (req, res) => {
  console.log('Performing submissions/youtube single video API request...');
  esovdb.newVideoSubmission(req, res);
});

/**
 *  API endpoint for querying the entire ESOVDB submissions table—returns JSON. Used with the premium header 'esovdb-no-cache', always returns fresh results.
 *  @requires esovdb
 *  @callback esovdb.getLatestSubmissions
 */

app.get('/v1/submissions', [ middleware.auth, middleware.validateReq ], (req, res) => {
  esovdb.getLatestSubmissions(req, res);
});

/**
 *  API endpoint for querying the ESOVDB submissions table—returns JSON. All request params and request query params documented in [esovdb.querySubmissions]{@link esovdb.querySubmissions}.
 *  @requires esovdb
 *  @callback esovdb.querySubmissions
 */

app.get('/v1/submissions/query/:pg?', [ middleware.auth, middleware.validateReq ], (req, res) => {
  esovdb.querySubmissions(req, res);
});

/**
 *  API endpoint for querying the ESOVDB (both Videos and Submissions tables) for a single YouTube video—returns simplified JSON. All request params and request query params documented in [esovdb.queryYouTubeVideosAndSubmissions]{@link esovdb.queryYouTubeVideosAndSubmissions}.
 *  @requires esovdb
 *  @callback esovdb.queryYouTubeVideosAndSubmissions
 */

app.get('/v1/submissions/youtube/video/:id?', [ middleware.validateReq, middleware.allowCORS ], (req, res) => {
  esovdb.queryYouTubeVideosAndSubmissions(req, res);
});

/**
 *  Combined API endpoints for managing the ESOVDB watchlist
 *  @requires esovdb
 *  @callback esovdb.watchlist.list, esovdb.watchlist.add, esovdb.watchlist.update, esovdb.watchlist.remove
 */

app.route('/watch')
  .get(
    [ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ],
    async (req, res) => {
      console.log('Performing watch/list API request...');

      try {
        const includeInactive = req.query && typeof req.query.includeInactive !== 'undefined' && String(req.query.includeInactive).toLowerCase() === 'true';
        const records = await esovdb.watchlist.list({ includeInactive });
        res.status(200).send(records);
      } catch (err) {
        console.error('[ERROR] watch/list:', err);
        res.status(500).send(String(err && err.message ? err.message : err));
      }
    }
  )
  .post(
    [ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ],
    async (req, res) => {
      console.log('Performing watch/add API request...');
      
      try {
        const body = req.body || {};
        const created = await esovdb.watchlist.add(body);
        res.status(201).send(created);
      } catch (err) {
        console.error('[ERROR] watch/add:', err);
        res.status(500).send(String(err && err.message ? err.message : err));
      }
    }
  )
  .patch(
    [ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ],
    async (req, res) => {
      console.log('Performing watch/update API request...');
      
      try {
        const body = req.body || {};
        const sourceId = body.sourceId;
        const checkUpdatedItem = Boolean(body.checkUpdatedItem);

        if (!sourceId) return res.status(400).send('Missing required field "sourceId" in request body.');

        const fields = Object.assign({}, body);
        delete fields.sourceId;
        delete fields.checkUpdatedItem;

        const updated = await esovdb.watchlist.update(
          { sourceId: sourceId },
          fields,
          { checkUpdatedItem: checkUpdatedItem }
        );

        res.status(200).send(updated);
      } catch (err) {
        console.error('[ERROR] watch/update:', err);
        res.status(500).send(String(err && err.message ? err.message : err));
      }
    }
  )
  .options(cors())
  .delete(
    [ middleware.auth, middleware.validateReq, cors(), express.urlencoded({ extended: true }), express.json() ],
    async (req, res) => {
      console.log('Performing watch/delete API request...');
      
      try {
        const body = req.body || {};
        const sourceId = body.sourceId;

        if (!sourceId) return res.status(400).send('Missing required field "sourceId" in request body.');

        await esovdb.watchlist.remove({ sourceId: sourceId });
        res.status(204).end();
      } catch (err) {
        console.error('[ERROR] watch/delete:', err);
        res.status(500).send(String(err && err.message ? err.message : err));
      }
    }
  );

/**
 *  API endpoint for retrieving a single watchlist item from the ESOVDB
 *  @requires esovdb
 *  @callback esovdb.watchlist.getBySourceId
 */

app.route('/watch/:sourceId')
  .get(
    [ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ],
    async (req, res) => {
      console.log('Performing watch/get API request...');
      
      try {
        const sourceId = req.params.sourceId;
        const record = await esovdb.watchlist.getBySourceId(sourceId);
        res.status(200).send(record);
      } catch (err) {
        console.error('[ERROR] watch/get:', err);
        res.status(404).send(String(err && err.message ? err.message : err));
      }
    }
  )
  .options(cors());

/**
 *  API endpoint which is the end of all other endpoints
 *  @callback - Sends an HTTP 400 Bad Request status code and an error message in JSON format
 */

app.get('/*', (req, res) => {
  const err = {
    Error: 'API endpoint not found',
  };

  res.status(400).end(JSON.stringify(err));
});

/**
 *  Starts server on port 3000, my particular setup requires a host of '0.0.0.0', but you can put anything you want here or leave the host argument out.
 *  @callback - Logs the start of the server session and port on which the server is listen.
 */

const listener = app.listen(3000, '0.0.0.0', () => {
  monitor.ping({ state: 'ok', message: 'API server listening on port 3000.' });
  db.connect();
  console.log('API server listening on port ' + listener.address().port);
});

/**
 *  Instance of appReady, for graceful startup of server with PM2, etc.
 *  @requires util
 */

appReady(() => {
  monitor.ping({ state: 'run', message: 'API server (re)started.' });
});

/**
 *  Instance of node-cleanup, for graceful shutdown of server.
 *  @requires node-cleanup
 */

cleanUp((code, signal) => {
  db.quit();
  monitor.ping({ status: 'complete', message: 'API server shut down.' })
});