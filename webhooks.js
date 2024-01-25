/**
 *  @file Webhook Functions
 *  @author Avana Vana <avana@esovdb.org>
 *  @module webhooks
 */

const dotenv = require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const WebHooks = require('node-webhooks');
const { getOp, truncate, stringifyCreators, queueAsync } = require('./util');

/** @constant {WebHooks} webHooks - Class with add/remove/trigger actions and access to JSON file-based, encrypted database of webhook consumers from [node-webhooks]{@link https://github.com/roccomuso/node-webhooks} */
const webhooks = new WebHooks({ db: process.env.WEBHOOKS_DB });

/** @constant {string[]} canon - Canonical list of webhook events that can be subscribed to */
const canon = [ 'videos.create', 'videos.update', 'videos.delete', 'series.create', 'series.update', 'series.delete', 'tags.create', 'tags.update', 'tags.delete' ];

/** @constant {RegExp} regexYT - Regular expression for matching and extracting a YouTube videoId from a URL or on its own */
const regexYT = /^(?!rec)(?![\w\-]{12,})(?:.*youtu\.be\/|.*v=)?([\w\-]{10,12})&?.*$/;

/** @constant {RegExp} regexURL - Regular expression for validating webhook callback URLs */
const regexURL = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/;

/** @constant {RegExp} regexTopic - Regular expression for matching and extracting an ESOVDB topic from a mixed Zotero 'extras' field */
const regexTopic = /Topic:\s(.*)\n?/;

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

/** @constant {Map} sources - Maps a given webhook source to an object containing an axios instance and a set of endpoints with action identifiers */
const sources = new Map([
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
 *  Reads and returns a fresh copy of the webhooks database every time it is called
 *
 *  @function webhooksDb
 *  @returns {Object} webhooksDb - Static snapshot of
 */

const webhooksDb = () => JSON.parse(fs.readFileSync(process.env.WEBHOOKS_DB, 'utf8'));

/** @constant {Map} actions - Maps CRUD action string identifiers to their handler methods */
const actions = new Map([
  
  /**
   * @typedef {Object} WebhooksDBResponse
   * @property {?string[]} added - An array of zero or more [canonical webhook events]{@link canon} to which a callback URL has been succesfully added to the {@link webhooks} database  (not included in response of {@link delete} method)
   * @property {?string[]} removed - An array of zero or more [canonical webhook events]{@link canon} to which a callback URL has been succesfully removed from the {@link webhooks} database (not included in response of {@link create} method)
   * @property {?string[]} unchanged - An array of zero or more [canonical webhook events]{@link canon} which remain unaffected in the {@link webhooks} database
   * @property {?string[]} failed - An array of zero or more [canonical webhook events]{@link canon} to which a callback URL failed to be added or removed from the {@link webhooks} database
   */
  
  /**
   *  Checks the {@link webhooks} database for a provided {@link callback} URL subscribed to one or more given webhook events in the provided {@link events} array and adds the {@link callback} URL to each provided webhook event, if it does not already exist
   *
   *  @async
   *  @method create
   *  @param {string[]} events - An array of one or more webhook event name strings from the [canonical set]{@link canon}
   *  @param {string} callbackUrl - A valid URL for the webhook to call back after an event is triggered
   *  @returns {WebhooksDBResponse} - The final tally of all [canonical webhook events]{@link canon} added, unchanged, or failed as a result of this action on the {@link webhooks} database
   *  @sideEffects Adds a callback URL to each webhook event included in the {@link events} array in the {@link webhooks} database, if it has not already been added
   *
   *  @example <caption>Adding two new webhook events to a callback URL's subscription</caption>
   *  actions.get('create')([ 'videos.create', 'videos.update' ], 'https://example.com/callback');
   *  // returns { added: [ 'videos.create', 'videos.update' ], unchanged: [], failed: [] }
   *
   *  @example <caption>Adding three webhook events to a callback URL's subscription, where one is new, one already exists, and one fails</caption>
   *  actions.get('create')([ 'videos.delete', 'series.create', 'videos.update' ], 'https://example.com/callback');
   *  // returns { added: [ 'videos.delete' ], unchanged: [ 'videos.update' ], failed: [ 'series.create' ] }
   */

  [ 'create', async (events, callbackUrl) => {
    let added = [], unchanged = [], failed = [];

    for await (let e of events) {
      if (webhooksDb()[e] && webhooksDb()[e].includes(callbackUrl)) {
        unchanged.push(e);
        continue;
      } else {
        const response = await webhooks.add(e, callbackUrl);
        if (response) added.push(e);
        else failed.push(e);
      }
    }

    return { added, unchanged, failed };
  }],
  
  /**
   *  Checks the {@link webhooks} database for a provided {@link callback} URL subscribed to one or more given webhook events in the provided {@link events} array and then updates the webhook events associated with {@link callback} by first removes the {@link callback} URL from all webhook events in the {@link WebHooks} database not included in the provided {@link events} array, then add the {@link callback} URL to each provided webhook event, if it does not already exist
   *
   *  @async
   *  @method update
   *  @param {string[]} events - An array of one or more webhook event name strings from the [canonical set]{@link canon}
   *  @param {string} callbackUrl - A valid URL for the webhook to call back after an event is triggered
   *  @returns {WebhooksDBResponse} - The final tally of all [canonical webhook events]{@link canon} added, removed, unchanged, or failed as a result of this action on the {@link webhooks} database
   *  @sideEffects Removes any callback URLs assigned to webhook events not included in the {@link events} array from the {@link webhooks} database and then adds a callback URL to each webhook event included in the {@link events} array, if it has not already been added
   *
   *  @example <caption>Updating a callback URL's webhook subscription with a different set of events</caption>
   *  // previous subscription: [ 'videos.create', 'videos.update', 'series.create' ]
   *  actions.get('update')([ 'videos.create', 'videos.delete' ], 'https://example.com/callback');
   *  // returns { added: [ 'videos.delete' ], removed: [ 'videos.update', 'series.create' ], unchanged: [ 'videos.create' ], failed: [] }
   */

  [ 'update', async (events, callbackUrl) => {
    let added = [], removed = [], unchanged = [], failed = [];

    const eventsToRemove = Object.keys(webhooksDb()).filter((k) => !events.includes(k)).map((e) => ({ name: e, callbackUrls: webhooksDb()[e] })).filter((i) => i.callbackUrls.includes(callbackUrl)).map((i) => i.name);
    const eventsToAdd = events.filter((e) => !webhooksDb()[e] || (webhooksDb()[e] && !webhooksDb()[e].includes(callbackUrl)));
    unchanged.push(...events.filter((e) => !eventsToRemove.includes(e) && !eventsToAdd.includes(e)));

    for await (let e of eventsToRemove) {
      const response = await webhooks.remove(e, callbackUrl);
      if (response) removed.push(e);
      else failed.push(e);
    }

    for await (let e of eventsToAdd) {
      const response = await webhooks.add(e, callbackUrl);
      if (response) added.push(e);
      else failed.push(e);
    }

    return { added, removed, unchanged, failed };
  }],

  /**
   *  Checks the {@link webhooks} database for a provided {@link callback} URL subscribed to one or more given webhook events in the provided {@link events} array and removes the {@link callback} URL from each provided webhook event, if it exists
   *
   *  @async
   *  @method delete
   *  @param {string[]} events - An array of one or more webhook event name strings from the [canonical set]{@link canon}
   *  @param {string} callbackUrl - A valid URL for the webhook to call back after an event is triggered
   *  @returns {WebhooksDBResponse} - The final tally of all [canonical webhook events]{@link canon} added, removed, unchanged, or failed as a result of this action on the {@link webhooks} database
   *  @sideEffects Removes a callback URL from each webhook event included in the {@link events} array in the {@link webhooks} database, if the {@link callback} URL has an active subscription to that webhook event in the {@link webhooks} database
   *
   *  @example <caption>Deleting a webhook event from a callback URL's subscription</caption>
   *  // previous subscription: [ 'videos.create', 'videos.update', 'videos.delete' ]
   *  actions.get('delete')([ 'videos.delete' ], 'https://example.com/callback');
   *  // returns { removed: [ 'videos.delete' ], unchanged: [], failed: [] }
   *
   *  @example <caption>Attempting to delete a webhook event to which a callback URL isn't actually subscribed</caption>
   *  // previous subscription: [ 'videos.create', 'videos.update', 'videos.delete' ]
   *  actions.get('delete')([ 'videos.delete', 'series.create' ], 'https://example.com/callback');
   *  // returns { removed: [ 'videos.delete' ], unchanged: [], failed: [ 'series.create' ] }
   */
  
  [ 'delete', async (events, callbackUrl) => {
    let removed = [], unchanged = [], failed = [];

    for await (let e of events) {
      if (webhooksDb()[e] && webhooksDb()[e].includes(callbackUrl)) {
        const response = await webhooks.remove(e, callbackUrl);
        if (response) removed.push(e);
        else failed.push(e);
      } else {
        unchanged.push(e);
        continue;
      }
    }

    return { removed, unchanged, failed };
  }]

]);

/**
 *  (Re-)formats the various fields of an ESOVDB video, already formatted for, and coming from Zotero, into a webhook-friendly, rich Discord message with text, images, videos, and other embed fields.
 *
 *  @function itemToDiscord
 *  @param {string} text - A text title that will become the textual message content 
 *  @param {Object} item - An ESOVDB catalog item, formatted for (and coming from) Zotero, after sync
 *  @returns {Object} A properly-formatted Discord message for use with webhooks, containing various embeds fields
 *  @see {@link https://discord.com/developers/docs/resources/webhook#execute-webhook}
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
  if (item.tags && item.tags.length > 0) draft.embeds[0].fields.push({ 'name': 'Tags', 'value': item.tags.map((item) => item.tag).join(', ') });
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
      return { content: `<@${payload.submittedBy}> Submission received! Thanks for your contribution of "${payload.title}" to the ESOVDB!` };
    default:
      throw new Error('[ERROR] No provider or action given.');
    }
}

module.exports = {
  
  /** @constant {webHooks} subscriptions - Exported {@link webHooks} instance from the [node-webhooks]{@link https://github.com/roccomuso/node-webhooks} library, for use in triggering webhook events in other modules */
  subscriptions: webhooks,
  
  /**
   *  Exported function that handles all webhook subscription management and CRUD events via the /webhooks API endpoint
   *
   *  @async
   *  @method manage
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {(string|string[])} req.body.events - A string or an array of strings of webhook event names that the webhook consumer is referencing
   *  @param {string} req.body.callback - A callback URL with which the webhook consumer subscribes to one or more webhook events
   *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
   *  @throws Will throw an error if any webhook management task resolves as false
   *  @sideEffects All {@link webhooks.manage} operations result in the modification of a JSON file-based, encrypted database that maps callback URLs to various webhook events to which they are subscribed, and an HTTPServerResponse sent back to the client
   */
  
  manage: async (req, res) => {
    let code, events = Array.isArray(req.body.events) ? req.body.events : Array.of(req.body.events);

    try {
      if (!getOp(req)) throw new Error('Unrecognized operation.');

      if (!events || !req.body.callback
          || (events && typeof events !== 'string' && (!Array.isArray(events) || (Array.isArray(events) && !events.every((event) => typeof event === 'string'))))
          || (req.body.callback && !regexURL.test(req.body.callback))
          || (events && events.some((event) => !canon.includes(event)))) {
        code = 400;
        throw new Error('Invalid webhook event(s) or callback URL.');
      }

      const response = await actions.get(getOp(req))(events, req.body.callback);
      if (response.failed.length === events.length) throw new Error(`Operation webhooks/${getOp(req)} failed for all events.`);
      console.log(`[DONE] Successfully performed webhooks/${getOp(req)} operation.`);
      Object.entries(response).filter((r) => r[1].length).forEach((r) => { console.log(`› (${r[1].length}/${events.length}) webhook subscriptions ${r[0]}.`); });
      return res.status(200).send(JSON.stringify(response));
    } catch (err) {
      console.error(`[ERROR] ${err.message}`);
      res.status(code || 500).send(JSON.stringify(err));
    }
  },
  
  /**
   *  Returns a list of all [canonical webhook events]{@link canon} to which the provided callback URL is currently subscribed
   *
   *  @method list
   *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
   *  @param {string} req.query.url - The callback URL whose subscriptions are to be queried, as a GET request query parameter, encoded/escaped for use as a URL query parameter
   *  @param {!express:Response} res - Express.js HTTP response context, an enhanced version of Node's http.ServerResponse class
   *  @throws If either the URL is not a valid URL, unescaped, or no webhook events in the {@link canon} are found for that callback URL
   *  @returns {string[]} An array of one or more webhook events from the list of [canonical webhook events]{@link canon}, or the list of [canonical webhook events]{@link canon} itself, if {@link req.query.url} is not provided
   */
  
  list: (req, res) => {
    let code;

    try {
      if (!req.query.url) return res.status(200).send(JSON.stringify(canon));
      if (req.query.url && !regexURL.test(decodeURIComponent(req.query.url))) { code = 400; throw new Error('Missing or malformed "url" query parameter.'); }
      const events = Object.keys(webhooksDb()).map((k) => ({ name: k, callbacks: webhooksDb()[k] })).filter((event) => event.callbacks.includes(decodeURIComponent(req.query.url))).map((event) => event.name);
      if (!events || events.length === 0) { code = 404; throw new Error(`No webhook event(s) found for callback URL "${decodeURIComponent(req.query.url)}".`); }
      console.log(`[DONE] Retrieved ${events.length} webhook event(s).`);
      return res.status(200).send(JSON.stringify(events));
    } catch (err) {
      console.error(`[ERROR] ${err.message}`);
      res.status(code || 500).send(JSON.stringify(err));
    }
  },
  
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
      const response = await sources.get(provider).instance.post(sources.get(provider).endpoints[action], message(payload, provider, action));
      if (response.status >= 200) { console.log(`› Successful webhook response from '${provider}' for '${action}.`); return response; }
      else { throw new Error(`[ERROR] Webhook failed: '${provider}' for '${action}.`); }
    } catch (err) {
      console.error(err.message);
    } 
  }
}