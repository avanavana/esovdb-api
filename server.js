const dotenv = require('dotenv').config();
const express = require('express');
const app = express();
const cleanUp = require('node-cleanup');

const esovdb = require('./esovdb');

app.use((req, res, next) => {
  let d = new Date();
  const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim();
  console.log(`[${d.toLocaleString()}] ip: ${ip}`);
  if (process.env.WHITELIST.split(' ').some(allowed => allowed === ip)) {
    console.log('Access granted.');
    next();
  } else {
    const err = {
      Error: 'Access denied.',
    };
    console.error(err.Error);
    res.status(401).end(JSON.stringify(err));
  }
});

app.get('/esovdb/videos/list/:pg?', (req, res) => {
  esovdb.listVideos(req, res);
});

app.use(express.urlencoded({ extended: true }));

app.post('/zotero/create', (req, res) => {
  //zotero.postItem(req, res);
  console.log(req.body);
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