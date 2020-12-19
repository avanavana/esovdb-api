/**
 * @file Utilities for formatting Airtable fields
 * @author Avana Vana
 * @module util
 */

module.exports = {
  /*
   * Pads a string to a specified length with repeated specified string
   * @example
   * // returns '004'
   * pad(2+2, 3)
   * @example
   * // returns '~*~~*~text'
   * pad('text', 10, '~*~')
   * @example
   * // returns [
   * //   '$         2.91',
   * //   '$ 3,304,394.00',
   * //   '$    50,504.24'
   * //
   * // ]
   * [2.906, 3304394, 50504.2422].map(price => '$' + pad(price.toLocaleString('en-US'), 13, ' '));
   * @example
   * // returns [
   * //   'Title................1',
   * //   'Contents.............4',
   * //   'Chapter 1...........12'
   * // ]
   * [{ name: 'Title', page: 1 }, { name: 'Contents', page: 2 }, { name: 'Chapter 1', page: 12 }].map(item => pad(item.name, 20, '.', false) + pad(item.page, 2, '.'));
   * @param {string} string - The string to pad
   * @param {number} amount - The desired final length of the padded string
   * @param {string} [padString='0'] - A string used repeatedly to pad another, defaults to '0'
   * @param {boolean} [prepend=true] - Whether or not padding is prepended or appended to string
   * @returns {string} Original {@link string} padded with {@link padString}, repeated until return string's length is {@link amount} number of characters
   */
  pad: (string, amount, padString = '0', prepend = true) => {
    const padding = padString
      .repeat(Math.ceil(amount / padString.length))
      .substr(0, amount - string.toString().length);
    return amount > string.toString().length ? (
      prepend ?
        padding + string.toString()
        : string.toString() + padding
      )
      : string.toString();
  },
  /*
   * Formats ISO-8601 dates to YYYY-MM-DD hh:mm:ss (Zotero-friendly date format), in the user's local time
   * @example
   * // returns '2020-12-07 16:55:43' (in EST timezone)
   * formatDate('2020-12-07T21:55:43.000Z');
   * @example
   * // returns '2020-12-07 16:55:43' (in EST timezone)
   * formatDate('2020-12-07T215543-0500');
   * @param {string} rawDate - A raw date string, may or may not be in ISO-8601 format
   * @returns {string} Date in YYYY-MM-DD hh:mm:ss format, in user's local time, if rawDate is in ISO-8601 format, otherwise returns rawDate
   */
  formatDate: rawDate => {
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
      return `${d.getFullYear()}-${module.exports.pad(d.getMonth() + 1, 2)}-${module.exports.pad(d.getDate(), 2)} ${module.exports.pad(d.getHours(), 2)}:${module.exports.pad(d.getMinutes(), 2)}:${module.exports.pad(d.getSeconds(), 2)}`;
    } else {
      return rawDate;
    }
  },
  /*
   * Merges separate arrays for first and last names of authors into an array of full names of authors in a specified format
   * @example
   * // returns ['John C. Smith', 'F. Johnson', 'Marjorie García-Gamboa']
   * formatAuthors(['John C.', 'F.', 'Marjorie'], ['Smith', 'Johnson', 'García-Gamboa']);
   * @example
   * // returns ['Smith, John C.', 'Johnson, F.', 'García-Gamboa, Marjorie']
   * formatAuthors(['John C.', 'F.', 'Marjorie'], ['Smith', 'Johnson', 'García-Gamboa'], true);
   * @param {Array} first - An array of first names
   * @param {Array} last - An array of last names
   * @param {boolean} [reverse=false] - Whether or not to reverse the order of names in the return value
   * @returns {Array} An array of full names of authors, combining first and last name
   */
  formatAuthors: (first, last, reverse = false) => {
    return reverse ? first.map((f, i) => last[i] + (f.length > 0 ? ', ' + f : '')) : first.map((f, i) => (f.length > 0 ? f + ' ' : '') + last[i]);
  },
  /*
   * Merges separate arrays for first and last names of authors into a single array of author objects, with keys for first and last name
   * @example
   * // returns [{ firstName: 'John C.', lastName: 'Smith' }, { firstName: 'F.', lastName: 'Johnson' }, { firstName: 'Marjorie', lastName: 'Marjorie García-Gamboa' }]
   * formatAuthors(['John C.', 'F.', 'Marjorie'], ['Smith', 'Johnson', 'García-Gamboa']);
   * @param {Array} first - An array of first names
   * @param {Array} last - An array of last names
   * @returns {Array} An array of author objects, with keys for first and last name
   */
  packageAuthors: (first, last) => {
    return first.map((f, i) => { return { firstName: f, lastName: last[i] } });
  },
  /*
   * Formats an Airtable duration (seconds as integer), to h:mm:ss, m:ss, or s, as necessary
   * @example
   * // returns '2:34:04'
   * formatDuration(9244);
   * @example
   * // returns '45:22'
   * formatDuration(2722);
   * @example
   * // returns '0:27'
   * formatDuration(27);
   * @param {number} duration - Duration, in seconds, as an integer
   * @returns {string} Duration formatted as h:mm:ss, m:ss, depending on magnitude of duration
   */
  formatDuration: duration => {
    return (duration < 60 ? '0:' : '') + [
      Math.floor(duration / 3600),
      duration > 3600 ?
        module.exports.pad(Math.floor((duration % 3600) / 60), 2)
        : Math.floor((duration % 3600) / 60),
      module.exports.pad(Math.floor(duration % 60), 2),
    ]
      .filter(i => i != 0)
      .join(':');
  }
}