const dotenv = require('dotenv').config();
const express = require('express');
const app = express();
const cleanUp = require('node-cleanup');

const connect = require('./connect');

app.get('/api/videos/list/:pg?', (req, res) => {
  connect.listVideos(req, res);
});

app.get('/*', (req, res) => {
  const err = {
    Error: 'API endpoint not found',
  };

  res.status(400).end(JSON.stringify(err));
});

const listener = app.listen(3000, '0.0.0.0', () => {
  console.log('Airtable API proxy listening on port ' + listener.address().port);
});

cleanUp();