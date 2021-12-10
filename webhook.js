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
  ['Mantle Geodynamics, Geochemistry, Convection, Rheology, & Seismic Imaging and Modeling', { 'color': 'fee2d5', 'channel': 'mantle-and-geodynamics', 'channelId': '857085147672346644' }],
  ['Igneous & Metamorphic Petrology, Volcanism, & Hydrothermal Systems', { 'color': 'ffdce5', 'channel': 'volcanism-and-petrology', 'channelId': '857085297983356938' }],
  ['Alluvial, Pluvial & Terrestrial Sedimentology, Erosion & Weathering, Geomorphology, Karst, Groundwater & Provenance', { 'color': 'c2f5e9', 'channel': 'geomorphology-and-erosion', 'channelId': '857085806107426866' }],
  ['Early Earth, Life\'s Origins, Deep Biosphere, and the Formation of the Planet', { 'color': 'd1f7c4', 'channel': 'origins-of-life-and-earth', 'channelId': '857086998623027250' }],
  ['Geological Stories, News, Tours, & Field Trips', { 'color': 'ffeab6', 'channel': 'field-trips-and-stories', 'channelId': '857086207314231327' }],
  ['History, Education, Careers, Field Work, Economic Geology, & Technology', { 'color': 'eeeeee', 'channel': 'the-profession', 'channelId': '857085834083172363' }],
  ['Glaciation, Atmospheric Science, Carbon Cycle, & Climate', { 'color': 'd0f0fd', 'channel': 'climate-and-atmosphere', 'channelId': '857085725371269152' }],
  ['The Anthropocene', { 'color': 'eeeeee', 'channel': 'anthropocene', 'channelId': '857085987032006716' }],
  ['Geo-Archaeology', { 'color': 'eeeeee', 'channel': 'geo-archaeology', 'channelId': '857086136273731645' }],
  ['Paleoclimatology, Isotope Geochemistry, Radiometric Dating, Deep Time, & Snowball Earth', { 'color': 'd0f0fd', 'channel': 'geochemistry-and-dating', 'channelId': '857086563782361088' }],
  ['Seafloor Spreading, Oceanography, Paleomagnetism, & Geodesy', { 'color': 'cfdfff', 'channel': 'oceanography', 'channelId': '857087290371342367' }],
  ['Tectonics, Terranes, Structural Geology, & Dynamic Topography', { 'color': 'ffeab6', 'channel': 'tectonics-and-terranes', 'channelId': '857085147458568242' }],
  ['Seismology, Mass Wasting, Tsunamis, & Natural Disasters', { 'color': 'ffdaf6', 'channel': 'seismology-and-hazards', 'channelId': '857087143447625729' }],
  ['Minerals, Mining & Resources, Crystallography, & Solid-state Chemistry', { 'color': 'ffdce5', 'channel': 'mining-and-minerals', 'channelId': '857086038924460032' }],
  ['Marine & Littoral Sedimentology, Sequence Stratigraphy, Carbonates, Evaporites, Coal, Petroleum, and Mud Volcanism', { 'color': 'c2f5e9', 'channel': 'sedimentology', 'channelId': '857085476656906271' }],
  ['Planetary Geology, Impact Events, Astronomy, & the Search for Extraterrestrial Life', { 'color': 'ede2fe', 'channel': 'impacts-and-planetary-geology', 'channelId': '857086397218160672' }],
  ['Paleobiology, Mass Extinctions, Fossils, & Evolution', { 'color': 'd1f7c4', 'channel': 'paleobiology', 'channelId': '857086454772269066' }]
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
                newSubmissionTotal: process.env.WEBHOOK_DISCORD_NEWSUBMISSIONTOTAL,
                userSubmission: process.env.WEBHOOK_DISCORD_USERSUBMISSION
            }
        }
    ]
]);

/**
 * (Re-)formats the various fields of an ESOVDB video, already formatted for, and coming from Zotero, into a webhook-friendly, rich Discord message with text, images, videos, and other embed fields.
 *
 *  @function itemToRichDiscord
 *  @param {string} text - A text title that will become the textual message content 
 *  @param {Object} item - An ESOVDB catalog item, formatted for (and coming from) Zotero, after sync
 *  @returns {Object} A properly-formatted Discord message for use with webhooks, containing various embeds fields
 */

const itemToDiscord = (text, item) => {
  const draft = {
    'content': text,
    'embeds': [
      {
        'title': `${item.title} (${item.date}) [${item.runningTime}]`,
        'url': item.url,
        'color': regexTopic.test(item.extra) ? parseInt(topicMetadata.get(item.extra.match(regexTopic)[1]).color, 16) : parseInt('eeeeee', 16),
        'author': {
          'name': item.videoRecordingFormat || 'Video'
        },
        'footer': {
          'text': `${item.archiveLocation} (ID: ${item.callNumber})`
        },
        'fields': [
          {
            'name': 'Topic',
            'value': item.extra.match(regexTopic)[1]
          }
        ]
      }
    ]
  };
  if (item.abstractNote) draft.embeds[0].description = truncate(item.abstractNote, 200);
  if (regexYT.test(item.url)) draft.embeds[0].image = { 'url': `http://i3.ytimg.com/vi/${item.url.match(regexYT)[1]}/hqdefault.jpg` };
  if (stringifyCreators(item.creators) !== 'Unknown') draft.embeds[0].fields.push({ 'name': 'Presenter(s)', 'value': stringifyCreators(item.creators) });
  if (item.seriesTitle) draft.embeds[0].fields.push({ 'name': 'Series', 'value': `${item.seriesTitle} ${item.volume ? '(Vol. ' + item.volume + ')' : '' }`});
  if (item.studio !== 'Independent') draft.embeds[0].fields.push({ 'name': 'Publisher', 'value': item.studio });
  if (regexTags.test(item.extra)) draft.embeds[0].fields.push({ 'name': 'Tags', 'value': item.extra.match(regexTags)[1] });
  if (regexLearnMore.test(item.extra)) draft.embeds[0].fields.push({ 'name': 'Learn More', 'value': item.extra.match(regexLearnMore)[1] });
  return draft;
}

/**
 *  Transforms any payload, for any webhook provider, with any action into a properly-formmatted message for that provider and action
 *
 *  @function message
 *  @param {*} payload - Data sent to the webhook, to be consumed by provider- and action-specific case logic to construct a properly-formatted message
 *  @param {string} provider - An identifier for the service providing the webhook. (e.g. 'discord')
 *  @param {string} action - An identifier for the specific webhook to execute, from a given provider (e.g. 'newSubmission')
 *  @returns {Object} A properly-formatted message for use with the given webhook provider and action
 *  @throws {TypeError} Will throw if no provider and action combination matches given case logic
 */

const message = (payload, provider, action) => {
  switch (provider + '-' + action) {
    case 'discord-newSubmissionTotal':
      const { data: item } = payload.some(({ data: item }) => item.featured) ? payload.filter(({ data: item }) => item.featured)[0] : payload[Math.floor(Math.random() * payload.length)];
      return itemToDiscord(`${payload.length} new submissions, including: <#${topicMetadata.get(item.extra.match(regexTopic)[1]).channelId}>`, item);
    case 'discord-newSubmission':
      return itemToDiscord(`New submission on the Earth Science Online Video Database! <#${topicMetadata.get(payload.extra.match(regexTopic)[1]).channelId}>`, payload);
    case 'discord-userSubmission':
      return { content: `<@${payload.submitter}> Submission received! Thanks for your contribution of "${payload.title}" to the ESOVDB!` };
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
      if (response.status >= 200) { console.log(`› Successful webhook response from '${provider}' for '${action}.`); return response; }
      else { throw new Error(`[ERROR] Webhook failed: '${provider}' for '${action}.`); }
    } catch (err) {
      console.error(err.message);
    } 
  }
}