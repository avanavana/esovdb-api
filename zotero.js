const dotenv = require('dotenv').config();
const axios = require('axios');

const { formatDuration, formatDate, packageAuthors } = require('./util');

const zoteroHeaders = {
  Authorization: 'Bearer ' + process.env.ZOTERO_API_KEY,
  'Zotero-API-Version': '3',
  'User-Agent': 'airtable-api-proxy/1.0.0',
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

const getTemplate = async () => {
  console.log('Retrieving template from Zotero...');
  try {
    const response = await zotero.get('items/new', {
      params: { itemType: 'videoRecording' },
    });

    if (response.data) {
      console.log('› Successfully retrieved template.');
    }
    return response.data;
  } catch (err) {
    console.error(err);
    throw new Error(err);
  }
};

const addItems = async (items) => {
  try {
    const response = await zoteroLibrary.post('items', items);
    const successful = Object.values(response.data.successful);
    const failed = Object.values(response.data.failed);

    if (successful.length > 0) {
      log(
        chalk.green(
          `› Successfully added ${successful.length} item${
            successful.length > 1 ? 's' : ''
          }.`
        )
      );
    }

    if (failed.length > 0) {
      console.error(chalk.bold.red(`› Failed to add ${failed.length} videos.`));
      const failedItems = JSON.stringify(response.data.failed);

      fs.writeFile('failed.json', failedItems, 'utf8', (err) => {
        if (err) {
          console.error(
            chalk.bold.red(
              'An error occured while writing JSON Object to File.'
            )
          );
        }
      });
    }

    return { successful: successful, failed: failed };
  } catch (err) {
    console.error(err);
    throw new Error(err);
  }
};

const formatItems = (video, template) => {
  let extras = [];
  
  video.presenters = packageAuthors(video.presentersFirstName, video.presentersLastName);

  if (video.topic) extras.push({ title: 'Topic', value: video.topic });
  if (video.location) extras.push({ title: 'Location', value: video.location });
  if (video.plusCode)
    extras.push({ title: 'Plus Code', value: video.plusCode });
  if (video.learnMore)
    extras.push({ title: 'Learn More', value: video.learnMore });

  const presenters =
    video.presenters.length > 0
      ? video.presenters.map((presenter) => {
          if (presenter.lastName !== 'Unknown') {
            return !presenter.firstName || !presenter.lastName
              ? {
                  creatorType: 'contributor',
                  name: presenter.firstName || '' + presenter.lastName || '',
                }
              : {
                  creatorType: 'contributor',
                  firstName: presenter.firstName,
                  lastName: presenter.lastName,
                };
          }
        })
      : [];

  return {
    ...template,
    itemType: 'videoRecording',
    title: video.title || '',
    creators: presenters,
    abstractNote: video.desc || '',
    videoRecordingFormat: video.format || '',
    seriesTitle: video.series[0] || '',
    volume: video.vol ? `${video.vol || ''}:${video.no || ''}` : video.no || '',
    numberOfVolumes: video.seriesCount > 1 ? video.seriesCount : '',
    place: video.provider || '',
    studio: video.publisher[0] || '',
    date: video.year || '',
    runningTime: formatDuration(video.runningTime) || '',
    language: video.language || '',
    ISBN: '',
    shortTitle: '',
    url: video.url || '',
    accessDate: formatDate(video.accessDate) || '',
    archive: 'Earth Science Online Video Database',
    archiveLocation:
      'https://airtable.com/tbl3WP689vHdmg7P2/viwD9Tpr6JAAr97CW/' +
      video.recordId,
    libraryCatalog: '',
    callNumber: video.esovdbId || '',
    rights: '',
    extra: extras.map((item) => item.title + ': ' + item.value).join('\n'),
    tags: [],
    collections: ['7J7AJ2BH'],
    relations: {},
  };
};

module.exports = {
  postItem: async (req, res) => {
    const template = await getTemplate();
    const videos = Array.isArray(req.body) ? req.body : Array.of(req.body);
    let items = videos.map((video) => formatItems(video, template));
    res.status(200).send(JSON.stringify(items));
  }
}