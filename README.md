### **⚠️ This repository has been depreciated as the core APIs have been organized and all API methods contained here have been merged into the main repository. ⚠️**

# avalon-extended-api

Set of additional Avalon APIs that provide more information than its core APIs.

## Installation

Assuming that [Avalon](https://github.com/dtube/avalon) is already running and synced with the head block.

```
git clone https://github.com/techcoderx/avalon-extended-api.git
cd avalon-extended-api
npm i
node .
```

The extended API will listen to port 3008 by default, or the port specified in `AVALON_EXT_PORT` environment variable.

## Configuration

Avalon extended API can be configured to connect to a different MongoDB instance, non-default database or another port using environment variables.

#### Defaults:
```
AVALON_EXT_DBNAME=avalon
AVALON_EXT_DBURL=mongodb://localhost:27017
AVALON_EXT_PORT=3008
```

## GET APIs

#### Query single transaction by hash
```
/tx/<txhash>
```

For example:
```
$ curl http://localhost:3008/tx/98b1844e4ebef38a71f8a29e37daadf8e4e6c7ae7d6c0116ed556bb39f6590a9 | jq

{
    "type": 1,
    "data": {
        "target": "zurich"
    },
    "sender": "dtube",
    "ts": 1601557504677,
    "hash": "98b1844e4ebef38a71f8a29e37daadf8e4e6c7ae7d6c0116ed556bb39f6590a9",
    "signature": "34BHR6F5uPGWtnD6gcxV68jVuqiRxQJyq4LZLtvSQ5zEfFeL3Svhi76FEF359ziTP9dFhVQGeqemsoLQga1Z7jHP",
    "includedInBlock": 10
}
```

#### Paginated account history
Backwards compatible with account history API included in the core Avalon APIs.
```
/history/<account>/<lastBlock>/[skip]
```

For example:
```
$ curl http://localhost:3008/history/techcoderx/0/50
```
Will return the next 50 results of the account history.

#### Get account rankings
```
/rank/<key>
```
Where `<key>` can be `balance`, `subs` or `leaders`.

For example:
```
$ curl http://localhost:3008/rank/balance

[
    {"name":"dtube","balance":259309210,"subs":617,"subbed":0},
    {"name":"dtube.airdrop","balance":25424215,"subs":6,"subbed":0},
    ...(up to 100 accounts)
]
```

#### Get details for one leader
```
/leader/<account>
```

For example:
```
$ curl http://localhost:3008/leader/techcoderx

{
    "name":"techcoderx",
    "balance":5942,
    "node_appr":8934733,
    "pub_leader":"23G1afyhx5zx7mBDJTJdophohPgCTTb7evj3jX77YtW7C",
    "subs":82,
    "subbed":24,
    "produced":47267,
    "missed":0,
    "voters":87
}
```
