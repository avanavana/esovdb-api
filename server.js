/**
 *  @file Express server with IP validation middleware and graceful cleanup
 *  @author Avana Vana <dear.avana@gmail.com>
 *  @version 1.7.0
 */

const dotenv = require('dotenv').config();
const express = require('express');
const cleanUp = require('node-cleanup');
const { patternsToRegEx } = require('./util');
const esovdb = require('./esovdb');
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
  }
}

/**
 *  API endpoint for querying the ESOVDB, returns JSON. All request params and request query params documented in [esovdb.listVideos]{@link esovdb.listVideos}.
 *  @requires esovdb
 *  @callback esovdb.listVideos
 */

app.get('/esovdb/videos/list/:pg?', middleware.validateReq, (req, res) => {
  esovdb.listVideos(req, res);
});

/**
 *  API endpoint for querying the ESOVDB for syncing with YouTube, returns simplified JSON. All request params and request query params documented in [esovdb.listYouTubeVideos]{@link esovdb.listYouTubeVideos}.
 *  @requires esovdb
 *  @callback esovdb.listYouTubeVideos
 */

app.get('/esovdb/videos/youtube/:pg?', middleware.validateReq, (req, res) => {
  esovdb.listYouTubeVideos(req, res);
});

/**
 *  API endpoint for back-syncing Zotero data with the ESOVDB after adding or updating items on Zotero.
 *  @requires esovdb
 *  @callback esovdb.updateVideos
 */

app.post('/esovdb/:table/update', [ middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res) => {
  esovdb.updateTable(req, res);
});

/**
 *  API POST endpoint for ESOVDB video.onCreateRecord automation
 *  @requires zotero
 *  @callback zotero.syncItems
 */

app.post('/zotero', [ middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res) => {
  console.log(`Performing zotero/create API request...`);
  zotero.syncItems(req, res);
});

/**
 *  API PUT endpoint for ESOVDB video.onUpdateRecord automation
 *  @requires zotero
 *  @callback zotero.syncItems
 */

app.put('/zotero', [ middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res) => {
  console.log(`Performing zotero/update API request...`);
  zotero.syncItems(req, res);
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
 *  @callback - Logs the start of the server session and port on which the server is listening.
 */

const listener = app.listen(3000, '0.0.0.0', () => {
  console.log('API proxy listening on port ' + listener.address().port);
});

/**
 *  Instance of node-cleanup, for graceful shutdown of server.
 *  @requires node-cleanup
 */

cleanUp();