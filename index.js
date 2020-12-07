const express = require('express');
const app = express();

const connect = require('./connect');

app.get('/api/videos/list/:page', (req, res) => {
  console.log('Performing videos.list() API request');
  connect.listVideos(req, res);
});

app.get('*', (req, res) => {
  const response = {
    Error: 'API endpoint not found',
  };

  res.status(400).end(JSON.stringify(response));
});

const listener = app.listen(process.env.PORT, () => {
  console.log('Your app is listening on port ' + listener.address().port);
});
