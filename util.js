/**
 *  @file Common utility methods
 *  @author Avana Vana <avana@esovdb.org>
 *  @module util
 */

const he = require('he');

/** @constant {RegExp} regexYTChannelId - Regular expression for matching a YouTube channel ID */
const regexYTChannelId = /^UC[\w-]{21}[AQgw]$/;

/** @constant {RegExp} regexYTPlaylistId - Regular expression for matching a YouTube playlist ID */
const regexYTPlaylistId = /^PL[\w-]+$/;

/** @constant {RegExp} regexDate - Regular expression to match dates in any of the formats YYYY-mm-DD, YYYY-mm, or YYYY. */
const regexDate = /^2[0-9]{3}(?:-[0-1][0-9](?:-[0-3][0-9])?)?$/;

/**
 *  Utility sleep function based on units of seconds that returns a promise and can be consumed by async/await
 *
 *  @function sleep
 *  @param {number} seconds - The number of seconds to sleep for (i.e. the number of seconds after which the promise will resolve)
 *  @returns {Promise} Resolves after a specified [number]{@link seconds} of seconds
 */

const sleep = (seconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });

/**
 *  Truncates a long string with ellipsis if longer than a provided limit
 *
 *  @function truncate
 *  @param {string} string - The string to truncate
 *  @param {number} limit - The number of characters after which truncation occurs
 *  @returns {string} Same value as {@link string} if under the {@link limit}, or truncated version of {@link string} if over the {@link limit}
 */

const truncate = (string, limit) => string.length <= limit ? string : string.slice(0, limit) + '…';

/**
 *  Sequentially reduces the results of one or more asynchronous functions, accumulating their results, in order
 *
 *  @async
 *  @function queueAsync
 *  @param {Array} functor - An array of anything, a functor, something mappable (e.g. Array.prototype.map())
 *  @returns {Array} An array of values sequentially accumulated from each asynchronous function performed on the functor
 */

const queueAsync = async (functor) => {
  const res = [];

  functor.length > 1
    ? await functor.reduce((a, c, i, { length }) =>
        (i === 1 ? a() : a).then((val) => {
          res.push(val);
          return i === length - 1 ? c().then((val) => res.push(val)) : c();
        })
      )
    : await functor[0]().then((val) => res.push(val));

  return res;
}

/**
 *  Transforms an array of Zotero creators in a single byline string
 *
 *  @function stringifyCreators
 *  @param {Object[]} creators - An array Zotero creator objects, which consist of a "creatorType" string and either a "name" string or "firstName" and "lastName" strings
 *  @param {boolean} [fullName=true] - Whether or not a creator's full name should be used, or just their last name. (default: full name)
 *  @returns {string} A byline combining all creators, separated by oxford comma rules
 */

const stringifyCreators = (creators, fullName = true) => 
  creators
    .map((person) => fullName ? person.lastName ? `${person.firstName} ${person.lastName}` : person.name : person.lastName ? person.lastName : person.name)
    .reduce((acc, name, i, arr) => `${acc}${arr.length > 2 ? i === arr.length - 1 ? ', and ' : ', ' : arr.length > 1 ? ' and ' : ' '}${name}`);

/**
 *  Pads a string to a specified length with repeated specified string
 *
 *  @function pad
 *  @param {string} string - The original string to pad
 *  @param {number} length - The desired final length of {@link string} with padding
 *  @param {string} [padString='0'] - Another string used repeatedly to pad the first, defaults to '0'
 *  @param {boolean} [prepend=true] - Whether or not the repeated {@link padString} is prepended or appended to the original {@link string}
 *  @returns {string} Original {@link string} padded with {@link padString}, repeated until return string's length is {@link amount} number of characters
 *
 *  @example <caption>Simple leading zeroes</caption>
 *  // returns '004'
 *  pad(2+2, 3)
 *
 *  @example <caption>A fancy fore-flourish</caption>
 *  // returns '~*~~*~text'
 *  pad('text', 10, '~*~')
 *
 *  @example <caption>With toLocaleString() and Array.map()</caption>
 *  // returns [
 *  //   '$         2.91',
 *  //   '$ 3,304,394.00',
 *  //   '$    50,504.24'
 *  // ]
 *  [2.906, 3304394, 50504.2422].map(price => '$' + pad(price.toLocaleString('en-US'), 13, ' '));
 *
 *  @example <caption>Table of contents from an Array of Objects</caption>
 *  // returns [
 *  //   'Title................1',
 *  //   'Contents.............4',
 *  //   'Chapter 1...........12'
 *  // ]
 *  [{ name: 'Title', page: 1 }, { name: 'Contents', page: 2 }, { name: 'Chapter 1', page: 12 }].map(item => pad(item.name, 20, '.', false) + pad(item.page, 2, '.'));
 */

const pad = (string, length, padString = '0', prepend = true) => {
  const padding = padString
    .repeat(Math.ceil(length / padString.length))
    .substr(0, length - string.toString().length);

  return length > string.toString().length ? (prepend ? padding + string.toString() : string.toString() + padding) : string.toString();
}

/**
 *  Formats ISO-8601 dates to YYYY-MM-DD hh:mm:ss (Zotero-friendly date format), in the user's local time
 *
 *  @function formatDate
 *  @requires pad
 *  @param {string} rawDate - A raw date string, may or may not be in ISO-8601 format
 *  @returns {string} Date in YYYY-MM-DD hh:mm:ss format, in user's local time, if {@link rawDate} is in ISO-8601 format, otherwise returns {@link rawDate}
 *
 *  @example <caption>ISO-8601 date in GMT</caption>
 *  // returns '2020-12-07 16:55:43' (in EST timezone)
 *  formatDate('2020-12-07T21:55:43.000Z');
 *
 *  @example <caption>ISO-8601 date with timezone specified</caption>
 *  // returns '2020-12-07 16:55:43' (in EST timezone)
 *  formatDate('2020-12-07T215543-0500');
 */

const formatDate = rawDate => {
  const iso8601Format = /^([0-9]{4})-?([01][0-9])-?([0-3][0-9])T([0-2][0-9]):?([0-5][0-9]):?([0-6][0-9])\.?(0{1,6})?(?:Z|(([+-])([01][0-9]):?([0-5][0-9])?))$/;

  if (iso8601Format.test(rawDate)) {
    let [, year, month, day, hours, min, sec, fracSec, offset, offsetSign, offsetHours, offsetMin] = iso8601Format.exec(rawDate) || [];
    let d = new Date(year, month - 1, day, hours, min, sec);

    if (fracSec) fracSec *= Math.pow(10, -1 * fracSec.length);

    if (offset) {
      d.setHours(d.getHours() + offsetHours * (offsetSign === '+' ? 1 : -1));
      offsetMin && d.setMinutes(d.getMinutes() + offsetMin * (offsetSign === '+' ? 1 : -1));
    } else {
      d = new Date(d.getTime() - d.getTimezoneOffset() * 1000 * 60);
    }

    return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}`;
  } else {
    return rawDate;
  }
}

/**
 *  Format an ISO date string into a human-friendly string like: "Jan 1, 2026 at 2:00pm"
 *
 *  @function formatDateNice
 *  @param {string} iso
 *  @param {{ utc?: boolean }=} opts
 *  @returns {string}
 */

const formatDateNice = (iso, opts) => {
  const d = new Date(iso);
  const useUTC = !!(opts && opts.utc);

  if (!iso || isNaN(d.getTime())) return String(iso || '');

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const year = useUTC ? d.getUTCFullYear() : d.getFullYear();
  const month = useUTC ? d.getUTCMonth() : d.getMonth();
  const day = useUTC ? d.getUTCDate() : d.getDate();

  let hour = useUTC ? d.getUTCHours() : d.getHours();
  const minute = useUTC ? d.getUTCMinutes() : d.getMinutes();

  const suffix = hour >= 12 ? 'pm' : 'am';
  hour = hour % 12;
  if (hour === 0) hour = 12;

  const mm = String(minute).padStart(2, '0');

  return months[month] + ' ' + day + ', ' + year + ' at ' + hour + ':' + mm + suffix;
}

/**
 *  Parses an Airtable-formatted date string ("MMMM D, YYYY h:mma") into a Unix timestamp (milliseconds since epoch), in the local timezone.
 *
 *  @function parseAirtableModified
 *  @param {string} s - A date string in Airtable's "MMMM D, YYYY h:mma" format (e.g. "January 1, 2021 4:34am")
 *  @returns {number} Millisecond timestamp suitable for numeric comparison (e.g. in Array.sort()),
 *  or NaN if the input does not match the expected format or represents an invalid calendar date.
 *
 *  @example
 *  // returns a timestamp number
 *  parseAirtableModified('December 20, 2020 5:23pm');
 *
 *  @example
 *  // returns NaN (invalid format)
 *  parseAirtableModified('2020-12-20T17:23:00Z');
 */

const parseAirtableTimestamp = (timestamp) => {
  if (!timestamp) return NaN;
  
  const match = String(timestamp).trim().match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!match) return NaN;

  const [ , monthString, dayString, yearString, hourString, minString, periodString ] = match;
  const months = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

  const month = months[monthString.toLowerCase()];
  const day = Number(dayString);
  const year = Number(yearString);
  let hour = Number(hourString);
  const minute = Number(minString);
  const period = periodString.toLowerCase();

  if (period === 'am') {
    if (hour === 12) hour = 0;
  } else {
    if (hour !== 12) hour += 12;
  }

  const d = new Date(year, month, day, hour, minute, 0, 0);

  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day || d.getHours() !== hour || d.getMinutes() !== minute) return NaN;
  
  return d.getTime();
};

/**
 *  Takes dates formatted by Airtable and converts them to timestamps in order to compare them and sort in ascending (default) or descending order, meant to be passed to Array.sort()
 * 
 *  @function sortDates
 *  @requires parseAirtableTimestamp
 *  @param {string} a - String representation of a date in Airtable's form "MMMM, d, YYYY h:mma" (e.g. "January 1, 2021 5:00am")
 *  @param {string} b - String representation of a date in Airtable's form "MMMM, d, YYYY h:mma" (e.g. "January 1, 2021 5:00am")
 *  @param {Boolean} [asc=true] - Whether or not the dates should be sorted in ascending (default) or descending order
 *  @returns {(-1|1)} Returns -1 if ascending order and a is less than b, or if descending order and b is less than a, and 1 if ascending order and a is greater than b, or if descending order and b is greater than a
 */

const sortDates = (a, b, asc = true) => {
  const modifiedA = parseAirtableTimestamp(a && a.modified);
  const modifiedB = parseAirtableTimestamp(b && b.modified);

  const corruptA = Number.isNaN(modifiedA);
  const corruptB = Number.isNaN(modifiedB);
  
  if (corruptA || corruptB) {
    if (corruptA && corruptB) return 0;
    return asc ? (corruptA ? 1 : -1) : (corruptA ? -1 : 1);
  }

  if (modifiedA === modifiedB) return 0;
  return asc ? (modifiedA < modifiedB ? -1 : 1) : (modifiedA < modifiedB ? 1 : -1);
};

/**
 *  Merges separate arrays for first and last names of authors into an array of full names of authors in a specified format
 *
 *  @deprecated Superseded by {@link packageAuthors}, since Zotero supports separate first and last name fields, but kept here for other future implementations
 * 
 *  @function formatAuthors
 *  @param {string[]} first - An array of first name strings
 *  @param {string[]} last - An array of last name strings
 *  @param {boolean} [reverse=false] - Whether or not to reverse the order of names in the returned array
 *  @returns {string[]} An array of full names of authors, merging {@link first} and {@link last} names
 * 
 *  @example <caption>Default format (reverse = false)</caption>
 *  // returns ['John C. Smith', 'F. Johnson', 'Marjorie García-Gamboa']
 *  formatAuthors(['John C.', 'F.', 'Marjorie'], ['Smith', 'Johnson', 'García-Gamboa']);
 *
 *  @example <caption>Reversed format (reverse = true)</caption>
 *  // returns ['Smith, John C.', 'Johnson, F.', 'García-Gamboa, Marjorie']
 *  formatAuthors(['John C.', 'F.', 'Marjorie'], ['Smith', 'Johnson', 'García-Gamboa'], true);
 */

const formatAuthors = (first, last, reverse = false) => reverse ? first.map((f, i) => last[i] + (f.length > 0 ? ', ' + f : '')) : first.map((f, i) => (f.length > 0 ? f + ' ' : '') + last[i]);

/**
 *  Merges separate arrays for first and last names of authors into a single array of author objects, with keys for first and last name
 *
 *  @function packageAuthors
 *  @param {string[]} first - An array of first name strings
 *  @param {string[]} last - An array of last name strings
 *  @returns {Object[]} An array of author objects, with keys for first and last name
 *
 *  @example
 *  // returns [{ firstName: 'John C.', lastName: 'Smith' }, { firstName: 'F.', lastName: 'Johnson' }, { firstName: 'Marjorie', lastName: 'García-Gamboa' }]
 *  formatAuthors(['John C.', 'F.', 'Marjorie'], ['Smith', 'Johnson', 'García-Gamboa']);
 */

const packageAuthors = (first, last) => first.map((f, i) => ({ firstName: f, lastName: last[i] }));

/**
 *  Formats an Airtable duration field's value (given in integer seconds), to h:mm:ss, m:ss, or s, as necessary
 *
 *  @function formatDuration
 *  @requires util.pad
 *  @param {number} duration - Duration, in integer seconds
 *  @returns {string} Duration string formatted as h:mm:ss, m:ss, depending on magnitude of {@link duration}
 *
 *  @example <caption>Duration > 1 hour</caption>
 *  // returns '2:34:04'
 *  formatDuration(9244);
 *
 *  @example <caption>Duration < 1 hour</caption>
 *  // returns '45:22'
 *  formatDuration(2722);
 *
 *  @example <caption>Duration < 1 minute</caption>
 *  // returns '0:27'
 *  formatDuration(27);
 */

const formatDuration = (duration) => (duration < 60 ? '0:' : '') + [
    Math.floor(duration / 3600),
    duration > 3600 ? module.exports.pad(Math.floor((duration % 3600) / 60), 2) : Math.floor((duration % 3600) / 60),
    module.exports.pad(Math.floor(duration % 60), 2),
  ]
    .filter((t, i, a) => +t !== 0 || i === a.length - 1)
    .join(':');

/**
 *  Converts a YouTube (ISO-8601) duration to seconds
 *
 *  @function formatYTDuration
 *  @param {string} duration - An ISO-8601 duration string
 *  @returns {number} The ISO-8601 duration, converted into seconds
 *
 *  @example
 *  // returns 122
 *  formatYTDuration('PT2M2S');
 *
 *  @example
 *  // returns 8403
 *  formatYTDuration('PT2H20M3S');
 *
 *  @example
 *  // returns 3640
 *  formatYTDuration('PT1H40S');
 */

const formatYTDuration = (duration) => {
  if (typeof duration !== 'string' || duration.trim() === '') return null;

  const match = /^PT(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?$/.exec(duration);
  if (!match) return null;

  const [ , hours = 0, minutes = 0, seconds = 0 ] = match;
  return ((+hours) * 3600) + ((+minutes) * 60) + (+seconds);
}

/**
 *  Returns an array of IP addresses from a string of space separated IP patterns, expanding any wildcard characters (*)
 *
 *  @deprecated /!\ DO NOT USE /!\ - superseded by {@link patternsToRegEx}, which is far more efficient—just a single IP with two wildcards passed to this method creates an array with 65,536 elements...with four wildcards it would be ~4.3 billion elements in length...but just too cool of a one-liner for me to delete
 *
 *  @function patternsToArray
 *  @param {string} patterns - List of ip addresses, space-separated, with optional wildcard parts (*)
 *  @returns {string[]} Flattened array of all combinatorically possible ip address strings using given {@link patterns}
 *
 *  @example <caption>Without wildcards (*)</caption>
 *  // returns ['67.118.0.1','255.255.1.1']
 *  generateIps('67.118.0.1 255.255.1.1');
 *
 *  @example <caption>With wildcards (*)</caption>
 *  // returns ['67.118.0.1','255.255.1.0','255.255.1.1', ... , '255.255.1.255'] (256)
 *  generateIps('67.118.0.1 255.255.1.*');
 */

const patternsToArray = (patterns) => patterns
  .split(' ')
  .map((pattern) => pattern
    .split('.')
    .map((part) => (part === '*' ? [ ...Array(256).keys() ] : [ part ])))
  .flatMap((ip) => [ ...ip ]
    .reduce((a, b) => a
      .flatMap((d) => b
        .map((e) => [ d, e ]
          .flat()))))
  .map((ip) => ip
    .join('.'));

/**
 *  Returns a regular expression from a string of space-separated IP patterns, with wildcard characters (*)
 *
 *  @function patternsToRegEx
 *  @param {string} patterns - List of ip addresses, space-separated, with optional wildcards (*)
 *  @returns {RegExp} Regular expression equivalent to {@link patterns}
 *
 *  @example <caption>Without wildcards (*)</caption>
 *  // returns true
 *  let whitelist = '67.118.0.1 255.255.1.1';
 *  validateIps(whitelist).test('67.118.0.1');
 *
 *  @example <caption>With wildcards (*)</caption>
 *  // returns true
 *  let whitelist = '67.118.0.1 255.255.*.*';
 *  validateIps(whitelist).test('255.255.0.1');
 */

const patternsToRegEx = (patterns) => new RegExp(
  `(?:${patterns
    .split(' ')
    .map((pattern) => pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '\\b(?:1\\d{2}|2[0-4]\\d|[1-9]?\\d|25[0-5])\\b'))
    .join('|')})`);

/**
 *  Allows for graceful start of server with PM2, etc.
 *
 *  @function appReady
 */

const appReady = (callback) => {
  if (typeof process.send === 'function') process.send('ready');
  if (callback && typeof callback === 'function') callback();
}

/** @function defineTags - Defines a new @sideEffects JSDoc tag for documenting functions with side effects */

const defineTags = (dict) => {
  dict.defineTag('sideEffects', {
    mustNotHaveValue: true
  });
}

/**
 *  Translates HTTP request method into a string representing the type of API operation.
 *
 *  @function getOp
 *  @param {!express:Request} req - Express.js HTTP request context, an enhanced version of Node's http.IncomingMessage class
 *  @param {string} req.method - The HTTP request method (e.g. 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', etc)
 *  @returns {(string|Boolean)} The named ESOVDB API operation associated with a given HTTP request method.  Returns false if a method other than POST, PUT, or DELETE is passed to it.
 */

const getOp = ({ method }) => new Map([[ 'POST', 'create' ],[ 'PUT', 'update' ],[ 'DELETE', 'delete' ]]).get(method) || false;

/**
 *  Prints the current UTC time in a shorter ISO-8601 format than toISOString(), using the format YYYY-MM-ddTHHMM
 *
 *  @function shortISODateTime
 *  @returns {string} The current UTC time formatted as YYYY-MM-ddTHHMM
 */

const shortISODateTime = () => `${(new Date()).toLocaleDateString('en-CA')}T${(new Date()).toLocaleTimeString('en-DE').replace(/(?:\:[0-9]{2}$|\:)/g, '')}`;

/**
 *  Validates a date string for the formats YYYY-MM-DD, YYYY-MM, and YYYY, and parses it as a Javascript Date
 * 
 *  @function validateAndParseDate
 *  @param {string} date - a date string in any of the formats YYYY-MM-DD, YYYY-MM, or YYYY
 *  @throws Will throw if the date string does not match one of the aforementioned formats. 
 *  @returns {Date} Parsed Javascript Date object for the provided date string
 */

const validateAndParseDate = (date) => {
  if (!date) return null;
  if (!regexDate.test(date)) throw new Error('Invalid date format. Use YYYY-MM-DD, YYYY-MM, or YYYY');

  const parts = date.split('-');
  const fullDate = parts[0] + (parts[1] ? `-${parts[1]}` : '-01') + (parts[2] ? `-${parts[2]}` : '-01');

  return new Date(Date.parse(fullDate));
}

/**
 *  Infers the ESOVDB watchlist type from a YouTube ID.
 *
 *  @function inferWatchlistTypeFromId
 *  @param {string} id - A YouTube channel ID (e.g. "UC...") or playlist ID (e.g. "PL...")
 *  @returns {'Channel'|'Playlist'} The inferred watchlist type
 *  @throws Will throw if {@link id} is not a valid YouTube channel or playlist ID.
 *
 *  @example
 *  // returns 'Channel'
 *  inferWatchlistTypeFromId('UC_x5XG1OV2P6uZZ5FSM9Ttw');
 *
 *  @example
 *  // returns 'Playlist'
 *  inferWatchlistTypeFromId('PLBCF2DAC6FFB574DE');
 */

const inferWatchlistTypeFromId = (id) => {
  if (regexYTChannelId.test(id)) return 'Channel';
  if (regexYTPlaylistId.test(id)) return 'Playlist';
  throw new Error(`Invalid YouTube ID "${id}".`);
}

/**
 *  Normalizes user input into an RFC 3339 / ISO-8601 UTC timestamp string (midnight) for "publishedAfter". Accepts YYYY, YYYY-MM, or YYYY-MM-DD and returns a UTC timestamp at 00:00:00.000Z.
 *
 *  @function normalizePublishedAfter
 *  @param {string} input - User-provided value representing a date boundary (YYYY, YYYY-MM, or YYYY-MM-DD)
 *  @returns {string|undefined} Normalized UTC timestamp string, or undefined if {@link input} is falsy
 *  @throws Will throw if {@link input} is not one of the accepted formats or is an invalid calendar date.
 *
 *  @example
 *  // returns '2024-01-01T00:00:00.000Z'
 *  normalizePublishedAfter('2024');
 *
 *  @example
 *  // returns '2024-02-01T00:00:00.000Z'
 *  normalizePublishedAfter('2024-02');
 *
 *  @example
 *  // returns '2024-02-29T00:00:00.000Z'
 *  normalizePublishedAfter('2024-02-29');
 */

const normalizePublishedAfter = (input) => {
  if (!input) return undefined;
  const value = String(input).trim();

  if (/^\d{4}$/.test(value)) return `${value}-01-01T00:00:00.000Z`;

  if (/^\d{4}-\d{2}$/.test(value)) {
    const [ y, m ] = value.split('-').map(Number);
    if (m < 1 || m > 12) throw new Error(`Invalid publishedAfter month: "${value}"`);
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01T00:00:00.000Z`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [ y, m, d ] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));

    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      throw new Error(`Invalid publishedAfter date: "${value}"`);
    }

    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00.000Z`;
  }

  throw new Error(`Invalid publishedAfter "${value}". Expected YYYY, YYYY-MM, or YYYY-MM-DD.`);
}

/**
 *  Escapes a string for safe interpolation into an Airtable formula string literal. Currently escapes single quotes by backslash-escaping them.
 *
 *  @function escapeAirtableFormulaString
 *  @param {string} value - Any value to be used inside an Airtable formula string literal
 *  @returns {string} The escaped string representation of {@link value}
 *
 *  @example
 *  // returns "Bob\\'s Burgers"
 *  escapeAirtableFormulaString("Bob's Burgers");
 */

const escapeAirtableFormulaString = (value) => String(value).replace(/'/g, `\\'`);

/**
 *  Decodes HTML entities in a string (e.g. "&amp;", "&quot;", "&#39;") into their corresponding Unicode characters. Uses the {@link https://www.npmjs.com/package/he|he} library.
 *
 *  @function decodeEntities
 *  @param {string} [s=''] - Input string that may contain HTML entities
 *  @returns {string} Decoded string
 *
 *  @example
 *  // returns 'Rock & Roll'
 *  decodeEntities('Rock &amp; Roll');
 */
 
const decodeEntities = (s = '') => he.decode(s, { strict: false });

/**
 *  Normalizes a YouTube video title by decoding HTML entities, normalizing Unicode presentation forms, removing zero-width characters, standardizing quotes, and collapsing whitespace. Intended to convert "fancy" Unicode text (e.g. mathematical bold/italic) and HTML entities into plain text.
 *
 *  @function normalizeUnicodeTitle
 *  @param {string} [title=''] - Raw video title
 *  @returns {string} Normalized title
 *
 *  @example
 *  // returns: 'It\'s "Complicated" & Weird'
 *  normalizeUnicodeTitle('It&#39;s “Complicated” &amp; Weird');
 */

const normalizeUnicodeTitle = (title = '') =>
  decodeEntities(title)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[‘’‛‹›]/g, '\'')
    .replace(/[“”„«»]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/**
 *  Normalizes a YouTube video description by decoding HTML entities, normalizing Unicode presentation forms, removing zero-width characters, standardizing quotes, trimming trailing whitespace on each line, and collapsing excessive blank lines.
 *
 *  @function normalizeUnicodeDescription
 *  @param {string} [text=''] - Raw description text
 *  @returns {string} Normalized description
 *
 *  @example
 *  // returns a cleaned multi-line description with normalized quotes and entities decoded
 *  normalizeUnicodeDescription('Line&nbsp;1\\n\\n\\nLine&#39;2');
 */

const normalizeUnicodeDescription = (text = '') =>
  decodeEntities(text)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[‘’‛‹›]/g, '\'')
    .replace(/[“”„«»]/g, '"')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const extractYtInitialData = (html) => {
  const marker = 'var ytInitialData = ';
  const start = html.indexOf(marker);
  if (start === -1) return null;

  let i = start + marker.length;

  while (/\s/.test(html[i])) i++;
  if (html[i] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let j = i; j < html.length; j++) {
    const ch = html[j];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') depth++;
    
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = j + 1;
        break;
      }
    }
  }

  if (end === -1) return null;

  return JSON.parse(html.slice(i, end));
}

const detectYouTubeCourse = (html) => {
  const data = extractYtInitialData(html);
  if (!data) return false;

  let isCourse = false;

  function walk(node) {
    if (!node || typeof node !== 'object' || isCourse) return;

    const badge = node && node.metadataBadgeRenderer;
    
    if (badge && (badge.label === 'Course' || badge.tooltip === 'Course')) {
      isCourse = true;
      return;
    }

    const endpoint = node && node.showEngagementPanelEndpoint;
    const identifier = endpoint && endpoint.identifier;
    const tag = identifier && identifier.tag;

    if (tag === 'engagement-panel-course-metadata') {
      isCourse = true;
      return;
    }

    if ('courseProgressViewModel' in node || 'coursePerksViewModel' in node) {
      isCourse = true;
      return;
    }

    for (const value of Object.values(node)) {
      walk(value);
      if (isCourse) return;
    }
  }

  walk(data);
  return isCourse;
}

module.exports = {
  truncate,
  queueAsync,
  stringifyCreators,
  pad,
  sleep,
  inferWatchlistTypeFromId,
  normalizePublishedAfter,
  formatDate,
  formatDateNice,
  sortDates,
  formatAuthors,
  packageAuthors,
  formatDuration,
  formatYTDuration,
  patternsToArray,
  patternsToRegEx,
  appReady,
  defineTags,
  getOp,
  shortISODateTime,
  validateAndParseDate,
  escapeAirtableFormulaString,
  decodeEntities,
  normalizeUnicodeTitle,
  normalizeUnicodeDescription,
  detectYouTubeCourse
}
