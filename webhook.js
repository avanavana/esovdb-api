/**
 *  @file Webhook Functions
 *  @author Avana Vana <dear.avana@gmail.com>
 *  @module webhook
 *  @see {@link https://discord.com/developers/docs/resources/webhook#execute-webhook}
 */

const dotenv = require('dotenv').config();
const axios = require('axios');
const { truncate, stringifyCreators } = require('./util');

/** @constant {RegExp} regexYT - Regular expression for matching and extracting a YouTube videoId from a URL or on its own */
const regexYT = /^(?!rec)(?![\w\-]{12,})(?:.*youtu\.be\/|.*v=)?([\w\-]{10,12})&?.*$/;

/** @constant {RegExp} regexTopic - Regular expression for matching and extracting an ESOVDB topic from a mixed Zotero 'extras' field */
const regexTopic = /Topic:\s(.*)\n?/;

/** @constant {RegExp} regexTags - Regular expression for matching and extracting a list of tags from a mixed Zotero 'extras' field */
const regexTags = /Tags:\s(.*)\n?/;

/** @constant {RegExp} regexLearnMore - Regular expression for matching and extracting the 'Learn More' link from a mixed Zotero 'extras' field */
const regexLearnMore = /Learn More:\s(.*)\n?/;

/** @constant {Map} topicMetadata - Maps topic names from the ESOVDB to their ESOVDB hex colors and Discord channel equivalents */
const topicMetadata = new Map([
  ['Mantle Geodynamics, Geochemistry, Convection, Rheology, & Seismic Imaging and Modeling', { 'color': 'fee2d5', 'channel': 'mantle-and-geodynamics' }],
  ['Igneous & Metamorphic Petrology, Volcanism, & Hydrothermal Systems', { 'color': 'ffdce5', 'channel': 'volcanism-and-petrology' }],
  ['Alluvial, Pluvial & Terrestrial Sedimentology, Erosion & Weathering, Geomorphology, Karst, Groundwater & Provenance', { 'color': 'c2f5e9', 'channel': 'sedimentology' }],
  ['Early Earth, Life\'s Origins, Deep Biosphere, and the Formation of the Planet', { 'color': 'd1f7c4', 'channel': 'origins-of-life-and-earth' }],
  ['Geological Stories, News, Tours, & Field Trips', { 'color': 'ffeab6', 'channel': 'field-trips-and-stories' }],
  ['History, Education, Careers, Field Work, Economic Geology, & Technology', { 'color': 'eeeeee', 'channel': 'the-profession' }],
  ['Glaciation, Atmospheric Science, Carbon Cycle, & Climate', { 'color': 'd0f0fd', 'channel': 'climate-and-atmosphere' }],
  ['The Anthropocene', { 'color': 'eeeeee', 'channel': 'anthropocene' }],
  ['Geo-Archaeology', { 'color': 'eeeeee', 'channel': 'geo-archaeology' }],
  ['Paleoclimatology, Isotope Geochemistry, Radiometric Dating, Deep Time, & Snowball Earth', { 'color': 'd0f0fd', 'channel': 'geochemistry-and-dating' }],
  ['Seafloor Spreading, Oceanography, Paleomagnetism, & Geodesy', { 'color': 'cfdfff', 'channel': 'oceanography' }],
  ['Tectonics, Terranes, Structural Geology, & Dynamic Topography', { 'color': 'ffeab6', 'channel': 'tectonics-and-terranes' }],
  ['Seismology, Mass Wasting, Tsunamis, & Natural Disasters', { 'color': 'ffdaf6', 'channel': 'seismology-and-hazards' }],
  ['Minerals, Mining & Resources, Crystallography, & Solid-state Chemistry', { 'color': 'ffdce5', 'channel': 'mining-and-minerals' }],
  ['Marine & Littoral Sedimentology, Sequence Stratigraphy, Carbonates, Evaporites, Coal, Petroleum, and Mud Volcanism', { 'color': 'c2f5e9', 'channel': 'sedimentology' }],
  ['Planetary Geology, Impact Events, Astronomy, & the Search for Extraterrestrial Life', { 'color': 'ede2fe', 'channel': 'impacts-and-planetary-geology' }],
  ['Paleobiology, Mass Extinctions, Fossils, & Evolution', { 'color': 'd1f7c4', 'channel': 'paleobiology' }]
]);

/** @constant {Map} webhook - Maps a given webhook provider to an object containing an axios instance and a set of endpoints with action identifiers */
const webhook = new Map([
    ['discord',
        {
            instance: axios.create({
                baseURL: 'https://discord.com/api/webhooks',
                headers: {
                    'Content-Type': 'application/json'
                }
            }),
            endpoints: {
                newSubmission: process.env.WEBHOOK_DISCORD_NEWSUBMISSION,
                newSubmissionTotal: process.env.WEBHOOK_DISCORD_NEWSUBMISSIONTOTAL
            }
        }
    ]
]);

/**
 *  Uses formulae to construct a properly-formatted Discord message for use with webhooks, given a payload and a webhook provider and action identifier
 *
 *  @function message
 *  @param {*} payload - Data sent to the webhook, to be consumed by the message formula in constructing a discord message
 *  @param {string} provider - An identifier for the service providing the webhook. (e.g. 'discord')
 *  @param {string} action - An identifier for the specific webhook to execute, from a given provider (e.g. 'newSubmission')
 *  @returns {Object} A properly-formatted Discord message for use with webhooks, containing various allowed fields
 *  @throws {TypeError} Will throw if function is missing arguments
 */

const message = (payload, provider, action) => {                    
  switch (provider + '-' + action) {
    case 'discord-newSubmissionTotal':
      return { 'content': payload === 1 ? 'New submission:' : `${payload} new submissions:` };
    case 'discord-newSubmission':
      const draft = {
        'content': `New submission on the Earth Science Online Video Database! #${topicMetadata.get(payload.extra.match(regexTopic)[1]).channel}`,
        'embeds': [
          {
            'title': `${payload.title} (${payload.date}) [${payload.runningTime}]`,
            'url': payload.archiveLocation,
            'color': regexTopic.test(payload.extra) ? parseInt(topicMetadata.get(payload.extra.match(regexTopic)[1]).color, 16) : parseInt('eeeeee', 16),
            'author': {
              'name': payload.videoRecordingFormat || 'Video'
            },
            'footer': {
              'text': payload.url + ' - ' + payload.callNumber
            },
            'fields': [
              {
                'name': 'Topic',
                'value': payload.extra.match(regexTopic)[1]
              }
            ]
          }
        ]
      };
      if (payload.abstractNote) draft.embeds[0].description = truncate(payload.abstractNote, 200);
      if (regexYT.test(payload.url)) draft.embeds[0].image = { 'url': `http://i3.ytimg.com/vi/${payload.url.match(regexYT)[1]}/hqdefault.jpg` };
      if (stringifyCreators(payload.creators) !== 'Unknown') draft.embeds[0].fields.push({ 'name': 'Presenter(s)', 'value': stringifyCreators(payload.creators) });
      if (payload.seriesTitle) draft.embeds[0].fields.push({ 'name': 'Series', 'value': `${payload.seriesTitle} ${payload.volume ? '(Vol. ' + payload.volume + ')' : '' }`});
      if (payload.studio !== 'Independent') draft.embeds[0].fields.push({ 'name': 'Publisher', 'value': payload.studio });
      if (regexTags.test(payload.extra)) draft.embeds[0].fields.push({ 'name': 'Tags', 'value': payload.extra.match(regexTags)[1] });
      if (regexLearnMore.test(payload.extra)) draft.embeds[0].fields.push({ 'name': 'Learn More', 'value': payload.extra.match(regexLearnMore)[1] });
      return draft;
    default:
      throw new Error('[ERROR] No provider or action given.');
    }
}

module.exports = {
  
  /**
   *  Executes the requested webhook by putting together an Axios instance from a set of given parameters and manages the response
   *
   *  @async
   *  @function execute
   *  @param {*} payload - Data sent to the webhook, to be consumed by the message formula in constructing a discord message
   *  @param {string} provider - An identifier for the service providing the webhook. (e.g. 'discord')
   *  @param {string} action - An identifier for the specific webhook to execute, from a given provider (e.g. 'newSubmission')
   *  @returns {*} Ultimately depends on the webhook provider
   *  @throws Will throw an error if a response code other than 200/204/2** is received
   */
  
  execute: async (payload, provider, action) => {
    try {
      const response = await webhook.get(provider).instance.post(webhook.get(provider).endpoints[action], message(payload, provider, action));
      if (response.status >= 200) { console.log(`› Successful webhook response from '${provider}' for '${action}.`); return response.config.data; }
      else { throw new Error(`[ERROR] Webhook failed: '${provider}' for '${action}.`); }
    } catch (err) {
      console.error(err.message);
    } 
  }
}