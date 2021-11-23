/**
 *  @file Twitter Functions
 *  @author Avana Vana <dear.avana@gmail.com>
 *  @module twitter
 *  @see {@link https://github.com/PLhery/node-twitter-api-v2}
 */

const { TwitterApi } = require('twitter-api-v2');
const dotenv = require('dotenv').config();

const twitter = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

/** @constant {string} boilerplate - Text to include at the end of every tweet, regardless of method */
const boilerplate = `See what's new at www.esovdb.org! #esovdb #esovdbsubmissions #earthscience #geology`;

/** @constant {Map} topicHashtags - ESOVDB topics mapped to hashtags to be automatically included on tweets for single video additions to the ESOVDB */
const topicHashtags = new Map([
  ['Mantle Geodynamics, Geochemistry, Convection, Rheology, & Seismic Imaging and Modeling', '#mantle #geodynamics'],
  ['Igneous & Metamorphic Petrology, Volcanism, & Hydrothermal Systems', '#volcanology #petrology'],
  ['Alluvial, Pluvial & Terrestrial Sedimentology, Erosion & Weathering, Geomorphology, Karst, Groundwater & Provenance', '#sedimentology'],
  ['Early Earth, Life\'s Origins, Deep Biosphere, and the Formation of the Planet', '#originoflife'],
  ['Geological Stories, News, Tours, & Field Trips', '#geologicalstories'],
  ['History, Education, Careers, Field Work, Economic Geology, & Technology', '#geologists'],
  ['Glaciation, Atmospheric Science, Carbon Cycle, & Climate', '#climate'],
  ['The Anthropocene', '#anthropocene'],
  ['Geo-Archaeology', '#geoarchaeology'],
  ['Paleoclimatology, Isotope Geochemistry, Radiometric Dating, Deep Time, & Snowball Earth', '#paleoclimate'],
  ['Seafloor Spreading, Oceanography, Paleomagnetism, & Geodesy', '#oceanography'],
  ['Tectonics, Terranes, Structural Geology, & Dynamic Topography', '#tectonics #platetectonics'],
  ['Seismology, Mass Wasting, Tsunamis, & Natural Disasters', '#seismology #earthquake'],
  ['Minerals, Mining & Resources, Crystallography, & Solid-state Chemistry', '#minerals #mining'],
  ['Marine & Littoral Sedimentology, Sequence Stratigraphy, Carbonates, Evaporites, Coal, Petroleum, and Mud Volcanism', '#sedimentology'],
  ['Planetary Geology, Impact Events, Astronomy, & the Search for Extraterrestrial Life', '#meteorite #impactevent'],
  ['Paleobiology, Mass Extinctions, Fossils, & Evolution', '#paleontology #paleobiology']
]);

/**
 *  Prepares text for a new tweet from ESODVB item data 
 *
 *  @function formatTweet
 *  @param {Object} item - ESOVDB item data on its way to Zotero
 *  @returns {string} Tweet text for a single item added to the ESOVDB
 */

const formatTweet = (item) => `New submission! Just added "${item.title}" ${item.url} (${item.runningTime}) to the ESOVDB. ${boilerplate} ${topicHashtags.get(item.topic)}`;

module.exports = {
  
  /**
   *  @typedef {Object} TweetResponse
   *  @property {number} id - Tweet id number
   *  @property {string} text - Tweet text content
   */
  
  /**
   *  Posts a tweet for a single video added to the ESOVDB
   *
   *  @async
   *  @function tweet
   *  @param {Object} item - ESOVDB item data on its way to Zotero
   *  @returns {TweetResponse} Twitter tweet response (e.g. { id: '1463065751150112768', text: '[Test] Tweeting from node.js' })
   *  @throws Will throw an error if the response lacks an id, meaning nothing was tweeted
   */
  
  tweet: async (item) => {
    const { data } = await twitter.v2.post('tweets', { text: formatTweet(item) });
    if (!data.id) throw new Error('[ERROR] Unable to post tweet.');
    return data;
  },
  
  /**
   *  Posts a tweet for a batch of videos added to the ESOVDB
   *
   *  @async
   *  @function batchTweet
   *  @param {Object[]} items - Array of ESOVDB item data on their way to Zotero
   *  @returns {TweetResponse} Twitter tweet response (e.g. { id: '1463065751150112768', text: '[Test] Tweeting from node.js' })
   *  @throws Will throw an error if the response lacks an id, meaning nothing was tweeted
   */
  
  batchTweet: async (items) => {
    const { data } = await twitter.v2.post('tweets', { text: `Just added ${items.length} items to the ESOVDB. ${boilerplate}}` });
    if (!data.id) throw new Error('[ERROR] Unable to post batch tweet.');
    return data;
  },
  
}