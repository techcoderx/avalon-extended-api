const MongoClient = require('mongodb')
const Async = require('async')
const Express = require('express')
const CORS = require('cors')
const App = Express()
const http = require('http').Server(App)
const indexer = require('./indexer')

const dbName = process.env.AVALON_EXT_DBNAME || 'avalon'
const dbUrl = process.env.AVALON_EXT_DBURL || 'mongodb://localhost:27017'
const port = parseInt(process.env.AVALON_EXT_PORT) || 3008

if (isNaN(port) || port >= 65536 || port < 1)
    throw new Error('Invalid port')

MongoClient.connect(dbUrl, {useUnifiedTopology: true},(e,c) => {
    if (e) throw e
    console.log("Connected to MongoDB successfully")

    db = c.db(dbName)

    App.use(CORS())

    App.get('/count',(req,res) => {
        db.collection('blocks').findOne({},{ 
            sort: { _id: -1 },
            projection: { _id: 1 }
        },(err, count) => {
            if (err)
                res.status(500).send(err)
            else
                res.send({ count: count._id })
        })
    })

    App.get('/tx/:txhash',(req,res) => {
        db.collection('blocks').findOne({ "txs.hash": req.params.txhash }, { projection: { txs: { $elemMatch: { hash: req.params.txhash}}}},(error,tx) => {
            if (error)
                res.status(500).send(error)
            else if (tx && tx.txs) {
                let result = tx.txs[0]
                result.includedInBlock = tx._id
                res.send(result)
            } else
                res.status(404).send({error: 'transaction not found'})
        })
    })

    App.get('/history/:author/:lastBlock/:skip?', (req, res) => {
        let lastBlock = parseInt(req.params.lastBlock)
        let skip = parseInt(req.params.skip)
        let author = req.params.author
        let query = {
            $and: [
                { $or: [
                    {'txs.sender': author},
                    {'txs.data.target': author},
                    {'txs.data.receiver': author},
                    {'txs.data.pa': author},
                    {'txs.data.author': author}
                ]}
            ]
        }
        let filter = {
            sort: {_id: -1},
            limit: 50
        }

        if (lastBlock > 0) 
            query['$and'].push({_id: {$lt: lastBlock}})
        
        if (skip != NaN && skip > 0)
            filter.skip = skip

        db.collection('blocks').find(query, filter).toArray(function(err, blocks) {
            for (let b = 0; b < blocks.length; b++) {
                let newTxs = []
                for (let t = 0; t < blocks[b].txs.length; t++)
                    if (blocks[b].txs[t].sender === author
                    || blocks[b].txs[t].data.target === author
                    || blocks[b].txs[t].data.receiver === author
                    || blocks[b].txs[t].data.pa === author
                    || blocks[b].txs[t].data.author === author)
                        newTxs.push(blocks[b].txs[t])
                blocks[b].txs = newTxs
            }
            res.send(blocks)
        })
    })

    App.get('/rank/:key',(req,res) => {
        let sorting = {$sort: {}}
        let projecting = {
            $project: {
                _id: 0,
                name: 1,
                balance: 1,
                subs: { $size: "$followers" },
                subbed: { $size: "$follows" }
            }
        }
        let matching = {$match:{}}
        switch (req.params.key) {
            case 'balance':
                sorting.$sort.balance = -1
                break
            case 'subs':
                sorting.$sort.subs = -1
                break
            case 'leaders':
                projecting.$project.node_appr = 1
                projecting.$project.pub_leader = 1
                projecting.$project.hasVote = {
                    $gt: ['$node_appr',0]
                }
                sorting.$sort.node_appr = -1
                matching.$match.hasVote = true
                matching.$match.pub_leader = { $exists: true }
                break
            default:
                return res.status(400).send({error: 'invalid key'})
        }

        let aggregation = [projecting, sorting, {$limit: 100}]
        if (req.params.key == 'leaders')
            aggregation.push(matching)

        db.collection('accounts').aggregate(aggregation).toArray((e,r) => {
            if (e)
                return res.status(500).send(e)
            if (req.params.key != 'leaders')
                return res.send(r)
            else {
                for (let leader = 0; leader < r.length; leader++) {
                    delete r[leader].hasVote
                    r[leader].produced = indexer.leaders[r[leader].name].produced
                    r[leader].missed = indexer.leaders[r[leader].name].missed
                    r[leader].voters = indexer.leaders[r[leader].name].voters
                }
                res.send(r)
            }
        })
    })

    App.get('/leader/:account',(req,res) => {
        if (!req.params.account)
            res.status(404).send({error: 'account is required'})
        db.collection('accounts').findOne({name: req.params.account}, (e,acc) => {
            if (e) return res.status(500).send(e)
            if (!acc) return res.status(404).send({error: 'account does not exist'})
            if (!acc.pub_leader) return res.status(404).send({error: 'account does not contain a leader key'})
            res.send({
                name: acc.name,
                balance: acc.balance,
                node_appr: acc.node_appr,
                pub_leader: acc.pub_leader,
                subs: acc.followers.length,
                subbed: acc.follows.length,
                produced: indexer.leaders[acc.name].produced,
                missed: indexer.leaders[acc.name].missed,
                voters: indexer.leaders[acc.name].voters
            })
        })
    })

    indexer.loadIndex(() => indexer.buildIndex(indexer.processedBlocks+1,() => indexer.writeIndex(() => {
        indexer.stream()
        http.listen(port,()=>console.log('Extended API server listening on port '+port))
    })))
})