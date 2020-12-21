const dotenv = require('dotenv').config();
const axios = require('axios');

const zoteroHeaders = {
  Authorization: 'Bearer ' + process.env.ZOTERO_API_KEY,
  'Zotero-API-Version': '3',
  'User-Agent': 'zotero-esovdb/' + version || '1.0.0',
};

const zoteroLibrary = axios.create({
  baseURL: `https://api.zotero.org/users/${process.env.ZOTERO_USER}/`,
  headers: zoteroHeaders,
});

const zotero = axios.create({
  baseURL: 'https://api.zotero.org/',
  headers: zoteroHeaders,
});

zoteroLibrary.defaults.headers.post['Content-Type'] = 'application/json';

const Bottleneck = require('bottleneck');
const rateLimiter = new Bottleneck({ minTime: 10000 });

const sendResultWithResponse = (data, res) => {
  res.status(200).end(JSON.stringify(data));
}

const getTemplate = async () => {
  log('Retrieving template from Zotero...');
  try {
    const response = await zotero.get('items/new', {
      params: { itemType: 'videoRecording' },
    });

    if (response.data) {
      log(chalk.green('› Successfully retrieved template.'));
    }
    return response.data;
  } catch (err) {
    console.error(chalk.bold.red(err));
    throw new Error(err);
  }
};

module.exports = {
  postItem: (req, res) => {
    
  }
}