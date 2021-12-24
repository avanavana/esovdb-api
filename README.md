# Airtable API Proxy
This service has two main roles:  In its public facing role, it sets up a cache proxy API server for querying the [Earth Science Online Video Database](http://www.esovdb.org), (as a proxy for the Airtable API, whose reponses are cached, avoiding the extreme delay caused by Airtable's rate-limiting and pagination, when dealing with thousands of records).  In its private role, this service provides methods for syncing new submissions and updates to the ESOVDB (on Airtable, using Airtable's automation triggers and scripting) with a Zotero library (also available to the public [here](https://www.zotero.org/groups/2764885/esovdb/library)).  Once items are synced to Zotero, the Zotero key and version number they receive from that program are then back-synced to the ESOVDB, and any Zotero collections for the video series or topic needed are created, and each video assigned to its respective collections.  Because Airtable's automation methods are restricted to processing a single created record or single updated record at a time, it was necessary to include employ Redis in the project, which serves to temporarily hold all content in the current batch, before clearing it for the next.  As `onUpdateRecord` events can be so unpredictable as to be nearly non-deterministic, due to updates to one or many records affecting records up and downstream of them, it was necessary to handle batch processing of `onUpdateRecord` events from Airtable using streams and the Observer/Observable pattern. The service also includes methods for syncing with Zotero directly from updates or new records in Airtable, which can be set up with Airtable's automation (see below).  This implementation additionally posts new submissions from Airtable to a 'What's New' channel on the [ESOVDB Discord](https://discord.gg/PNPYGZ54Ue) using webhooks and posts a new tweet from [@esovdb](https://www.twitter.com/esovdb).

Built as the server-side of [avanavana/zotero-esovdb](https://github.com/avanavana/zotero-esovdb).

Forked from [daniloc/airtable-api-proxy](https://github.com/daniloc/airtable-api-proxy). I refactored this pretty heavily to tailor it to the ESOVDB's needs, but you can clone or fork this for a quick start on your own Airtable API cache proxy.

BYODOTENV with your Airtable API key and base ID, and adapt to your own fields, and Zotero Key and User if you also need a proxy server for the Zotero API (my implementation doesn't need caching as it's all create or update actions, but adding caching is trivial as the cache module included is built to work with any endpoint provided). See the `sample.env` file provided, replace with your data, and rename to `.env`.

I built a set of helper functions for transforming select Airtable data into Zotero-compatible formats (again, the ultimate destination in my own usage), as well as some utility functions and middleware to either whitelist or blacklist IPs, which you can keep as a space-separated string with wildcards, also in your dotenv.  Most files have inline, JSDoc-style documentation.

## Usage
Run with `npm start` (or better yet, install [`pm2`](https://github.com/Unitech/pm2), my preference, or [`nodemon`](https://www.npmjs.com/package/nodemon) and run it with those to keep it alive).

- Cache proxy with rate limiting via [`bottleneck`](https://github.com/SGrondin/bottleneck)
- Simple, JSON file-based caching for most public requests
- Redis-based caching for batch processing sync requests to Zotero, allowing the use of in-memory cache with a cluster of virtual machines
- Videos endpoint can take optional `maxRecords` & `pageSize` URL query params (Airtable limits the latter to 100)
- Fetch a specific page of video records by adding an optional `/:pg` param (0-indexed) after the `api/list` endpoint
- Videos endpoint can take `modifiedAfter` or `createdAfter` URL query params to fetch records modified or created after a specified date/time
- Supply a list of space-separated IP addresses with optional wildcards (e.g. 255.255.\*.\*) in your dotenv or elsewhere and limit access to endpoints using an API key by passing included middleware
- Syncs videos and series created, updated, and deleted in Airtable with equivalent items and collections in a public Zotero library.

I will probably not update the guts too much more after the last item above, because this is meant to be a lightweight solution and it already works well and soon will fulfill all my own requirements.

## Pre-configured Endpoints
I built this for my own needs, and the following are the endpoints I use, but these can be removed or adapted to your own needs for any Airtable implementation alone, or with additional synchronization to Zotero, as I do.

### `GET` /videos
Retrieves all active videos in the entire ESOVDB database.  Much quicker than the `/videos/query` endpoint below, as this view is usually cached.  Premium API users can provide a special header in their request to prevent the cached version from loading (never any older than 24 hours, and only videos modified in the previous 24 hours, ever need to be retrieved fresh)

### `GET` /videos/query/:pg?
Retrieves a list of records, with the option of several query parameters, from the Videos table on the ESOVDB Airtable, page by page, as Airtable requires, using [`bottleneck`](https://github.com/SGrondin/bottleneck) to avoid rate-limiting, and sends the final result of all requested records as JSON. All requests are cached (cache expiration is parameterized) using the server's file system, according to the structure of the query and any additional URL params. The `/:pg?` parameter, as indicated, is optional, and allows you to query a specific page of the results, skipping all others.Gets

**Additional URL Query Params:**
- `maxRecords` – Synonymous with the Airtable API's `maxRecords` param—limits the total results returned. (default: all records)
- `pageSize` – Synonymous with the Airtable API's `pageSize` param—the number of records to return with each paged request to the Airtable API.  Airtable limits this to 100 per page. (default: 100 records)
- `modifiedAfter` – Creates a `filterByFormula` param in the Airtable API request that retrieves records modified after a certain date (most date strings work, uses `Date.parse()`)
- `createdAfter` – Creates a `filterByFormula` param in the Airtable API request that retrieves records created after a certain date (most date strings work, uses `Date.parse()`)

### `POST` /:table/update
Creates one or more records on a specified `table` on Airtable (e.g. `/videos/create` is the endpoint you'd use to create a new video).  The body of this post request should be an array of objects formatted as per the Airtable API spec:
```javascript
[
  { 
    fields: {
      'Airtable Field': 'value',
      ...
    }
  },
  ...
]
```
Processes as many records as you give it in batches of 50, as Airtable requires, using [`bottleneck`](https://github.com/SGrondin/bottleneck) to avoid rate-limiting.

### `PUT` /:table/update
Updates one or more records on a specified `table` on Airtable (e.g. `/videos/update` is the endpoint you'd use to update an existing video).  The body of this post request should be an array of objects formatted as per the Airtable API spec:
```javascript
[
  { 
    id: 'recordID',
    fields: {
      'Airtable Field': 'value',
      ...
    }
  },
  ...
]
```
Processes as many records as you give it in batches of 50, as Airtable requires, using [`bottleneck`](https://github.com/SGrondin/bottleneck) to avoid rate-limiting.

### `POST` /zotero/:kind
Adds items or collections (e.g. `/zotero/items` or `/zotero/collections`) to a Zotero Library, up to 50 at a time, at a maximum of 6/min, which is the Zotero API's limit.  I use this endpoint combined with Airtable's automations feature to automatically add items to the public ESOVDB Zotero library every time a new record is created in Airtable.  Each successfully created record in Airtable is then processed with a message template and posted by webhook/bot on the ESOVDB Discord server. (https://discord.gg/hnyD7PCk) My implementation further back-syncs the newly created item in Zotero with the originating table in Airtable, so that each record in Airtable has a Zotero key and version that I can use to track updates later.  Additionally, the public ESOVDB library on Zotero contains topic and series subcollections, for each topic and series in the ESOVDB–these are automatically created when this endpoint is hit with a new series (the list of ESOVDB topics isn't changing), and videos with existing series get filed into their correct topic and series subcollections.

**Sample Airtable Script for Automation**

*Note: when using Airtable's automations, you will have to set up your input.config() object to match all the fields you want to send in the Airtable script below*

```javascript
/**
 *  @trigger Videos › onCreateRecord
 *  @desc Syncs added record on Zotero via ESOVDB proxy server and then syncs back to ESOVDB with assigned key and version
*/

const data = input.config();

if (data.status === 'active') {
    const record = {
        title: data.title,
        url: data.url,
        year: data.year,
        desc: data.desc,
        runningTime: data.runningTime,
        format: data.format,
        topic: data.topic,
        tagsList: data.tags,
        learnMore: data.learnMore,
        series: data.series,
        seriesCount: data.seriesCount,
        vol: data.vol,
        no: data.no,
        publisher: data.publisher,
        presentersFirstName: data.presenterFn,
        presentersLastName: data.presenterLn,
        language: data.language,
        location: data.location,
        plusCode: data.plusCode,
        provider: data.provider,
        esovdbId: data.esovdbid,
        recordId: data.id,
        accessDate: data.isoAdded,
        created: data.created,
        modified: data.modified
    };

    let response = await fetch('https://your-proxy-server.com/zotero/items', {
        method: 'POST',
        body: JSON.stringify(record),
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (response.status === 200) {
        console.log('Successfully added item to Zotero and synced version on ESOVDB.');
    } else if (response.status === 202) {
        console.log('Successfully added item to batch request');
    } else {
        console.error('Error adding item to Zotero or syncing version on ESOVDB.')
    }
}
```

### `PUT` /zotero/:kind
Updates items or collections (e.g. `/zotero/items` or `/zotero/collections`) in a Zotero Library, up to 50 at a time, at a maximum of 6/min, which is the Zotero API's limit.  I use this endpoint combined with Airtable's automations feature to automatically update items in the public ESOVDB Zotero library every time a record is updated in Airtable.

**Sample Airtable Script for Automation**
*Note: when using Airtable's automations, you will have to set up your input.config() object to match all the fields you want to send in the Airtable script below*

```javascript
/**
 *  @trigger Videos › onUpdateRecord
 *  @desc Syncs updated record on Zotero via ESOVDB proxy server and then syncs back to ESOVDB with new version
*/

const data = input.config();

if (data.status === 'active') {
    const record = {
        zoteroKey: data.zoteroKey,
        zoteroVersion: data.zoteroVersion,
        title: data.title,
        url: data.url,
        year: data.year,
        desc: data.desc,
        runningTime: data.runningTime,
        format: data.format,
        topic: data.topic,
        tagsList: data.tags,
        learnMore: data.learnMore,
        series: data.series,
        seriesCount: data.seriesCount,
        vol: data.vol,
        no: data.no,
        publisher: data.publisher,
        presentersFirstName: data.presenterFn,
        presentersLastName: data.presenterLn,
        language: data.language,
        location: data.location,
        plusCode: data.plusCode,
        provider: data.provider,
        esovdbId: data.esovdbid,
        recordId: data.id,
        accessDate: data.isoAdded,
        created: data.created,
        modified: data.modified
    };

    let response = await fetch('https://your-proxy-server.com/zotero/items', {
        method: 'PUT',
        body: JSON.stringify(record),
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (response.status === 200) {
        console.log('Successfully updated item on Zotero and synced version on ESOVDB.');
    } else if (response.status === 202) {
        console.log('Successfully added item to batch request');
    } else {
        console.error('Error updating item on Zotero or syncing version on ESOVDB.')
    }
}
```

### `DELETE` /zotero/:kind
Removes items or collections (e.g. `/zotero/items` or `/zotero/collections`) from a Zotero Library, up to 50 at a time, at a maximum of 6/min, which is the Zotero API's limit.  I use this endpoint combined with Airtable's automations feature to automatically remove items from the public ESOVDB Zotero library every time a record is deleted in Airtable.

**Sample Airtable Script for Automation**
*Note: The below script is meant to work with both a "Delete" button on each Airtable video row, or with batch deletion using a checkbox column, as there is no `onDeleteRecord` event in Airtable's automation intenvory.  When using Airtable's automations, you will have to set up your input.config() object to match all the fields you want to send in the Airtable script below*

```javascript
/**
 *  @context Any/Delete
 *  @desc Deletes selected (from button) record on the ESOVDB and syncs the deletion with its counterpart in the ESOVDB Zotero library.
*/

const table = cursor.activeTableId ? base.getTable(cursor.activeTableId) : null;
const viewId = cursor.activeViewId;

const esovdbToZotero = new Map([
    [ 'Videos', 'items' ],
    [ 'Series', 'collections' ]
]);

const deleteRecords = async (table, data) => {
    try {
        const response = await fetch(`https://api.esovdb.org/zotero/${esovdbToZotero.get(table.name)}`, {
            method: 'DELETE',
            body: JSON.stringify(data),
            headers: { 'esovdb-key': '6aee2ffc41c625e712ec2c96781fc470', 'Content-Type': 'application/json' }
        });

        if (response.status !== 200) throw new Error('Error syncing with Zotero.');

        if (data.length > 1) table.deleteRecordsAsync(data.map((record) => record.id));
        else table.deleteRecordAsync(data[0].id);
    } catch (err) {
        console.error(err.message);
    }
}

if (table && viewId && session && session.currentUser && session.currentUser.email === 'dear.avana@gmail.com') {
    const view = table.getView(viewId);
    let { records: viewQuery } = await view.selectRecordsAsync({ fields: ['Zotero Key', 'Flag for Deletion'] });

    let records = viewQuery
        .filter((record) => record.getCellValue('Flag for Deletion'))
        .map((record) => ({
            batch: true,
            batchSize: viewQuery.filter((r) => r.getCellValue('Flag for Deletion')).length,
            zoteroKey: record.getCellValue('Zotero Key'),
            id: record.id
        }));
    
    if (records.length > 0) {
        while (records.length > 0) await deleteRecords(table, records.splice(0, 50));
    } else {
        let record = await input.recordAsync('', view);
        
        if (record) {
            await deleteRecords(table, [{
                batch: false,
                batchSize: 0,
                zoteroKey: record.getCellValue('Zotero Key'),
                id: record.id
            }]);
        }
    }
}
```

Follow the ESOVDB for updates and new submissions:
Twitter: [@esovdb](https://www.twitter.com/esovdb)
Discord: [Join ESOVDB Server](https://discord.gg/PNPYGZ54Ue)

MIT
Copyright (c) 2020-2022 Avana Vana 