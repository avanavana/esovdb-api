# Airtable API Proxy
For querying the [Earth Science Online Video Database](https://airtable.com/shrFBKQwGjstk7TVn).

I built this to be tailored to the ESOVDB's needs, but you can clone or fork this for a quick start on your own Airtable API cache proxy. BYODOTENV with your Airtable API key and base ID, and adapt to your own fields.  I built a set of helper functions for transforming select Airtable data into Zotero-compatible formats (the ultimate destination in my own usage.)

Run with `npm start` (or install [`pm2`](https://github.com/Unitech/pm2), as I prefer, or [`nodemon`](https://www.npmjs.com/package/nodemon) and run it with those to keep it alive).

- Cache proxy with rate limiting and exponential backoff
- Takes optional `maxRequests` & `pageSize` URL query params (Airtable limits the latter to 100)
- Fetch a specific page of records by adding an optional `/:page` param (0-indexed) after the `api/list` endpoint
- *Coming soon: supply `modifiedAfter` or `createdAfter` URL query params to fetch records modified or created after a specified date/time*

I will probably not update the guts too much more after the last item above, because this is meant to be a lightweight solution and it already works well and soon will fulfil all my own requirements.

Server-side of [avanavana/zotero-esovdb](https://github.com/avanavana/zotero-esovdb).

Forked from daniloc/airtable-api-proxy