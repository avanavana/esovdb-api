const fs = require('fs');

let cacheInterval = 60 * 5;

module.exports = {
  setCacheInterval: (interval) => {
    cacheInterval = interval;
  },
  writeCacheWithPath: (path, object) => {
    `/${path}`
      .split('/')
      .splice(0, `/${path}`.split('/').length - 1)
      .reduce((p, c) => {
        p += `${c}/`;
        !fs.existsSync(p) && fs.mkdirSync(p);
        return p;
      });

    fs.writeFile(path, JSON.stringify(object), function (err) {
      if (err) throw err;
      else console.log('Cache write succeeded: ' + path);
    });
  },
  readCacheWithPath: function (path) {
    if (fs.existsSync(path)) {
      var cachedTime = fs.statSync(path).ctime;
      const expired =
        (new Date().getTime() - cachedTime) / 1000 > cacheInterval ? true : false;
    }

    return expired ? null : JSON.parse(fs.readFileSync(path, 'utf8'));
  }
};
