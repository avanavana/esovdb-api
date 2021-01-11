/**
 * @file Common cache methods
 * @author Avana Vana <dear.avana@gmail.com>
 * @module cache
 */

const fs = require('fs');

/** @constant {number} [cacheInterval=300] - The duration, in seconds after which a cache file is considered stale (default: 300s = 5m) */
let cacheInterval = 60 * 5;

module.exports = {
  
  /*
   * Sets the cache interval (in integer seconds)
   *
   * @method setCacheInterval
   * @param {number} interval - The number of seconds to set the cache interval to
   */
  
  setCacheInterval: interval => {
    cacheInterval = interval;
  },
  
  /*
   * Uses a request's path to write a response as a file to the cache
   *
   * @method writeCacheWithPath
   * @param {string} path - The request's URL, with query params
   * @param {Object} data - The response, as a Javascript Object, from the request
   */
  
  writeCacheWithPath: (path, data) => {
    const queryPath = path.replace('?', '/');
    
    `/${queryPath}`
      .split('/')
      .splice(0, `/${queryPath}`.split('/').length - 1)
      .reduce((p, c) => {
        p += `${c}/`;
        !fs.existsSync(p) && fs.mkdirSync(p);
        return p;
      });

    fs.writeFile(queryPath, JSON.stringify(data), function (err) {
      if (err) throw err;
      else console.log('Cache write succeeded: ' + path);
    });
  },
  
  /*
   * Uses a request's path to read a file from the cache if it exists or is still fresh
   *
   * @method writeCacheWithPath
   * @param {string} path - The request's URL, with query params
   * @returns {?Object} Returns cache JSON data as an object if it exists and is still fresh, else null
   */
  
  readCacheWithPath: function (path) {
    let stale = true;
    path = path.replace('?', '/');
    
    if (fs.existsSync(path)) {
      var cachedTime = fs.statSync(path).ctime;
      stale =
        (new Date().getTime() - cachedTime) / 1000 > cacheInterval ? true : false;
    }

    return stale ? null : JSON.parse(fs.readFileSync(path, 'utf8'));
  }
};
