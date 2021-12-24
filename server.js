/**
 *  @file Express server with IP validation middleware and graceful cleanup
 *  @author Avana Vana <dear.avana@gmail.com>
 *  @version 1.7.0
 */

const dotenv = require('dotenv').config();
const express = require('express');
const cleanUp = require('node-cleanup');
const cors = require('cors');
const { db, monitor } = require('./batch');
const { appReady, patternsToRegEx } = require('./util');
const cron = require('./cron');
const esovdb = require('./esovdb');
const webhook = require('./webhook');
const zotero = require('./zotero');

const app = express();

const middleware = {
  
  /**
   *  Middleware for blackquerying or whitequerying IP addresses and/or IP address ranges, which can be passed to specific endpoints
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
    if ((req.headers['esovdb-key'] && req.headers['esovdb-key'] === process.env.ESOVDB_KEY) || (req.headers['X-RapidAPI-Proxy-Secret'] && req.headers['X-RapidAPI-Proxy-Secret'] === process.env.RAPIDAPI_SECRET)) {
      console.log('ESOVDB key validated.');
      next();
    } else {
      console.error(`Unauthorized attempted access of ${req.path} without a valid ESOVDB key.`);
      res.status(401).send('Unauthorized access. Visit https://rapidapi.com/avanavana/api/the-earth-science-online-video-database for access.');
    }
  },
  
  allowCORS: (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    next();
  }
}

/**
 *  API endpoint for querying the entire ESOVDB, returns JSON. Used with the premium header 'esovdb-no-cache', always returns fresh results.
 *  @requires esovdb
 *  @callback esovdb.getLatest
 */

app.get('/v1/videos', [ middleware.auth, middleware.validateReq ], async (req, res) => {
  await esovdb.getLatest(req, res);
});

/**
 *  API endpoint for querying the ESOVDB, returns JSON. All request params and request query params documented in [esovdb.queryVideos]{@link esovdb.queryVideos}.
 *  @requires esovdb
 *  @callback esovdb.queryVideos
 */

app.get('/v1/videos/query/:pg?', [ middleware.auth, middleware.validateReq ], (req, res) => {
  esovdb.queryVideos(req, res);
});

/**
 *  API endpoint for querying the ESOVDB for syncing with YouTube, returns simplified JSON. All request params and request query params documented in [esovdb.queryYouTubeVideos]{@link esovdb.queryYouTubeVideos}.
 *  @requires esovdb
 *  @callback esovdb.queryYouTubeVideos
 */

app.get('/v1/videos/youtube/:pg?', [ middleware.auth, middleware.validateReq ], (req, res) => {
  esovdb.queryYouTubeVideos(req, res);
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
    console.log(`Performing zotero/${req.params.kind}/create API request...`);
    zotero.sync(req, res, req.params.kind, 'create');
  })
  .put([ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res) => {
    console.log(`Performing zotero/${req.params.kind}/update API request...`);
    zotero.sync(req, res, req.params.kind, 'update');
  })
  .options(cors())
  .delete([ middleware.auth, middleware.validateReq, cors(), express.urlencoded({ extended: true }), express.json() ], (req, res) => {
    console.log(`Performing zotero/${req.params.kind}/delete API request...`);
    zotero.sync(req, res, req.params.kind, 'delete');
  });

/**
 *  API POST endpoint for handling new submissions from the ESOVDB Discord #submissions channel
 *  @requires webhook
 *  @callback webhook.execute
 */

app.post('/webhook/discord', [ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], async (req, res) => {
  console.log(`Performing webhook/discord/userSubmission API request...`);
  const response = await webhook.execute(req.body, 'discord', 'userSubmission');
  if (response.status >= 400) throw new Error('[ERROR] Unable to respond to Discord user submission.')
  res.status(200).send(response.config.data)
});

/**
 *  Combined API endpoints for handling new submissions sent to the ESOVDB Twitter account, @esovdb with a hashtag of #submit, as well as Twitter's webhook verification
 *  @requires webhook
 *  @callback webhook.execute
 */

app.route('/webhook/twitter')
  .all([ middleware.auth, middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res, next) => { next(); })
  .post(async (req, res) => {
    console.log(`Performing webhook/twitter API request...`);
    const response = await webhook.execute(req.body, 'twitter', '{event.type}');
    if (response.status >= 400) throw new Error('[ERROR] Unable to respond to Twitter webhook event.')
    res.status(200).send(response.config.data)
  })
  .get(async (req, res) => {
    res.status(200).send('OK (Placeholder)');
  });

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

const listener = app.listen(3000, '0.0.0.0', async () => {
  monitor.ping({ state: 'ok', message: 'API server listen on port 3000.' });
  await db.connect();
  cron.startJobs([ cron.getLatest ]);
  console.log('API proxy listen on port ' + listener.address().port);
});

/**
 *  Instance of appReady, for graceful startup of server with PM2, etc.
 *  @requires util
 */

appReady(() => { monitor.ping({ state: 'run', message: 'API Server (re)started.' }); });

/**
 *  Instance of node-cleanup, for graceful shutdown of server.
 *  @requires node-cleanup
 */

cleanUp(async (code, signal) => {
  await db.quit();
  cron.destroyJobs();
  monitor.ping({ status: 'complete', message: 'API server shut down.' })
});