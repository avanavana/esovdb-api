module.exports = {
  pad: (string, amount, spacer = '0', prepend = true) => {
    const padding = spacer
      .repeat(Math.ceil(amount / spacer.length))
      .substr(0, amount - string.toString().length);
    return amount > string.toString().length ? (
      prepend ?
        padding + string.toString()
        : string.toString() + padding
      )
      : string.toString();
  },
  formatDate: raw => {
    const iso8601Format = /^([0-9]{4})-?([01][0-9])-?([0-3][0-9])T([0-2][0-9]):?([0-5][0-9]):?([0-6][0-9])(?:\.0{3}|\.0{6})?(?:Z|(([+-])([01][0-9]):?([0-5][0-9])?))$/;

    if (iso8601Format.test(raw)) {
      let [, year, month, day, hours, min, sec, offset, offsetSign, offsetHours, offsetMin] = iso8601Format.exec(raw) || [];
      let d = new Date(year, month - 1, day, hours, min, sec);
      if (offset) {
        d.setHours(d.getHours() + offsetHours * (offsetSign === '+' ? 1 : -1));
        offsetMin && d.setMinutes(d.getMinutes() + offsetMin * (offsetSign === '+' ? 1 : -1));
      } else {
        d = new Date(d.getTime() - d.getTimezoneOffset() * 1000 * 60);
      }
      return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${module.exports.pad(d.getHours(), 2)}:${module.exports.pad(d.getMinutes(), 2)}:${module.exports.pad(d.getSeconds(), 2)}`;
    } else {
      return raw;
    }
  },
  formatAuthors: (first, last, reverse = false) => {
    return reverse ? first.map((f, i) => last[i] + (f.length > 0 ? ', ' + f : '')) : first.map((f, i) => (f.length > 0 ? f + ' ' : '') + last[i]);
  },
  formatDuration: duration => {
    return [
      Math.floor(duration / 3600),
      duration > 3600 ?
        module.exports.pad(Math.floor((duration % 3600) / 60), 2)
        : Math.floor((duration % 3600) / 60),
      module.exports.pad(Math.floor(duration % 60), 2),
    ]
      .filter((i) => i.toString() !== '0')
      .join(':');
  }
}