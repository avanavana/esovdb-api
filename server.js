const dotenv = require('dotenv').config();
const express = require('express');
const cleanUp = require('node-cleanup');
const { patternsToRegEx } = require('./util');
const esovdb = require('./esovdb');
const zotero = require('./zotero');

const app = express();

const middleware = {
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

// app.use(/\/esovdb\/.*|\/zotero\/.*/, (req, res, next) => {
//   const d = new Date(), ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim();
//   console.log(`[${d.toLocaleString()}] ip: ${ip}`);
  
//   if (patternsToRegEx(process.env.WHITELIST).test(ip)) {
//     console.log('Access granted.');
//     next();
//   } else {
//     const err = {
//       Error: 'Access denied.',
//     };
    
//     console.error(err.Error);
//     res.status(401).send(JSON.stringify(err));
//   }
// });

app.get('/esovdb/videos/list/:pg?', middleware.validateReq, (req, res) => {
  esovdb.listVideos(req, res);
});

app.post('/esovdb/videos/update', [ middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res) => {
  esovdb.updateVideos(req, res);
});

// app.use(express.urlencoded({ extended: true }));
// app.use(express.json());

app.post('/zotero/create', [ middleware.validateReq, express.urlencoded({ extended: true }), express.json() ], (req, res) => {
  zotero.postItem(req, res);
});

app.get('/*', (req, res) => {
  const err = {
    Error: 'API endpoint not found',
  };

  res.status(400).end(JSON.stringify(err));
});

const listener = app.listen(3000, '0.0.0.0', () => {
  console.log('API proxy listening on port ' + listener.address().port);
});

cleanUp();